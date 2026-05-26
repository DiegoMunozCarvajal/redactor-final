import { task } from "@trigger.dev/sdk";
import { z } from "zod";
import { db } from "@/lib/db";
import { metaPrompts, prompts, chapterPlaceholders } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateCompletion } from "@/lib/ai/completion";
import { DEFAULT_GENERATION_MODEL } from "@/lib/ai/providers";
import { sanitizeError } from "@/lib/sanitize-error";

const placeholderSchema = z.object({
  name: z.string(),
  function: z.string(),
  notes: z.string(),
});

const templateBlockSchema = z.object({
  name: z.string(),
  function: z.string(),
  content: z.string(),
  placeholders: z.array(placeholderSchema),
  notes: z.string(),
});

const metaPromptOutputSchema = z.object({
  templates: z.array(templateBlockSchema).min(6).max(10),
});

interface ChapterPayload {
  chapterId: string;
  title: string;
  contentMd: string;
  position: number;
}

export const generateTemplate = task({
  id: "generate-template",
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 5_000,
    maxTimeoutInMs: 60_000,
  },
  run: async (payload: {
    templateId: string; // reserved for future use (logging, audit)
    metaPromptId: string;
    chapters: ChapterPayload[];
  }) => {
    const { metaPromptId, chapters } = payload;

    // Load meta-prompt
    const [metaPrompt] = await db
      .select()
      .from(metaPrompts)
      .where(eq(metaPrompts.id, metaPromptId))
      .limit(1);
    if (!metaPrompt) throw new Error(`MetaPrompt ${metaPromptId} not found`);

    const model = DEFAULT_GENERATION_MODEL;

    for (const chapter of chapters) {
      try {
        const userPrompt = `Analiza el siguiente capítulo fuente y genera la biblioteca de prompts. Responde en el mismo idioma del meta-prompt (español). Todos los bloques generados (name, function, content, notes, y valores de placeholders) deben estar en español.\n\n# ${chapter.title}\n\n${chapter.contentMd}`;

        const result = await generateCompletion({
          systemPrompt: metaPrompt.content,
          userPrompt,
          schema: metaPromptOutputSchema,
          model,
        });

        const blocks = result.data.templates;

        // Deduplicate placeholders across all blocks in this chapter
        const placeholderMap = new Map<string, { function: string; notes: string }>();

        for (let i = 0; i < blocks.length; i++) {
          const block = blocks[i];

          // Insert prompt (unique on chapter_id + position — safe on retry)
          await db.insert(prompts).values({
            chapterId: chapter.chapterId,
            position: i,
            isAssembly: false,
            title: block.name,
            content: block.content,
            function: block.function,
            notes: block.notes,
          }).onConflictDoNothing();

          // Collect placeholders (first seen wins for function/notes)
          for (const ph of block.placeholders) {
            if (!placeholderMap.has(ph.name)) {
              placeholderMap.set(ph.name, { function: ph.function, notes: ph.notes });
            }
          }
        }

        // Upsert placeholders — refresh function/notes on regeneration
        for (const [name, { function: fn, notes }] of placeholderMap) {
          await db
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
      } catch (err) {
        console.error(
          `Failed to generate prompts for chapter ${chapter.chapterId}:`,
          sanitizeError(err),
        );
        // Continue with other chapters — one failure doesn't block the rest
      }
    }
  },
});
