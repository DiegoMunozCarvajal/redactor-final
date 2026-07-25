import { task } from "@trigger.dev/sdk";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  bookTemplates,
  templatePipelineRuns,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { runSettledWithConcurrency } from "@/lib/promise-pool";
import { DEFAULT_GENERATION_MODEL } from "@/lib/ai/providers";
import type { ReasoningEffort } from "@/lib/ai/completion";
import { collectTemplateFields, assertTemplateFieldsClean } from "@/lib/template-pipeline/template-field-scan";
import { buildSourceProfile } from "@/lib/template-pipeline/source-profile";
import { executeVersionedPrompt } from "@/lib/prompts/executor";
import { traceIrSchema, validateTraceIr } from "@/lib/template-pipeline/trace-ir";
import { TEMPLATE_RECIPE_REGISTRY } from "@/lib/template-pipeline/recipes";
import { compileTrace } from "@/lib/template-pipeline/compiler";
import { saveRunArtifact } from "@/lib/template-pipeline/artifacts";
import { finalizeTemplateRun } from "@/lib/template-pipeline/artifacts";
import { normalizeText, computeWordShingles, OriginalityError } from "@/lib/ai/originality-check";
import { sha256Text } from "@/lib/template-pipeline/hash";
import type { TraceIr } from "@/lib/template-pipeline/trace-ir";
import type { CompiledBlock } from "@/lib/template-pipeline/compiler";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChapterPayload {
  chapterId: string;
  title: string;
  contentMd: string;
  position: number;
}

interface ChapterBuildInput {
  pipelineRunId: string;
  bookTemplateId: string;
  chapterId: string;
  title: string;
  contentMd: string;
  profilerRevisionId: string;
  rhetoricRevisionId: string;
  model: string;
  effort?: ReasoningEffort;
}

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

export const generateTemplate = task({
  id: "generate-template",
  maxDuration: 1800, // 30 minutes
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 5_000,
    maxTimeoutInMs: 60_000,
  },
  run: async (payload: {
    templateId: string;
    pipelineRunId: string;
    rhetoricTraceRevisionId: string;
    sourceProfilerRevisionId: string;
    chapters: ChapterPayload[];
    model?: string;
    effort?: ReasoningEffort;
  }) => {
    const {
      templateId,
      pipelineRunId,
      rhetoricTraceRevisionId,
      sourceProfilerRevisionId,
      chapters,
      model = DEFAULT_GENERATION_MODEL,
      effort,
    } = payload;

    // Idempotency guard
    const [current] = await db
      .select({ status: bookTemplates.status })
      .from(bookTemplates)
      .where(eq(bookTemplates.id, templateId))
      .limit(1);

    if (current?.status === "ready") return;

    // Reset to generating
    await db
      .update(bookTemplates)
      .set({ status: "generating" })
      .where(eq(bookTemplates.id, templateId));

    try {
      const TEMPLATE_CONCURRENCY = 3;

      const results = await runSettledWithConcurrency(
        chapters,
        TEMPLATE_CONCURRENCY,
        async (chapter) => {
          return buildChapterArtifact({
            pipelineRunId,
            bookTemplateId: templateId,
            chapterId: chapter.chapterId,
            title: chapter.title,
            contentMd: chapter.contentMd,
            profilerRevisionId: sourceProfilerRevisionId,
            rhetoricRevisionId: rhetoricTraceRevisionId,
            model,
            effort,
          });
        },
      );

      // Report failures
      const failed = results
        .map((r, i) =>
          r.status === "rejected"
            ? `${chapters[i].title}: ${(r.reason as Error)?.message ?? String(r.reason)}`
            : null,
        )
        .filter((s): s is string => s !== null);

      if (failed.length > 0) {
        console.error(
          `Template generation: ${failed.length}/${chapters.length} chapters failed:\n  ${failed.join("\n  ")}`,
        );
      }

      // Classify errors: transient → retry, others → mark accordingly
      const rejected = results.filter((r) => r.status === "rejected");
      const isTransient = (reason: unknown) => {
        const err = reason as Error;
        const msg = err?.message ?? String(reason);
        const name = err?.name ?? "";
        return (
          msg.includes("The user aborted a request") ||
          msg.includes("ERR_STREAM_PREMATURE_CLOSE") ||
          msg.includes("Request was aborted") ||
          name === "AbortError" ||
          name === "TimeoutError" ||
          name === "APIUserAbortError"
        );
      };

      if (rejected.length > 0 && rejected.every((r) => isTransient(r.reason))) {
        throw new Error(`Transient error on ${rejected.length}/${chapters.length} chapters — retrying`);
      }

      const succeededCount = results.filter((r) => r.status === "fulfilled").length;

      if (succeededCount === chapters.length) {
        // All chapters succeeded — finalize atomically
        await finalizeTemplateRun(pipelineRunId);
      } else {
        // Some chapters failed — mark run and template failed
        await db
          .update(bookTemplates)
          .set({ status: "failed" })
          .where(eq(bookTemplates.id, templateId));

        await db
          .update(templatePipelineRuns)
          .set({ status: "failed", completedAt: new Date() })
          .where(eq(templatePipelineRuns.id, pipelineRunId));
      }
    } catch (err) {
      // Mark failed on unhandled errors
      await db
        .update(bookTemplates)
        .set({ status: "failed" })
        .where(eq(bookTemplates.id, templateId))
        .catch(() => {});

      await db
        .update(templatePipelineRuns)
        .set({ status: "failed", completedAt: new Date() })
        .where(eq(templatePipelineRuns.id, pipelineRunId))
        .catch(() => {});

      throw err;
    }
  },
});

