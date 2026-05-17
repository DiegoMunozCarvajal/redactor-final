import { task } from "@trigger.dev/sdk";
import { db } from "@/lib/db";
import {
  runs,
  chapterRuns,
  fragments,
  chapters,
  prompts,
  projects,
} from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import {
  generatePromptContent,
  generateChapterAssembly,
} from "@/lib/generate";

export const generateBook = task({
  id: "generate-book",
  run: async (payload: { runId: string }) => {
    const { runId } = payload;

    // Load run with project
    const [run] = await db
      .select()
      .from(runs)
      .where(eq(runs.id, runId))
      .limit(1);
    if (!run) throw new Error(`Run ${runId} not found`);

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, run.projectId))
      .limit(1);
    if (!project) throw new Error(`Project ${run.projectId} not found`);

    // Mark run as running
    await db.update(runs).set({ status: "running" }).where(eq(runs.id, runId));

    // Load all chapters with their prompts
    const chapterList = await db
      .select()
      .from(chapters)
      .where(eq(chapters.bookTemplateId, project.bookTemplateId))
      .orderBy(asc(chapters.position));

    try {
      for (const chapter of chapterList) {
        // Create chapter run
        const [cr] = await db
          .insert(chapterRuns)
          .values({
            runId,
            chapterId: chapter.id,
            position: chapter.position,
            status: "generating_fragments",
          })
          .returning();

        // Load prompts for this chapter
        const promptList = await db
          .select()
          .from(prompts)
          .where(eq(prompts.chapterId, chapter.id))
          .orderBy(asc(prompts.position));

        const contentPrompts = promptList.filter(
          (p) => p.type !== "ensamblaje",
        );
        const assemblyPrompt = promptList.find(
          (p) => p.type === "ensamblaje",
        );

        const fragmentContents: { content: string; type: string }[] = [];

        // Generate each content fragment
        for (const prompt of contentPrompts) {
          const result = await generatePromptContent({
            prompt,
            topic: project.topic,
          });

          const [fragment] = await db
            .insert(fragments)
            .values({
              chapterRunId: cr.id,
              promptId: prompt.id,
              position: prompt.position,
              content: result.text,
              modelUsed: result.model,
              tokensUsed:
                (result.usage?.inputTokens ?? 0) +
                (result.usage?.outputTokens ?? 0),
              metadata: result.provider
                ? { provider: result.provider }
                : undefined,
            })
            .returning();

          fragmentContents.push({
            content: result.text,
            type: prompt.type,
          });
        }

        // Assemble chapter
        if (assemblyPrompt) {
          await db
            .update(chapterRuns)
            .set({ status: "assembling" })
            .where(eq(chapterRuns.id, cr.id));

          const assembled = await generateChapterAssembly(
            assemblyPrompt,
            fragmentContents,
            project.topic,
          );

          await db
            .update(chapterRuns)
            .set({
              status: "completed",
              assembledContent: assembled.text,
            })
            .where(eq(chapterRuns.id, cr.id));
        } else {
          await db
            .update(chapterRuns)
            .set({ status: "completed" })
            .where(eq(chapterRuns.id, cr.id));
        }
      }

      // Generate title using a simple prompt
      const titlePrompt = {
        id: "",
        chapterId: "",
        position: 0,
        type: "cierre" as const,
        title: "Book title",
        content: `Genera un título y subtítulo atractivo para un libro sobre [TEMA]. Responde en formato JSON: { "title": "...", "subtitle": "..." }`,
        styleRules:
          "Español claro. Título memorable, subtítulo descriptivo.",
        knowledgeAreas: null,
        suggestedLength: null,
        createdAt: new Date(),
      };

      const titleResult = await generatePromptContent({
        prompt: titlePrompt,
        topic: project.topic,
      });

      let title = "";
      let subtitle = "";
      try {
        const parsed = JSON.parse(titleResult.text);
        title = parsed.title;
        subtitle = parsed.subtitle;
      } catch {
        title = project.name;
      }

      await db
        .update(runs)
        .set({
          status: "completed",
          title,
          subtitle,
          completedAt: new Date(),
        })
        .where(eq(runs.id, runId));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      await db
        .update(runs)
        .set({ status: "failed", error: message })
        .where(eq(runs.id, runId));
      throw err;
    }
  },
});
