import { task } from "@trigger.dev/sdk";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { db } from "@/lib/db";
import { prompts, chapterPlaceholders, bookTemplates, templatePipelineRuns } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { executeVersionedPrompt } from "@/lib/prompts/executor";
import { writeCurrentChapterPromptRevision } from "@/lib/prompts/chapter-revisions";
import { serializePromptText } from "@/lib/prompts/placeholder-transform";
import { DEFAULT_GENERATION_MODEL } from "@/lib/ai/providers";
import type { ReasoningEffort } from "@/lib/ai/completion";
import { runSettledWithConcurrency } from "@/lib/promise-pool";
import { assertOriginalEnough } from "@/lib/ai/originality-check";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

// Pass 1: rhetoric trace
const traceEntrySchema = z.object({
  operation: z.string(),
  position: z.number(),
  description: z.string(),
  effectOnReader: z.string(),
});

const rhetoricTraceOutputSchema = z.object({
  trace: z.array(traceEntrySchema),
  assemblyNotes: z.string(),
});

// Pass 2: template blocks (extended — userPrompt is mandatory)
const placeholderSchema = z.object({
  name: z.string(),
  function: z.string(),
});

const templateBlockSchema = z.object({
  name: z.string(),
  function: z.string().optional(),
  content: z.string(),
  userPrompt: z.string(),
  sourceContext: z.string().optional(),
  placeholders: z.array(placeholderSchema),
  notes: z.string().optional(),
});

