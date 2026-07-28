import { createHash } from "node:crypto";
import { executeVersionedPrompt } from "@/lib/prompts/executor";
import { DEFAULT_GENERATION_MODEL } from "@/lib/ai/providers";
import { editorialBriefBundleInputSchema, editorialBriefContentSchemaV3 } from "@/lib/editorial-brief/schema";
import type { EditorialBriefContent, EditorialBriefContentV3, ChapterEditorialContract } from "@/lib/editorial-brief/schema";
import { zodToJsonSchema } from "zod-to-json-schema";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum allowed source text length. Reject without truncating. */
export const MAX_SOURCE_CHARS = 200_000;

// ---------------------------------------------------------------------------
// Custom errors
// ---------------------------------------------------------------------------

/**
 * Thrown when the research source text exceeds MAX_SOURCE_CHARS.
 * Extraction never truncates — it rejects with a typed error so the
 * caller can split or resize the input explicitly.
 */
export class ExtractionSourceTooLargeError extends Error {
  public readonly actualSize: number;
  public readonly maxSize: number;

  constructor(actualSize: number, maxSize: number = MAX_SOURCE_CHARS) {
    super(
      `Source text exceeds maximum size: ${actualSize.toLocaleString()} characters (max ${maxSize.toLocaleString()})`,
    );
    this.name = "ExtractionSourceTooLargeError";
    this.actualSize = actualSize;
    this.maxSize = maxSize;
  }
}

/**
 * Thrown when the LLM output passes Zod validation but fails
 * application-level post-conditions: missing chapter ids, foreign
 * chapter ids, or evidence needs referencing unavailable placeholders.
 */
export class ExtractionPostValidationError extends Error {
  public readonly detail: string;

