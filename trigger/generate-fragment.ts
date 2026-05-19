import { task } from "@trigger.dev/sdk";
import { db } from "@/lib/db";
import {
  chapterGenerations,
  projectPrompts,
  fragments,
  projects,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generatePromptContent } from "@/lib/generate";
import { sanitizeError } from "./generate-chapter";

export const generateFragment = task({
  id: "generate-fragment",
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 5_000,
    maxTimeoutInMs: 60_000,
  },
  run: async (payload: {
    generationId: string;
    projectPromptId: string;
    projectId: string;
    model?: string;
    temperature?: number;
  }) => {
    const { generationId, projectPromptId, projectId, model, temperature } = payload;

    // Load generation
    const [gen] = await db
      .select()
      .from(chapterGenerations)
      .where(eq(chapterGenerations.id, generationId))
      .limit(1);
    if (!gen) throw new Error(`ChapterGeneration ${generationId} not found`);

    // Idempotency — skip if already completed or failed
    if (gen.status === "completed" || gen.status === "failed") {
      return { skipped: true, status: gen.status };
    }

    // Load project prompt
    const [prompt] = await db
      .select()
      .from(projectPrompts)
      .where(eq(projectPrompts.id, projectPromptId))
      .limit(1);
    if (!prompt) throw new Error(`ProjectPrompt ${projectPromptId} not found`);

    // Load project
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project) throw new Error(`Project ${projectId} not found`);

    try {
      const result = await generatePromptContent({
        prompt,
        topic: project.topic,
        subtitle: project.subtitle,
        ...(model ? { model } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
      });

      await db.insert(fragments).values({
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

      await db
        .update(chapterGenerations)
        .set({ status: "completed", completedAt: new Date() })
        .where(eq(chapterGenerations.id, generationId));

      return { success: true };
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
