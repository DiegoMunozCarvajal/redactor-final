import { task } from "@trigger.dev/sdk";
import { db } from "@/lib/db";
import {
  chapterGenerations,
  projectPrompts,
  fragments,
  projects,
  chapters,
} from "@/lib/db/schema";
import { eq, asc, and } from "drizzle-orm";
import { generatePromptContent, generateChapterAssembly } from "@/lib/generate";
import { getChapterPlaceholders } from "@/lib/placeholders";
import { sanitizeError } from "@/lib/sanitize-error";

export const generateChapter = task({
  id: "generate-chapter",
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 5_000,
    maxTimeoutInMs: 60_000,
  },
  run: async (payload: { generationId: string; projectId: string; model?: string; temperature?: number; effort?: "off" | "max" }) => {
    const { generationId, projectId, model, temperature, effort } = payload;

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

    // Transition pending → generating
    if (gen.status === "pending") {
      await db
        .update(chapterGenerations)
        .set({ status: "generating" })
        .where(eq(chapterGenerations.id, generationId));
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
      const placeholders = await getChapterPlaceholders(gen.chapterId, project.topic);

      for (const prompt of contentPrompts) {
        const result = await generatePromptContent({
          prompt,
          placeholders,
          projectTopic: project.topic,
          ...(model ? { model } : {}),
          ...(temperature !== undefined ? { temperature } : {}),
          ...(effort !== undefined ? { effort } : {}),
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

      // Transition generating → assembling
      await db
        .update(chapterGenerations)
        .set({ status: "assembling" })
        .where(eq(chapterGenerations.id, generationId));

      // Assemble chapter
      if (assemblyPrompt && fragmentContents.length > 0) {
        const assembled = await generateChapterAssembly(
          assemblyPrompt,
          fragmentContents,
          placeholders,
          model,
          temperature,
          effort,
          undefined,
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
        // No assembly prompt configured — mark as awaiting manual assembly
        await db
          .update(chapterGenerations)
          .set({
            status: "awaiting_assembly",
            completedAt: new Date(),
          })
          .where(eq(chapterGenerations.id, generationId));
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