// ---------------------------------------------------------------------------
// Chapter artifact builder
// ---------------------------------------------------------------------------

async function buildChapterArtifact(input: ChapterBuildInput) {
  // 1. Build source profile (private, no raw text stored)
  const profile = await buildSourceProfile({
    pipelineRunId: input.pipelineRunId,
    chapterId: input.chapterId,
    bookTemplateId: input.bookTemplateId,
    title: input.title,
    contentMd: input.contentMd,
    profilerRevisionId: input.profilerRevisionId,
    model: input.model,
  });

  // 2. Classify rhetoric trace with one validation retry
  const trace = await classifyTraceWithOneValidationRetry({
    ...input,
    rhetoricRevisionId: input.rhetoricRevisionId,
  });

  // 3. Validate trace against recipe registry
  const validated = validateTraceIr(trace, TEMPLATE_RECIPE_REGISTRY);

  // 4. Compile deterministically
  const compiled = compileTrace(validated);

  // 5. Check compiled template cleanliness against source profile
  assertCompiledTemplateClean(compiled.blocks, profile.chunks.map(c => ({
    shingles5: new Set(c.lexicalFingerprint.shingles5),
    shingles8: new Set(c.lexicalFingerprint.shingles8),
    text: "", // profile chunks don't store raw text
  })));

  // 6. Save artifact (idempotent upsert)
  return saveRunArtifact({
    pipelineRunId: input.pipelineRunId,
    chapterId: input.chapterId,
    traceIr: validated,
    compiledTemplate: compiled.blocks,
    artifactHash: compiled.artifactHash,
  });
}

// ---------------------------------------------------------------------------
// Trace classifier with one validation retry
// ---------------------------------------------------------------------------

interface TraceClassifierInput {
  chapterId: string;
  title: string;
  contentMd: string;
  bookTemplateId: string;
  rhetoricRevisionId: string;
  model: string;
  effort?: ReasoningEffort;
}

function isTraceOutputError(err: unknown): boolean {
  return err instanceof z.ZodError || (err instanceof Error && err.name === "TraceValidationError");
}

async function classifyTraceWithOneValidationRetry(
  input: TraceClassifierInput,
): Promise<TraceIr> {
  let firstError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await executeTraceClassifier(input);
      return validateTraceIr(result, TEMPLATE_RECIPE_REGISTRY);
    } catch (error) {
      firstError ??= error;
      if (!isTraceOutputError(error) || attempt === 1) throw error;
    }
  }
  throw firstError;
}

async function executeTraceClassifier(
  input: TraceClassifierInput,
): Promise<TraceIr> {
  const capituloFuente = `# ${input.title}\n\n${input.contentMd}`;
  const schemaStr = JSON.stringify(
    { type: "object", properties: { moves: { type: "array" } }, required: ["moves"] },
  );

  const { result } = await executeVersionedPrompt({
    stage: "template-generation",
    kind: "rhetoric-trace",
    revisionId: input.rhetoricRevisionId,
    bookTemplateId: input.bookTemplateId,
    chapterId: input.chapterId,
    markerValues: {
      "{{CAPITULO_FUENTE}}": capituloFuente,
      "{{OUTPUT_SCHEMA}}": schemaStr,
    },
    messagePersistence: {
      mode: "redact-sensitive-markers",
      sensitiveMarkers: ["{{CAPITULO_FUENTE}}"],
    },
    model: input.model,
    schema: traceIrSchema,
    ...(input.effort ? { effort: input.effort } : {}),
  });

  return result.data;
}

// ---------------------------------------------------------------------------
// Stage B compiled template cleanliness check (baseline — expanded in Stage C)
// ---------------------------------------------------------------------------

function assertCompiledTemplateClean(
  blocks: CompiledBlock[],
  profileDocs: Array<{
    shingles5: Set<string>;
    shingles8: Set<string>;
    text: string;
  }>,
): void {
  // 1. Run fail-closed blocklist on every compiled field
  const fields = collectTemplateFields(blocks.map(b => ({
    name: b.name,
    content: b.content,
    userPrompt: b.userPrompt,
    function: b.function,
    sourceContext: b.sourceContext,
    notes: b.notes,
    placeholders: b.placeholders.map(p => ({ name: p.name, function: p.function })),
  })));

  assertTemplateFieldsClean(blocks.map(b => ({
    name: b.name,
    content: b.content,
    userPrompt: b.userPrompt,
    function: b.function,
    sourceContext: b.sourceContext,
    notes: b.notes,
    placeholders: b.placeholders.map(p => ({ name: p.name, function: p.function })),
  })));

  // 2. Hash each field's 5/8-grams and compare against chapter profile
  const THRESHOLD = 0.15;
  for (const field of fields) {
    const normalized = normalizeText(field.value);
    const shingles5 = computeWordShingles(normalized, 5);
    const shingles8 = computeWordShingles(normalized, 8);

    for (const doc of profileDocs) {
      let intersection5 = 0;
      for (const s of shingles5) {
        if (doc.shingles5.has(sha256Text(s))) intersection5++;
      }
      const score5 = shingles5.size > 0 ? intersection5 / shingles5.size : 0;

      let intersection8 = 0;
      for (const s of shingles8) {
        if (doc.shingles8.has(sha256Text(s))) intersection8++;
      }
      const score8 = shingles8.size > 0 ? intersection8 / shingles8.size : 0;

      const maxScore = Math.max(score5, score8);
      if (maxScore > THRESHOLD) {
        throw new OriginalityError(
          {
            passed: false,
            blocklistHits: [],
            shingleSimilarity: maxScore,
            lcsMatch: null,
            flagged: true,
            mode: "full",
          },
          "metaprompt-block",
        );
      }
    }
  }
}
