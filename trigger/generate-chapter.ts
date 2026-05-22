import { task } from "@trigger.dev/sdk";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  chapterGenerations,
  projectPrompts,
  fragments,
  projects,
  chapters,
} from "@/lib/db/schema";
import { eq, asc, and, isNull } from "drizzle-orm";
import {
  generatePromptContent,
  generateChapterAssembly,
} from "@/lib/generate";
import { getChapterPlaceholders } from "@/lib/placeholders";

const titleResponseSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().optional(),
});

export function sanitizeError(err: unknown): string {
  const message = err instanceof Error ? err.message : "Unknown error";
  // Redact common secret patterns before truncation
  const redacted = message
    .replace(/sk-[a-zA-Z0-9]{24,}/g, "sk-***")
    .replace(/Bearer\s+[a-zA-Z0-9_\-.]{20,}/g, "Bearer ***")
    .replace(/ghp_[a-zA-Z0-9]{36}/g, "ghp_***")
    .replace(/gho_[a-zA-Z0-9]{36}/g, "gho_***");
  return redacted.slice(0, 500);
}

export const generateChapter = task({
  id: "generate-chapter",
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 5_000,
    maxTimeoutInMs: 60_000,
  },
  run: async (payload: { generationId: string; projectId: string; model?: string; temperature?: number }) => {
    const { generationId, projectId, model, temperature } = payload;

    // Load generation
    const [gen] = await db
      .select()
      .from(chapterGenerations)
      .where(eq(chapterGenerations.id, generationId))
      .limit(1);
    if (!gen) throw new Error(`ChapterGeneration ${generationId} not found`);

    // Idempotency guard — if already completed, skip
    if (gen.status === "completed") {
      return;
    }

    // If fragments already exist (partial retry), clean them up before regenerating
    const existingFragments = await db
      .select({ id: fragments.id })
      .from(fragments)
      .where(eq(fragments.chapterGenerationId, generationId));

    if (existingFragments.length > 0) {
      await db.delete(fragments).where(eq(fragments.chapterGenerationId, generationId));
    }

    // Load project
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project) throw new Error(`Project ${projectId} not found`);

    // Load chapter for position info
    const [chapter] = await db
      .select()
      .from(chapters)
      .where(eq(chapters.id, gen.chapterId))
      .limit(1);
    if (!chapter) throw new Error(`Chapter ${gen.chapterId} not found`);

    // Load project prompts for this chapter
    const promptList = await db
      .select()
      .from(projectPrompts)
      .where(
        and(
          eq(projectPrompts.projectId, projectId),
          eq(projectPrompts.chapterId, gen.chapterId),
        ),
      )
      .orderBy(asc(projectPrompts.position));

    const contentPrompts = promptList.filter(
      (p) => !p.isAssembly,
    );
    const assemblyPrompt = promptList.find(
      (p) => p.isAssembly,
    );

    const fragmentContents: { content: string }[] = [];

    try {
      // Generate each content fragment
      const placeholders = await getChapterPlaceholders(gen.chapterId);

      for (const prompt of contentPrompts) {
        const result = await generatePromptContent({
          prompt,
          placeholders,
          ...(model ? { model } : {}),
          ...(temperature !== undefined ? { temperature } : {}),
        });

        await db
          .insert(fragments)
          .values({
            chapterGenerationId: generationId,
            projectPromptId: prompt.id,
            position: prompt.position,
            content: result.text,
            modelUsed: result.model,
            tokensUsed:
              (result.usage?.inputTokens ?? 0) +
              (result.usage?.outputTokens ?? 0),
            metadata: result.provider
              ? { provider: result.provider }
              : undefined,
          });

        fragmentContents.push({
          content: result.text,
        });
      }

      // Assemble chapter
      if (assemblyPrompt && fragmentContents.length > 0) {
        const assembled = await generateChapterAssembly(
          assemblyPrompt,
          fragmentContents,
          placeholders,
          model,
          temperature,
        );

        await db
          .update(chapterGenerations)
          .set({
            status: "completed",
            assembledContent: assembled.text,
            completedAt: new Date(),
          })
          .where(eq(chapterGenerations.id, generationId));
      } else {
        await db
          .update(chapterGenerations)
          .set({
            status: "completed",
            completedAt: new Date(),
          })
          .where(eq(chapterGenerations.id, generationId));
      }

      // Auto-generate title if all chapters completed and no title set
      const allChapters = await db
        .select()
        .from(chapters)
        .where(eq(chapters.projectId, projectId))
        .orderBy(asc(chapters.position));

      const completedGens = await db
        .select()
        .from(chapterGenerations)
        .where(
          and(
            eq(chapterGenerations.projectId, projectId),
            eq(chapterGenerations.status, "completed"),
          ),
        );

      const chapterIds = allChapters.map(c => c.id);
      const completedChapterIds = new Set(completedGens.map(g => g.chapterId));
      const allChaptersHaveCompletedGen = chapterIds.every(id => completedChapterIds.has(id));

      if (allChaptersHaveCompletedGen && !project.title) {
        const titleResult = await generatePromptContent({
          prompt: {
            content:
              'Genera un título y subtítulo atractivo para un libro sobre {tema}. Responde en formato JSON: { "title": "...", "subtitle": "..." }',
          },
          placeholders,
          ...(model ? { model } : {}),
        });
        let title = "";
        let subtitle = "";
        try {
          const parsed = titleResponseSchema.parse(JSON.parse(titleResult.text));
          title = parsed.title;
          subtitle = parsed.subtitle ?? "";
        } catch (err) {
          console.error(
            "[generate-chapter] Failed to parse title JSON:",
            err instanceof Error ? err.message : "Unknown error",
          );
          // Don't set title on parse failure
        }

        if (title) {
          await db
            .update(projects)
            .set({ title, subtitle: subtitle || null })
            .where(
              and(
                eq(projects.id, projectId),
                isNull(projects.title),
              ),
            );
        }
      }
    } catch (err) {
      const message = sanitizeError(err);
      await db
        .update(chapterGenerations)
        .set({ status: "failed", error: message })
        .where(eq(chapterGenerations.id, generationId));
      throw err;
    }
  },
});
