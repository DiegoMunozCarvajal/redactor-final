import { type ReasoningEffort } from "./completion";
import { DEFAULT_GENERATION_MODEL } from "./providers";
import { searchSemanticScholar, type SearchResult } from "./web-search";
import { retrieveContext } from "./rag";
import { inferPlaceholderProvider } from "@/lib/placeholder-research";
import { db } from "@/lib/db";
import { chapterPlaceholders, chapters } from "@/lib/db/schema";
import { eq, and, not, isNotNull } from "drizzle-orm";
import { checkBlocklist, assertOriginalEnough, OriginalityError } from "./originality-check";
import type { EditorialBundle } from "@/lib/editorial-brief/schema";
import { renderEditorialData } from "@/lib/editorial-brief/render";
import { executeVersionedPrompt } from "@/lib/prompts/executor";
import { z } from "zod";
import {
  serializePlaceholderContext,
  serializeResearchResults,
  serializeValidationFeedback,
} from "@/lib/placeholders/prompt-data";

export type { SearchResult };

/** Escape user-generated text for safe insertion inside XML-like prompt tags.
 *  Prevents RAG/snippet content containing `</content>` or `</research_results>`
 *  from breaking prompt framing or injecting instructions into downstream LLM calls. */
function escapeXmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export interface PlaceholderFillEvent {
  type: "placeholder" | "done" | "error" | "cancelled" | "blocked";
  name?: string;
  definition?: string;
  sources?: SearchResult[];
  ragChunks?: number;
  /** Research provider used: "rag" | "semantic-scholar" | "llm" | "direct" | "reused" */
  provider?: string;
  error?: string;
  /** Index of current placeholder being filled (0-based) */
  current?: number;
  /** Total placeholders to fill */
  total?: number;
  /** Evidence query from editorial brief contract, if applicable */
  evidenceQuery?: string;
  /** Source IDs searched for evidence (from approved brief) */
  evidenceSourceIds?: string[];
  /** Execution IDs from versioned prompt calls */
  executionIds?: string[];
  /** Count of successfully filled placeholders (emitted in "done" event) */
  filled?: number;
  /** Count of failed placeholders (emitted in "done" event) */
  failed?: number;
  /** Count of blocked placeholders — insufficient evidence (emitted in "done" event) */
  blocked?: number;
  /** Fill status: "completed" (has definition) or "insufficient_evidence" (blocked) */
  status?: "completed" | "insufficient_evidence";
  /** Reason why evidence was insufficient (only for "blocked" events) */
  insufficientReason?: string;
}

// Default model for generation if none specified
const DEFAULT_MODEL = DEFAULT_GENERATION_MODEL;

export function extractJson(text: string): unknown {
  // Phase 1: Direct parse — works for well-formed JSON
  try {
    return JSON.parse(text.trim());
  } catch {}

  // Phase 2: JSON in fenced code blocks (```json ... ``` or ``` ... ```)
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {}
  }

  // Phase 3: Find the outermost JSON object with string-aware brace counting.
  // Handles nested braces, text before/after JSON, and concatenated JSON objects
  // (takes the first valid one). Skips braces inside JSON strings to avoid
  // false depth from string content like "use {placeholder} here".
  let depth = 0;
  let start = -1;
  let inString = false;
  let escapeNext = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") { escapeNext = true; }
      else if (ch === "\"") { inString = false; }
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        const candidate = text.slice(start, i + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          // Try to salvage: fix common JSON issues in the extracted block
          const salvaged = candidate
            .replace(/,\s*}/g, "}")
            .replace(/,\s*\]/g, "]");
          try {
            return JSON.parse(salvaged);
          } catch {
            // Continue searching for another JSON block
            start = -1;
            continue;
          }
        }
      }
    }
  }

  // Phase 4: Last resort — fix common issues globally, then try lazy match
  // (first complete JSON object, not greedy which would span multiple objects)
  const cleaned = text
    .replace(/,\s*}/g, "}")
    .replace(/,\s*\]/g, "]")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  const objMatch = cleaned.match(/\{[\s\S]*?\}/);
  if (objMatch) {
    try {
      return JSON.parse(objMatch[0]);
    } catch {}
  }

  throw new Error("Could not parse JSON from response");
}

