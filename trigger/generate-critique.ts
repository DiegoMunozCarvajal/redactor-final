import { task } from "@trigger.dev/sdk";
import { db } from "@/lib/db";
import { chapterGenerations } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { generateChapterCritique } from "@/lib/generate";
import { getChapterPlaceholders } from "@/lib/placeholders";
import { STALE_TIMEOUT_MS } from "@/lib/api/rate-limit";
import { sanitizeError } from "@/lib/sanitize-error";

export const generateCritique = task({
  id: "generate-critique",
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 5_000,
    maxTimeoutInMs: 60_000,
  },
  run: async (payload: {
    generationId: string;
    projectId: string;
    chapterId: string;
    critiquePrompt: { content: string; userPrompt: string | null };
    contentToCritique: string;
    projectTopic: string | null;
    model?: string;
    effort?: "off" | "max" | "xhigh";
  }) => {
    const {
      generationId,
      chapterId,
      critiquePrompt,
      contentToCritique,
      projectTopic,
      model,
      effort,
    } = payload;

    // Load generation
    const [gen] = await db
      .select()
      .from(chapterGenerations)
      .where(eq(chapterGenerations.id, generationId))
      .limit(1);
    if (!gen) throw new Error(`ChapterGeneration ${generationId} not found`);

    // Terminal states — skip
    const terminalStatuses = ["completed", "failed"];
    if (terminalStatuses.includes(gen.status)) {
      return;
    }

    // Stale recovery — if a previous attempt crashed mid-execution, reset to pending
    if (gen.status === "generating") {
      const staleCutoff = new Date(Date.now() - STALE_TIMEOUT_MS);
      if (gen.createdAt && new Date(gen.createdAt) > staleCutoff) {
        // Fresh — likely a retry racing with the first attempt
        return;
      }
      // Stale — reset to pending and recover below
      await db
        .update(chapterGenerations)
        .set({ status: "pending" })
        .where(eq(chapterGenerations.id, generationId));
      gen.status = "pending";
    }

    // Unrecognized status — fail loudly
    if (gen.status !== "pending") {
      const msg = `Unrecognized generation status "${gen.status}" for ${generationId}`;
      await db
        .update(chapterGenerations)
        .set({ status: "failed", error: msg })
        .where(eq(chapterGenerations.id, generationId));
      throw new Error(msg);
    }

    // Transition pending → generating atomically
    const [updated] = await db
      .update(chapterGenerations)
      .set({ status: "generating" })
      .where(
        and(
          eq(chapterGenerations.id, generationId),
          eq(chapterGenerations.status, "pending"),
        ),
      )
      .returning({ id: chapterGenerations.id });
    if (!updated) {
      // Another process claimed this generation — let it finish
      return;
    }

    try {
      const placeholders = await getChapterPlaceholders(chapterId, projectTopic);

      const result = await generateChapterCritique({
        critiquePrompt,
        content: contentToCritique,
        placeholders,
        model,
        effort,
        projectTopic,
      });

      await db
        .update(chapterGenerations)
        .set({
          status: "completed",
          assembledContent: result.text,
          assemblyMetadata: {
            algorithm: "critique",
            model: result.model,
            fragmentCount: 1,
            tokensUsed:
              (result.usage?.inputTokens ?? 0) +
              (result.usage?.outputTokens ?? 0),
            ...(result.usage?.costUsd != null ? { costUsd: result.usage.costUsd } : {}),
            ...(result.durationMs ? { durationMs: result.durationMs } : {}),
          },
          completedAt: new Date(),
        })
        .where(eq(chapterGenerations.id, generationId));
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
