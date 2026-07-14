import { task } from "@trigger.dev/sdk";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { db } from "@/lib/db";
import { prompts, chapterPlaceholders, bookTemplates } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { executeVersionedPrompt } from "@/lib/prompts/executor";
import { writeCurrentChapterPromptRevision } from "@/lib/prompts/chapter-revisions";
import { DEFAULT_GENERATION_MODEL } from "@/lib/ai/providers";
import type { ReasoningEffort } from "@/lib/ai/completion";
import { runSettledWithConcurrency } from "@/lib/promise-pool";
import { assertOriginalEnough } from "@/lib/ai/originality-check";

const placeholderSchema = z.object({
  name: z.string(),
  function: z.string(),
  notes: z.string(),
});

const templateBlockSchema = z.object({
  name: z.string(),
  sourceContext: z.string(),
  function: z.string(),
  content: z.string(),
  placeholders: z.array(placeholderSchema),
  notes: z.string(),
});

const metaPromptOutputSchema = z.object({
  templates: z.array(templateBlockSchema),
});

interface ChapterPayload {
  chapterId: string;
  title: string;
  contentMd: string;
  position: number;
}

export const generateTemplate = task({
  id: "generate-template",
  maxDuration: 600, // 10 minutes — multiple parallel LLM calls across chapters
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 5_000,
    maxTimeoutInMs: 60_000,
  },
  run: async (payload: {
    templateId: string;
    metaPromptRevisionId: string;
    chapters: ChapterPayload[];
    model?: string;
    effort?: ReasoningEffort;
  }) => {
    const { templateId, metaPromptRevisionId, chapters, model = DEFAULT_GENERATION_MODEL, effort } = payload;

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
      // Serialize the output schema for the {{OUTPUT_SCHEMA}} marker — same value
      // across all chapters, so compute once before the concurrency loop.
      const outputSchemaStr = JSON.stringify(
        zodToJsonSchema(metaPromptOutputSchema, { target: 'openApi3', $refStrategy: 'none' }),
        null,
        2,
      );

      // Process chapters concurrently (3 at a time) to avoid sequential timeout.
      // Each chapter's LLM call and DB inserts are independent — safe to parallelize.
      const TEMPLATE_CONCURRENCY = 3;
      const results = await runSettledWithConcurrency(
        chapters,
        TEMPLATE_CONCURRENCY,
        async (chapter) => {
          const capituloFuente = `# ${chapter.title}\n\n${chapter.contentMd}`;

          const { result } = await executeVersionedPrompt({
            stage: 'template-generation',
            kind: 'meta-template',
            revisionId: metaPromptRevisionId,
            bookTemplateId: templateId,
            chapterId: chapter.chapterId,
            markerValues: {
              '{{CAPITULO_FUENTE}}': capituloFuente,
              '{{OUTPUT_SCHEMA}}': outputSchemaStr,
            },
            model,
            schema: metaPromptOutputSchema,
            ...(effort ? { effort } : {}),
          });

          const blocks = result.data.templates;

          if (!blocks || blocks.length === 0) {
            throw new Error(
              `Chapter "${chapter.title}" generated 0 template blocks. The metaprompt may use an unrecognized chapter-content placeholder. Expected a {CAPITULO_*} variant.`,
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
          const placeholderMap = new Map<string, { function: string; notes: string }>();

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
                function: block.function,
                notes: block.notes,
                sourceContext: (block.sourceContext?.slice(0, 300) || null) as string | null,
              }).returning({ id: prompts.id });

              // Create immutable revision so currentRevisionId is never null
              await writeCurrentChapterPromptRevision(inserted.id, null, tx);

              // Collect placeholders (first seen wins for function/notes)
              for (const ph of block.placeholders) {
                if (!placeholderMap.has(ph.name)) {
                  placeholderMap.set(ph.name, { function: ph.function, notes: ph.notes });
                }
              }
            }

            // Upsert placeholders — refresh function/notes on regeneration
            for (const [name, { function: fn, notes }] of placeholderMap) {
              await tx
                .insert(chapterPlaceholders)
                .values({
                  chapterId: chapter.chapterId,
                  name,
                  function: fn,
                  notes,
                })
                .onConflictDoUpdate({
                  target: [chapterPlaceholders.chapterId, chapterPlaceholders.name],
                  set: { function: fn, notes },
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

      // Update template status: ready only if ALL chapters succeeded, failed otherwise.
      const succeededCount = results.filter((r) => r.status === "fulfilled").length;
      const newStatus = succeededCount === chapters.length ? "ready" : "failed";
      await db
        .update(bookTemplates)
        .set({ status: newStatus })
        .where(eq(bookTemplates.id, templateId));
    } catch (err) {
      // Mark as failed so the template doesn't stay "generating" forever.
      // Trigger.dev will retry (up to 3 attempts); the next attempt resets
      // status to "generating" at the top of this function.
      await db
        .update(bookTemplates)
        .set({ status: "failed" })
        .where(eq(bookTemplates.id, templateId))
        .catch(() => {}); // best-effort — don't mask the original error
      throw err;
    }
  },
});