// Placeholder names that resolve directly from project data (no LLM)
export function resolveDirectly(
  name: string,
  projectTopic: string | null,
): string | null {
  const lower = name.toLowerCase();
  const segments = lower.split("_");

  if ((segments.includes("tema") || segments.includes("topic")) && projectTopic) {
    return projectTopic;
  }

  return null;
}

/** Build a search query from placeholder metadata, not just the placeholder name.
 *  Uses `function` as primary intent descriptor — it explains what content the
 *  placeholder needs, which yields better search results than underscore_names. */
export function buildSearchQuery(ph: PlaceholderDef, projectTopic: string | null): string {
  const topic = projectTopic ?? "";

  if (ph.function && ph.function.length > 0) {
    // Function describes intent: "El esfuerzo para eliminar un mal hábito"
    // Strip leading articles for a cleaner query
    const funcClean = ph.function
      .replace(/^(El |La |Los |Las |Un |Una |Unos |Unas )/, "")
      .trim();
    return `${funcClean} ${topic}`.trim();
  }

  // Fallback: use placeholder name with underscores replaced
  const nameReadable = ph.name.replace(/_/g, " ");
  return `${nameReadable} ${topic}`.trim();
}

/** Schema for structured output from the placeholder-fill prompt revision.
 *  LLM can explicitly declare insufficient evidence instead of fabricating. */
const fillOutputSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("completed"),
    definition: z.string(),
  }),
  z.object({
    status: z.literal("insufficient_evidence"),
    reason: z.string(),
  }),
]);

type FillOutput = z.infer<typeof fillOutputSchema>;

// ── Post-generation validation ──

interface ValidationResult {
  ok: boolean;
  reason?: string;
}

const MIN_DEFINITION_LENGTH = 30;   // catch "arrancar un roble" cases
export function isNarrativePlaceholder(ph: PlaceholderDef): boolean {
  // Match whole-word/phrase patterns to avoid false positives.
  // "caso" alone is excluded — too broad (appears in "en caso de", "hacer caso", etc.).
  // Use specific phrases: "caso de estudio", "caso real", "caso concreto", etc.
  const narrativePatterns = [
    /\bhistoria\b/,
    /\ban[ée]cdota\b/,
    /\bf[áa]bula\b/,
    /\bnarrativa\b/,
    /\brelato\b/,
    /\bescena\b/,
    /caso\s+(de\s+estudio|real|concreto|documentado|espec[ií]fico|ilustrativo)/,
    /ejemplo\s+concreto/,
    /ilustraci[óo]n/,
  ];
  // Include placeholder name (with underscores → spaces) so bare-name
  // narrative placeholders like {anecdota} or {historia} are classified
  // correctly even when function/notes are empty.
  const text = `${ph.name.replace(/_/g, " ")} ${ph.function ?? ""} ${ph.notes ?? ""}`.toLowerCase();
  return narrativePatterns.some((pattern) => pattern.test(text));
}

export function validateDefinition(
  definition: string,
  placeholderName: string,
  ph: PlaceholderDef,
): ValidationResult {
  // Normalize whitespace before structural checks.
  // Whitespace-only definitions are treated as empty.
  const def = definition.trim();

  // 0. Blocklist — fastest check, strongest signal. Must pass before structural checks.
  const blocklistHits = checkBlocklist(def);
  if (blocklistHits.length > 0) {
    return {
      ok: false,
      reason: `Contenido protegido detectado: ${blocklistHits.slice(0, 3).join(", ")}`,
    };
  }

  // 1. Minimum length — catch truncated extractions.
  //    Narrative placeholders (stories, anecdotes, examples) need substantial content.
  //    Non-narrative placeholders (terms, maxims, entity names) are naturally short.
  const minLen = isNarrativePlaceholder(ph) ? MIN_DEFINITION_LENGTH : 3;
  if (def.length < minLen) {
    return { ok: false, reason: `Definition too short (${def.length} chars, min ${minLen})` };
  }

  // 2. Name bleeding — definition should not contain the placeholder name verbatim.
  //    Uses Unicode-aware word boundaries (u flag) to handle accented characters.
  const escaped = placeholderName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const namePattern = new RegExp(
    `\\b${escaped.replace(/_/g, String.raw`[_\s]+`)}\\b`,
    "iu",
  );
  if (namePattern.test(def)) {
    return { ok: false, reason: `Definition contains placeholder name "${placeholderName}" — name bleeding detected` };
  }

  return { ok: true };
}

