import { task } from "@trigger.dev/sdk";
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

export const generateChapter = task({
  id: "generate-chapter",
  run: async (payload: { generationId: string; projectId: string }) => {
    const { generationId, projectId } = payload;

    // Load generation
    const [gen] = await db
      .select()
      .from(chapterGenerations)
      .where(eq(chapterGenerations.id, generationId))
      .limit(1);
    if (!gen) throw new Error(`ChapterGeneration ${generationId} not found`);

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
      (p) => p.type !== "ensamblaje",
    );
    const assemblyPrompt = promptList.find(
      (p) => p.type === "ensamblaje",
    );

    const fragmentContents: { content: string; type: string }[] = [];

    try {
      // Generate each content fragment
      for (const prompt of contentPrompts) {
        const result = await generatePromptContent({
          prompt,
          topic: project.topic,
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
          type: prompt.type,
        });
      }

      // Assemble chapter
      if (assemblyPrompt && fragmentContents.length > 0) {
        const assembled = await generateChapterAssembly(
          assemblyPrompt,
          fragmentContents,
          project.topic,
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
        .where(eq(chapters.bookTemplateId, project.bookTemplateId))
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

      if (
        completedGens.length >= allChapters.length &&
        !project.title
      ) {
        const titleResult = await generatePromptContent({
          prompt: {
            content:
              'Genera un título y subtítulo atractivo para un libro sobre [TEMA]. Responde en formato JSON: { "title": "...", "subtitle": "..." }',
            styleRules:
              "Español claro. Título memorable, subtítulo descriptivo.",
            knowledgeAreas: null,
            suggestedLength: null,
          },
          topic: project.topic,
        });

        let title = "";
        let subtitle = "";
        try {
          const parsed = JSON.parse(titleResult.text);
          title = parsed.title;
          subtitle = parsed.subtitle;
        } catch {
          // If JSON parse fails, don't set title
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
      const message = err instanceof Error ? err.message : "Unknown error";
      await db
        .update(chapterGenerations)
        .set({ status: "failed", error: message })
        .where(eq(chapterGenerations.id, generationId));
      throw err;
    }
  },
});