  constructor(message: string, detail: string) {
    super(message);
    this.name = "ExtractionPostValidationError";
    this.detail = detail;
  }
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface ExtractEditorialBriefDraftInput {
  /** Schema version. "3.0" skips chapter contracts and returns content-only. */
  schemaVersion?: "3.0";
  /** Raw research source text to analyze. */
  sourceText: string;
  /** Project ID for prompt resolution and lineage tracking. */
  projectId: string;
  /** The project topic (replaces {tema} in prompts). */
  projectTopic: string;
  /**
   * The chapters that must receive contracts.
   * Every supplied id must appear exactly once in the output.
   */
  chapterContext: Array<{
    chapterId: string;
    title: string;
    /** Semantic content-slot names available in this chapter's prompts. */
    availablePlaceholders: string[];
  }>;
  /** Model ID for the LLM call (defaults to project default). */
  model?: string;
  /** Optional explicit prompt revision ID to use instead of project/global default. */
  promptRevisionId?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Basic XML character escaping.
 *
 * Covers the 5 standard XML predefined entities: &amp; &lt; &gt; &quot; &apos;.
 * Control characters and `]]>` are not valid in the source text per plan
 * constraints, so they are not escaped here.
 *
 * Prevents the LLM from interpreting raw source text as markup, and
 * preserves the distinction between prompt instructions and source data.
 */
function xmlEscape(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ---------------------------------------------------------------------------
// Post-validation
// ---------------------------------------------------------------------------

/**
 * Validate that the contracts match the requested chapter context exactly.
 * - No duplicate chapter ids (each id must appear at most once).
 * - Every supplied chapter id must have a contract (no missing ids).
 * - Every contract chapter id must be in the supplied set (no foreign ids).
 */
function validateContractIds(
  contractChapterIds: string[],
  suppliedIds: Set<string>,
  expectedCount: number,
): void {
  // Check for duplicate chapter ids
  const seen = new Set<string>();
  const duplicateIds: string[] = [];
  for (const id of contractChapterIds) {
    if (seen.has(id)) {
      duplicateIds.push(id);
    } else {
      seen.add(id);
    }
  }
  if (duplicateIds.length > 0) {
    throw new ExtractionPostValidationError(
      `Duplicate chapter id(s): ${[...new Set(duplicateIds)].join(", ")}`,
      `Contracts contain duplicate chapter id(s). Each chapter must have exactly one contract.`,
    );
  }

  // Check foreign ids first — a contract referencing an unknown chapter is a
  // more specific error than a missing contract for a supplied chapter.
  const foreignIds: string[] = [];
  for (const id of contractChapterIds) {
    if (!suppliedIds.has(id)) {
      foreignIds.push(id);
    }
  }
  if (foreignIds.length > 0) {
    throw new ExtractionPostValidationError(
      `Foreign or invented chapter id(s): ${foreignIds.join(", ")}`,
      `Contract(s) reference chapter id(s) not in the supplied chapter context: ${foreignIds.join(", ")}`,
    );
  }

  const missingIds: string[] = [];
  for (const id of suppliedIds) {
    if (!contractChapterIds.includes(id)) {
      missingIds.push(id);
    }
  }
  if (missingIds.length > 0) {
    throw new ExtractionPostValidationError(
      `Missing chapter contract(s): ${missingIds.join(", ")}`,
      `Expected contracts for all ${expectedCount} supplied chapters, but missing contract(s) for: ${missingIds.join(", ")}`,
    );
  }
}

/**
 * Validate that each contract's evidenceNeeds only reference placeholder
 * names available in the corresponding chapter context.
 */
function validateEvidenceNeeds(
  contracts: ChapterEditorialContract[],
  placeholdersByChapter: Map<string, Set<string>>,
): void {
  for (const contract of contracts) {
    const available = placeholdersByChapter.get(contract.chapterId);
    if (!available) {
      throw new ExtractionPostValidationError(
        `Unknown chapter id "${contract.chapterId}" in evidence need validation`,
        `Chapter "${contract.chapterId}" was not found in the supplied chapter context. This should not happen after validateContractIds passes.`,
      );
    }

    for (const need of contract.evidenceNeeds) {
      if (!available.has(need.placeholderName)) {
        throw new ExtractionPostValidationError(
          `Evidence need references unavailable placeholder "${need.placeholderName}" in chapter ${contract.chapterId}`,
          `Chapter ${contract.chapterId} does not have a placeholder named "${need.placeholderName}". Available placeholders: \`${[...available].join("`, `")}\``,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main extraction function
// ---------------------------------------------------------------------------

/**
 * Extract an editorial brief draft from research source text.
 *
 * 1. Rejects source text over MAX_SOURCE_CHARS with a typed error.
 * 2. XML-escapes the source text to prevent prompt injection.
 * 3. Calls executeVersionedPrompt with kind 'editorial-brief-extractor'
 *    and marker values for [[PROJECT_TOPIC]], [[CHAPTER_CONTEXT]],
 *    [[RESEARCH_DOCUMENT]], and [[OUTPUT_SCHEMA]].
 * 4. Records research-document hash plus chapter and placeholder IDs as
 *    data lineage.
 * 5. Post-validates chapter ids, evidence placeholder references, and
 *    centralTopic presence.
 * 6. Returns the parsed bundle with an empty evidenceSourceIds array.
 *
 * The output is always a DRAFT — extraction never approves.
 */
export async function extractEditorialBriefDraft(
  input: ExtractEditorialBriefDraftInput,
): Promise<{ draft: { content: EditorialBriefContent | EditorialBriefContentV3; contracts: ChapterEditorialContract[]; evidenceSourceIds: string[] }; executionId: string }> {
  // Step 1: Validate source text length
  if (input.sourceText.length > MAX_SOURCE_CHARS) {
    throw new ExtractionSourceTooLargeError(input.sourceText.length);
  }

  // Step 1b: V3 branch — content-only extraction (no chapter contracts)
  if (input.schemaVersion === "3.0") {
    const escapedSource = xmlEscape(input.sourceText);

    const jsonSchema = zodToJsonSchema(editorialBriefContentSchemaV3, {
      target: "openApi3",
      $refStrategy: "none",
    });
    const outputSchemaStr = JSON.stringify(jsonSchema, null, 2);

    const sourceHash = createHash("sha256").update(input.sourceText).digest("hex");

    const { result, executionId } = await executeVersionedPrompt({
      stage: "editorial-brief-extraction",
      kind: "editorial-brief-extractor",
      projectId: input.projectId,
      revisionId: input.promptRevisionId,
      markerValues: {
        "{{PROJECT_TOPIC}}": input.projectTopic,
        "{{CHAPTER_CONTEXT}}": "",
        "{{RESEARCH_DOCUMENT}}": escapedSource,
        "{{OUTPUT_SCHEMA}}": outputSchemaStr,
      },
      dataLineage: {
        "{{RESEARCH_DOCUMENT}}": {
          sourceHashes: [sourceHash],
        },
      },
      model: input.model ?? DEFAULT_GENERATION_MODEL,
      schema: editorialBriefContentSchemaV3,
    });

    const parsedV3 = result.data;

    // Post-validation: centralTopic must be present and meaningful
    const centralTopic = parsedV3.centralTopic?.trim();
    if (!centralTopic || centralTopic === "-") {
      throw new ExtractionPostValidationError(
        "Extraction produced no centralTopic — the LLM did not infer a topic from the research document.",
        "The extracted brief must include a non-empty centralTopic field.",
      );
    }

    return {
      draft: {
        content: parsedV3,
        contracts: [],
        evidenceSourceIds: [],
      },
      executionId,
    };
  }

  // Step 2: Build marker values
  const escapedSource = xmlEscape(input.sourceText);

  const chapterContextStr = input.chapterContext
    .map(
      (ch, i) =>
        `${i + 1}. **${ch.title}** (id: \`${ch.chapterId}\`)\n   Available placeholders: \`${ch.availablePlaceholders.join("`, `")}\``,
    )
    .join("\n\n");

  const jsonSchema = zodToJsonSchema(editorialBriefBundleInputSchema, {
    target: "openApi3",
    $refStrategy: "none",
  });
  const outputSchemaStr = JSON.stringify(jsonSchema, null, 2);

  // Step 3: Compute lineage data
  const sourceHash = createHash("sha256").update(input.sourceText).digest("hex");
  const chapterIds = input.chapterContext.map((ch) => ch.chapterId);
  const placeholderIds = input.chapterContext.flatMap((ch) => ch.availablePlaceholders);

  // Step 4: Execute via prompt registry
  const { result, executionId } = await executeVersionedPrompt({
    stage: "editorial-brief-extraction",
    kind: "editorial-brief-extractor",
    projectId: input.projectId,
    revisionId: input.promptRevisionId,
    markerValues: {
      "{{PROJECT_TOPIC}}": input.projectTopic,
      "{{CHAPTER_CONTEXT}}": chapterContextStr,
      "{{RESEARCH_DOCUMENT}}": escapedSource,
      "{{OUTPUT_SCHEMA}}": outputSchemaStr,
    },
    dataLineage: {
      "{{RESEARCH_DOCUMENT}}": {
        sourceHashes: [sourceHash],
      },
      "{{CHAPTER_CONTEXT}}": {
        entityIds: [...chapterIds, ...placeholderIds],
      },
    },
    model: input.model ?? DEFAULT_GENERATION_MODEL,
    schema: editorialBriefBundleInputSchema,
  });

  const bundle = result.data;

  // Step 5: Post-validation — chapter id coverage
  const suppliedIds = new Set(input.chapterContext.map((ch) => ch.chapterId));
  const contractIds = bundle.contracts.map((c) => c.chapterId);

  validateContractIds(contractIds, suppliedIds, input.chapterContext.length);

  // Step 6: Post-validation — evidence placeholder names
  const placeholdersByChapter = new Map<string, Set<string>>();
  for (const ch of input.chapterContext) {
    placeholdersByChapter.set(ch.chapterId, new Set(ch.availablePlaceholders));
  }
  validateEvidenceNeeds(bundle.contracts, placeholdersByChapter);

  // Step 6b: Post-validation — centralTopic must be present and meaningful
  const centralTopic = bundle.content.centralTopic?.trim();
  if (!centralTopic || centralTopic === "-") {
    throw new ExtractionPostValidationError(
      "Extraction produced no centralTopic — the LLM did not infer a topic from the research document.",
      "The extracted brief must include a non-empty centralTopic field.",
    );
  }

  // Step 7: Return the bundle with empty evidence source ids
  // Sources are bound later via the project API, not during extraction.
  return {
    draft: {
      ...bundle,
      evidenceSourceIds: [],
    },
    executionId,
  };
}