/**
 * Thrown when a required evidence need has no matching chunks in approved sources.
 * This prevents the LLM from fabricating data for evidence-critical placeholders.
 */
export class RequiredEvidenceMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequiredEvidenceMissingError";
  }
}

type GenerateResult =
  | { status: "completed"; definition: string; executionIds: string[] }
  | { status: "insufficient_evidence"; reason: string; executionIds: string[] };

async function generateAndValidate(
  model: string,
  projectId: string,
  ph: PlaceholderDef,
  baseMarkerValues: Record<string, string>,
  effort?: ReasoningEffort,
  temperature?: number,
  signal?: AbortSignal,
  chapterId?: string,
  chapterGenerationId?: string,
): Promise<GenerateResult> {
  const executionIds: string[] = [];

  // First attempt — initial validation feedback
  const initialVf = serializeValidationFeedback({ status: "initial" });
  const markers = { ...baseMarkerValues, "{{VALIDATION_FEEDBACK}}": initialVf };

  const firstResult = await executeVersionedPrompt({
    stage: "placeholder-fill",
    kind: "placeholder-fill",
    projectId,
    chapterId,
    chapterGenerationId,
    markerValues: markers,
    model,
    schema: fillOutputSchema,
    effort,
    temperature,
    signal,
  });

  executionIds.push(firstResult.executionId);

  const data = firstResult.result.data as FillOutput;

  // LLM explicitly declares insufficient evidence — propagate immediately, no retry
  if (data.status === "insufficient_evidence") {
    console.warn(
      `[placeholder-fill] LLM declared insufficient_evidence for {${ph.name}}: ${data.reason}`,
    );
    return { status: "insufficient_evidence", reason: data.reason, executionIds };
  }

  const definition = data.definition;

  if (!definition) {
    return {
      status: "insufficient_evidence",
      reason: `No definition generated for {${ph.name}}`,
      executionIds,
    };
  }

  // Single validation path: structure + blocklist (unified in validateDefinition)
  const validation = validateDefinition(definition, ph.name, ph);
  if (validation.ok) {
    try {
      assertOriginalEnough(definition, { stage: "placeholder-def", throwOnFail: true });
      return { status: "completed", definition, executionIds };
    } catch (err) {
      if (err instanceof OriginalityError) {
        console.warn(
          `[placeholder-fill] Corpus check failed for {${ph.name}}: ${err.message}. Retrying.`,
        );
        // Fall through to retry with contamination hint
      } else {
        throw err;
      }
    }
  }

  // Retry once with message adapted to failure type.
  // When validation.ok is true but we're here → corpus check failed → contamination.
  const reason = validation.ok
    ? "Contenido protegido detectado en verificación de corpus"
    : (validation.reason ?? "validación");
  console.warn(
    `[placeholder-fill] Validation failed for {${ph.name}}: ${reason}. Retrying.`,
  );

  const retryVf = serializeValidationFeedback({
    status: "retry",
    reason,
    hint: undefined,
  });
  const retryMarkers = { ...baseMarkerValues, "{{VALIDATION_FEEDBACK}}": retryVf };

  const retryResult = await executeVersionedPrompt({
    stage: "placeholder-fill",
    kind: "placeholder-fill",
    projectId,
    chapterId,
    chapterGenerationId,
    markerValues: retryMarkers,
    model,
    schema: fillOutputSchema,
    temperature: 0.2,
    signal,
  });

  executionIds.push(retryResult.executionId);

  const retryData = retryResult.result.data as FillOutput;

  // LLM declares insufficient evidence on retry
  if (retryData.status === "insufficient_evidence") {
    console.warn(
      `[placeholder-fill] Retry LLM declared insufficient_evidence for {${ph.name}}: ${retryData.reason}`,
    );
    return { status: "insufficient_evidence", reason: retryData.reason, executionIds };
  }

  const retryDefinition = retryData.definition;

  if (!retryDefinition) {
    console.warn(`[placeholder-fill] No definition on retry for {${ph.name}}. Blocking.`);
    return {
      status: "insufficient_evidence",
      reason: `No definition generated on retry for {${ph.name}}`,
      executionIds,
    };
  }

  const retryValidation = validateDefinition(retryDefinition, ph.name, ph);
  if (!retryValidation.ok) {
    console.warn(
      `[placeholder-fill] Retry also failed for {${ph.name}}: ${retryValidation.reason}. Blocking definition.`,
    );
    return {
      status: "insufficient_evidence",
      reason: retryValidation.reason ?? "Validation failed after retry",
      executionIds,
    };
  }

  try {
    assertOriginalEnough(retryDefinition, { stage: "placeholder-def", throwOnFail: true });
  } catch (err) {
    if (err instanceof OriginalityError) {
      console.warn(
        `[placeholder-fill] Retry corpus check also failed for {${ph.name}}: ${err.message}. Blocking definition.`,
      );
      return {
        status: "insufficient_evidence",
        reason: `Corpus check failed after retry: ${err.message}`,
        executionIds,
      };
    }
    throw err;
  }

  return { status: "completed", definition: retryDefinition, executionIds };
}