const templateGeneratorOutputSchema = z.object({
  templates: z.array(templateBlockSchema),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChapterPayload {
  chapterId: string;
  title: string;
  contentMd: string;
  position: number;
}

export const generateTemplate = task({
  id: "generate-template",
  maxDuration: 1800, // 30 minutes — two 10-min LLM calls per chapter + retry headroom
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
    templateGeneratorRevisionId: string;
    chapters: ChapterPayload[];
    model?: string;
    effort?: ReasoningEffort;
  }) => {
    const { templateId, pipelineRunId, rhetoricTraceRevisionId, templateGeneratorRevisionId, chapters, model = DEFAULT_GENERATION_MODEL, effort } = payload;

    // Idempotency guard: if the template already completed successfully,
    // don't reprocess. "failed" is NOT terminal — retries recover from
    // transient LLM errors. Blocking on "failed" would defeat Trigger.dev
    // retries entirely (catch sets failed → next retry sees failed → returns).
    const [current] = await db
      .select({ status: bookTemplates.status })
      .from(bookTemplates)
      .where(eq(bookTemplates.id, templateId))
      .limit(1);

    if (current?.status === "ready") {
      return;
    }

    // Reset status to generating on each attempt (retry-safe).
    // On the final failed attempt, the catch block leaves it as "failed".
    await db
      .update(bookTemplates)
      .set({ status: "generating" })
      .where(eq(bookTemplates.id, templateId));

    try {
      // Serialize output schemas for marker injection. The two passes use
      // different schemas, so compute both JSON strings before the loop.
      const rhetoricTraceSchemaStr = JSON.stringify(
        zodToJsonSchema(rhetoricTraceOutputSchema, { target: 'openApi3', $refStrategy: 'none' }),
        null,
        2,
      );
      const templateGeneratorSchemaStr = JSON.stringify(
        zodToJsonSchema(templateGeneratorOutputSchema, { target: 'openApi3', $refStrategy: 'none' }),
        null,
        2,
      );

      // Process chapters concurrently (3 at a time) to avoid sequential timeout.
      // Each chapter runs two LLM calls in sequence: trace extraction → template generation.
      const TEMPLATE_CONCURRENCY = 3;
      const results = await runSettledWithConcurrency(
        chapters,
        TEMPLATE_CONCURRENCY,
        async (chapter) => {
          const capituloFuente = serializePromptText(`# ${chapter.title}\n\n${chapter.contentMd}`);

          // ---- Pass 1: Extract rhetoric trace ----
          const { result: traceResult } = await executeVersionedPrompt({
            stage: 'template-generation',
            kind: 'rhetoric-trace',
            revisionId: rhetoricTraceRevisionId,
            bookTemplateId: templateId,
            chapterId: chapter.chapterId,
            markerValues: {
              '{{CAPITULO_FUENTE}}': capituloFuente,
              '{{OUTPUT_SCHEMA}}': rhetoricTraceSchemaStr,
            },
            model,
            schema: rhetoricTraceOutputSchema,
            ...(effort ? { effort } : {}),
          });

          // ---- Pass 2: Generate template blocks from trace ----
          const { result: templateResult } = await executeVersionedPrompt({
            stage: 'template-generation',
            kind: 'template-generator',
            revisionId: templateGeneratorRevisionId,
            bookTemplateId: templateId,
            chapterId: chapter.chapterId,
            markerValues: {
              '{{RHETORIC_TRACE}}': JSON.stringify(traceResult.data),
              '{{CAPITULO_FUENTE}}': capituloFuente,
              '{{OUTPUT_SCHEMA}}': templateGeneratorSchemaStr,
            },
            model,
            schema: templateGeneratorOutputSchema,
            ...(effort ? { effort } : {}),
          });

          const blocks = templateResult.data.templates;

          if (!blocks || blocks.length === 0) {
            throw new Error(
              `Chapter "${chapter.title}" generated 0 template blocks. The template-generator prompt may use an unrecognized chapter-content placeholder. Expected a {CAPITULO_*} variant.`,
            );
          }

          // Originality check — advisory only for template generation.
          // Templates are structural: they describe narrative patterns, not
          // final content. Downstream stages (fragment, assembly) enforce
          // strict originality with shingle/LCS checks.
          // Blocklist hits are logged as warnings but don't reject blocks.
          let contaminatedBlocks = 0;
          for (const block of blocks) {
            const result = assertOriginalEnough(block.content, {
              stage: "metaprompt-block",
              throwOnFail: false,
            });
            if (result.flagged) {
              contaminatedBlocks++;
            }
          }
          if (contaminatedBlocks > 0) {
            console.warn(
              `[generate-template] ⚠️  Chapter "${chapter.title}": ${contaminatedBlocks}/${blocks.length} blocks flagged by originality check (advisory — proceeding).`,
            );
          }

          // Deduplicate placeholders across all blocks in this chapter
          const placeholderMap = new Map<string, { function: string }>();

          // Rebuild chapter prompts atomically. Delete stale prompts then insert
          // new ones in one transaction — prevents mixed old/new prompt set on
          // retry if inserts fail partway (which onConflictDoNothing couldn't fix).
          await db.transaction(async (tx) => {
            await tx.delete(prompts).where(eq(prompts.chapterId, chapter.chapterId));
            // Clean up stale placeholders from previous generation attempts
            await tx.delete(chapterPlaceholders).where(eq(chapterPlaceholders.chapterId, chapter.chapterId));

            for (let i = 0; i < blocks.length; i++) {
              const block = blocks[i];

              const [inserted] = await tx.insert(prompts).values({
                chapterId: chapter.chapterId,
                position: i,
                isAssembly: false,
                title: block.name,
                content: block.content,
                userPrompt: block.userPrompt,
                function: block.function ?? null,
                notes: block.notes ?? null,
                sourceContext: (block.sourceContext?.slice(0, 300) || null) as string | null,
              }).returning({ id: prompts.id });

              // Create immutable revision so currentRevisionId is never null
              await writeCurrentChapterPromptRevision(inserted.id, null, tx);

              // Collect placeholders (first seen wins for function)
              for (const ph of block.placeholders) {
                if (!placeholderMap.has(ph.name)) {
                  placeholderMap.set(ph.name, { function: ph.function });
                }
              }
            }

            // Upsert placeholders — refresh function on regeneration
            for (const [name, { function: fn }] of placeholderMap) {
              await tx
                .insert(chapterPlaceholders)
                .values({
                  chapterId: chapter.chapterId,
                  name,
                  function: fn,
                })
                .onConflictDoUpdate({
                  target: [chapterPlaceholders.chapterId, chapterPlaceholders.name],
                  set: { function: fn },
                });
            }
          });
        },
      );

      // Report failures with error details for debugging
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

      // If ALL failures are transient (timeout or network abort), throw so
      // the platform retries instead of leaving the template permanently "failed".
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
        throw new Error(
          `Transient error on ${rejected.length}/${chapters.length} chapters — retrying`,
        );
      }

      // Update template status: ready only if ALL chapters succeeded, failed otherwise.
      const succeededCount = results.filter((r) => r.status === "fulfilled").length;
      const newStatus = succeededCount === chapters.length ? "ready" : "failed";
      await db
        .update(bookTemplates)
        .set({ status: newStatus })
        .where(eq(bookTemplates.id, templateId));

      // Update pipeline run status — legacy v1 runs never set
      // active_pipeline_run_id, so the template stays ineligible.
      if (newStatus === "ready") {
        await db
          .update(templatePipelineRuns)
          .set({ status: "clean", completedAt: new Date() })
          .where(eq(templatePipelineRuns.id, pipelineRunId));
      }
    } catch (err) {
      // Mark template and run as failed so neither stays running forever.
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