export interface PlaceholderDef {
  name: string;
  function?: string | null;
  notes?: string | null;
}

export interface FillOneResult {
  name: string;
  definition: string;
  /** Fill status: "completed" (definition is valid) or "insufficient_evidence" (blocked) */
  status: "completed" | "insufficient_evidence";
  /** Reason for insufficient evidence — only set when status is "insufficient_evidence" */
  insufficientReason?: string;
  sources: SearchResult[];
  ragChunks?: number;
  provider: string;
  /** Evidence query from the editorial brief contract, if applicable */
  evidenceQuery?: string;
  /** Source IDs searched for evidence (from approved brief) */
  evidenceSourceIds?: string[];
  /** Execution IDs from versioned prompt calls (first attempt and optionally retry) */
  executionIds?: string[];
}

export interface FillOnePlaceholderParams {
  /** Placeholder definition with name, function, and notes */
  placeholder: PlaceholderDef;
  /** Project topic (used for query construction and direct resolution) */
  projectTopic: string | null;
  /** Project ID for DB-scoped operations */
  projectId: string;
  /** Current chapter ID (for cross-chapter reuse and editorial contract matching) */
  chapterId?: string;
  /** Current chapter generation ID (for execution tracing) */
  chapterGenerationId?: string;
  /** Prompt contents for context */
  promptContents: string[];
  /** Source contexts for each prompt (same index as promptContents). Null entries allowed. */
  sourceContexts?: Array<string | null>;
  /** Existing definitions for other placeholders (for context and reuse) */
  existingDefinitions: Record<string, string>;
  /** Optional editorial bundle for evidence-driven RAG overrides */
  editorialBundle?: EditorialBundle | null;
  /** Model override */
  model?: string;
  /** Reasoning effort */
  effort?: ReasoningEffort;
  /** Temperature for LLM generation */
  temperature?: number;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

/**
 * Fill a single placeholder with the full research pipeline:
 * direct resolution → cross-chapter reuse (if eligible) → provider classification →
 * research (RAG/Semantic Scholar/web) → prompt construction → LLM generation.
 *
 * Used by both the sequential batch fill and the single-placeholder API endpoint.
 */
export async function fillOnePlaceholder(
  params: FillOnePlaceholderParams,
): Promise<FillOneResult> {
  const {
    placeholder: ph,
    projectTopic,
    projectId,
    promptContents,
    existingDefinitions: existingDefs,
    model = DEFAULT_MODEL,
    effort,
    temperature,
    chapterId: currentChapterId,
    chapterGenerationId,
    sourceContexts,
    signal,
    editorialBundle,
  } = params;
  // Phase 0: Direct resolution
  const direct = resolveDirectly(ph.name, projectTopic);
  if (direct) {
    return { name: ph.name, definition: direct, status: "completed" as const, sources: [], provider: "direct" };
  }

  // Classify once for Phase 1.
  // May be overridden by editorial brief evidence contracts below.
  let provider = inferPlaceholderProvider(ph.name, ph.function);

  // Evidence-driven override from editorial brief contract.
  // When an editorial brief exists and the current chapter has an evidence need
  // for this placeholder, the contract overrides both provider and query.
  let evidenceQuery: string | undefined;
  let isRequiredEvidence = false;
  let evidenceSourceIds: string[] | undefined;

  if (editorialBundle && currentChapterId) {
    const contract = editorialBundle.contracts.find(
      (c) => c.chapterId === currentChapterId,
    );
    if (contract) {
      const evidenceNeed = contract.evidenceNeeds.find(
        (en) => en.placeholderName === ph.name,
      );
      if (evidenceNeed) {
        evidenceQuery = evidenceNeed.query;
        isRequiredEvidence = evidenceNeed.required;
        evidenceSourceIds = editorialBundle.evidenceSourceIds;

        // Required evidence must come from approved sources. Optional needs
        // keep the natural provider classification instead of turning every
        // conceptual or stylistic placeholder into RAG.
        if (evidenceNeed.required) {
          provider = "rag";
        }
      }
    }
  }

  // Cross-chapter reuse: only for placeholders without evidence needs.
  // Optional needs may remain LLM-classified, but still require a fresh
  // chapter-specific definition instead of reusing another chapter's output.
  if (currentChapterId && !evidenceSourceIds) {
    if (provider !== "rag" && provider !== "direct") {
      const otherDefs = await db
        .select({ definition: chapterPlaceholders.definition })
        .from(chapterPlaceholders)
        .innerJoin(chapters, eq(chapters.id, chapterPlaceholders.chapterId))
        .where(
          and(
            eq(chapters.projectId, projectId),
            eq(chapterPlaceholders.name, ph.name),
            isNotNull(chapterPlaceholders.definition),
            not(eq(chapterPlaceholders.chapterId, currentChapterId)),
          ),
        )
        .limit(1);

      if (otherDefs.length > 0 && otherDefs[0].definition) {
        return {
          name: ph.name,
          definition: otherDefs[0].definition,
          status: "completed" as const,
          sources: [],
          provider: "reused",
        };
      }
    }
  }

  // Editorial brief context: market, audience, thesis, voice, and guardrails
  // that constrain placeholder definitions to the project niche.
  let editorialContextSection = "";
  if (editorialBundle && currentChapterId) {
    const scope = renderEditorialData(editorialBundle, { chapterId: currentChapterId });
    if (scope) {
      editorialContextSection = `\n${scope}\n\n`;
    }
  }

  const promptContext = promptContents
    .map((c, i) => `Prompt ${i + 1}: ${c.slice(0, 10000)}${c.length > 10000 ? "..." : ""}`)
    .join("\n\n");

  // Collect source contexts as an array (null-filtered) for the data serializer.
  // Only included for RAG and Semantic Scholar providers.

  // Phase 1: Research — only for RAG and Semantic Scholar providers.
  // Web search removed: LLM-only fills produce higher quality definitions than
  // scraping generic SEO articles that dominate web results for these queries.
  let sources: SearchResult[] = [];
  let ragContext = "";
  let ragChunks = 0;
  let optionalEvidenceEmpty = false;

  const skipResearch = provider === "llm" || provider === "direct";

  if (!skipResearch) {
    const query = evidenceQuery ?? buildSearchQuery(ph, projectTopic);
    if (process.env.NODE_ENV !== "production") {
      console.log(`[placeholder-fill] {${ph.name}} provider=${provider} query="${query}"${evidenceQuery ? " (evidence override)" : ""}`);
    }

    if (provider === "rag") {
      // Required evidence with no approved sources → fail early with clear message
      if (isRequiredEvidence && (!evidenceSourceIds || evidenceSourceIds.length === 0)) {
        throw new RequiredEvidenceMissingError(
          `Required evidence "${ph.name}" has no approved sources in the editorial brief`,
        );
      }

      const ragOptions: { topK: number; tokenBudget: number; sourceIds?: string[] } = {
        topK: 5,
        tokenBudget: 15000,
      };
      // When evidence source IDs are available (even empty), restrict RAG.
      // Empty array → no approved sources → RAG returns empty, LLM warned.
      if (evidenceSourceIds !== undefined) {
        ragOptions.sourceIds = evidenceSourceIds;
      }
      const result = await retrieveContext(query, projectId, ragOptions);
      if (result.contextText) {
        ragContext = result.contextText;
        ragChunks = result.chunks.length;
      } else {
        console.warn(`[placeholder-fill] {${ph.name}} RAG empty for query "${query}"`);
      }
      // Check required evidence: throw if no chunks found in approved sources
      if (isRequiredEvidence && ragChunks === 0) {
        throw new RequiredEvidenceMissingError(
          `Required evidence "${ph.name}" has no matching chunks in approved sources`,
        );
      }
      // Track optional evidence with empty results for prompt-level warning
      if (ragChunks === 0 && evidenceQuery && !isRequiredEvidence) {
        optionalEvidenceEmpty = true;
      }
      // Fall through — empty RAG uses LLM fallback below
    } else if (provider === "semantic-scholar") {
      sources = await searchSemanticScholar(query);
      if (sources.length === 0) {
        console.warn(`[placeholder-fill] {${ph.name}} Semantic Scholar empty for query "${query}"`);
      }
      // Fall through — empty results use LLM fallback below
    }
  }

  // Phase 2: Build marker values for the registry-hosted placeholder-fill prompt.
  // The markers provide structured data; the registry template handles rendering
  // and instruction text so the system prompt is no longer hardcoded here.

  // Collect source contexts as an array (null-filtered) rather than inline text.
  let sourceContextItems: string[] | undefined;
  const includeSourceContext = provider === "rag" || provider === "semantic-scholar";
  const hasSourceContext = includeSourceContext && sourceContexts && sourceContexts.some((s) => s?.trim());
  if (hasSourceContext) {
    sourceContextItems = sourceContexts!
      .map((s) => (s?.trim() ? s.slice(0, 300) + (s.length > 300 ? "..." : "") : null))
      .filter((s): s is string => s !== null);
  }

  const placeholderContext = serializePlaceholderContext({
    placeholderName: ph.name,
    function: ph.function,
    notes: ph.notes,
    projectTopic,
    promptContents,
    sourceContexts: sourceContextItems,
    existingDefinitions: existingDefs,
  });

  const researchResults = serializeResearchResults({
    ragContext: ragContext || undefined,
    sources: sources.length > 0 ? sources : undefined,
    provider,
    evidenceQuery,
    optionalEvidenceEmpty,
    skipResearch,
  });

  const outputSchema = [
    'If sufficient information: {"status":"completed","definition":"definition text"}',
    'If not enough evidence: {"status":"insufficient_evidence","reason":"what evidence is missing"}',
  ].join("\n");

  const baseMarkerValues: Record<string, string> = {
    "{{EDITORIAL_CONTEXT}}": editorialContextSection,
    "{{PLACEHOLDER_CONTEXT}}": placeholderContext,
    "{{RESEARCH_RESULTS}}": researchResults,
    "{{OUTPUT_SCHEMA}}": outputSchema,
  };

  // Phase 3: Generate with versioned prompt (with single retry on validation failure)
  const genResult = await generateAndValidate(
    model,
    projectId,
    ph,
    baseMarkerValues,
    effort,
    temperature,
    signal,
    currentChapterId,
    chapterGenerationId,
  );

  if (genResult.status === "insufficient_evidence") {
    return {
      name: ph.name,
      definition: "",
      status: "insufficient_evidence" as const,
      insufficientReason: genResult.reason,
      sources,
      ragChunks: ragChunks || undefined,
      provider,
      executionIds: genResult.executionIds,
      ...(evidenceQuery ? { evidenceQuery } : {}),
      ...(evidenceSourceIds ? { evidenceSourceIds } : {}),
    };
  }

  return {
    name: ph.name,
    definition: genResult.definition,
    status: "completed" as const,
    sources,
    ragChunks: ragChunks || undefined,
    provider,
    executionIds: genResult.executionIds,
    ...(evidenceQuery ? { evidenceQuery } : {}),
    ...(evidenceSourceIds ? { evidenceSourceIds } : {}),
  };
}
export async function* fillPlaceholdersSequential(
  placeholders: PlaceholderDef[],
  promptContents: string[],
  projectTopic: string | null,
  projectId: string,
  model: string = DEFAULT_MODEL,
  effort?: ReasoningEffort,
  temperature?: number,
  currentChapterId?: string,
  sourceContexts?: (string | null)[],
  signal?: AbortSignal,
  editorialBundle?: EditorialBundle | null,
  chapterGenerationId?: string,
): AsyncGenerator<PlaceholderFillEvent> {
  const total = placeholders.length;
  const existingDefs: Record<string, string> = {};
  let filledCount = 0;
  let failedCount = 0;
  let blockedCount = 0;

  for (let i = 0; i < placeholders.length; i++) {
    if (signal?.aborted) {
      yield { type: "cancelled" as const, current: i, total };
      return;
    }

    const ph = placeholders[i];

    try {
      const fillParams = {
        placeholder: ph,
        projectTopic,
        projectId,
        promptContents,
        existingDefinitions: existingDefs,
        model,
        effort,
        temperature,
        chapterId: currentChapterId,
        chapterGenerationId,
        sourceContexts,
        signal,
        editorialBundle,
      };

      let result;
      try {
        result = await fillOnePlaceholder(fillParams);
      } catch (err) {
        const errorName = (err as Error).name;
        if (
          signal?.aborted
          || err instanceof RequiredEvidenceMissingError
          || errorName === "AbortError"
        ) {
          throw err;
        }
        result = await fillOnePlaceholder(fillParams);
      }

      // Insufficient evidence → blocked, not error. LLM explicitly declared
      // it cannot produce a valid definition with available data.
      if (result.status === "insufficient_evidence") {
        blockedCount++;
        yield {
          type: "blocked",
          name: result.name,
          status: "insufficient_evidence",
          insufficientReason: result.insufficientReason,
          sources: result.sources,
          ragChunks: result.ragChunks,
          provider: result.provider,
          current: i,
          total,
          ...(result.evidenceQuery ? { evidenceQuery: result.evidenceQuery } : {}),
          ...(result.evidenceSourceIds ? { evidenceSourceIds: result.evidenceSourceIds } : {}),
        };
      } else if (result.definition) {
        existingDefs[ph.name] = result.definition;
        filledCount++;
        yield {
          type: "placeholder",
          name: result.name,
          definition: result.definition,
          sources: result.sources,
          ragChunks: result.ragChunks,
          provider: result.provider,
          current: i,
          total,
          ...(result.evidenceQuery ? { evidenceQuery: result.evidenceQuery } : {}),
          ...(result.evidenceSourceIds ? { evidenceSourceIds: result.evidenceSourceIds } : {}),
        };
      } else {
        failedCount++;
        yield {
          type: "error",
          name: ph.name,
          error: `No definition generated for {${ph.name}}`,
          current: i,
          total,
        };
      }
    } catch (err) {
      failedCount++;
      yield {
        type: "error",
        name: ph.name,
        error: `Generation failed: ${(err as Error).message}`,
        current: i,
        total,
      };
    }
  }

  yield { type: "done", total, current: total, filled: filledCount, failed: failedCount, blocked: blockedCount };
}
