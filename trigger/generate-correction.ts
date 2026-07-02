import { task, type Context } from "@trigger.dev/sdk";
import { db } from "@/lib/db";
import { chapterGenerations } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { generateChapterCorrection } from "@/lib/generate";
import { getChapterPlaceholders } from "@/lib/placeholders";
import { STALE_TIMEOUT_MS } from "@/lib/api/rate-limit";
import { sanitizeError } from "@/lib/sanitize-error";

/** Per-call LLM timeout. Must be below task maxDuration (600 s) so the
 *  AbortError fires inside the try/catch before a hard task kill. */
const LLM_TIMEOUT_MS = 480_000; // 8 minutes

export const generateCorrection = task({
  id: "generate-correction",
  maxDuration: 600, // 10 minutes — headroom for Opus 4.8 + xhigh thinking
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
    correctorPrompt: { content: string; userPrompt: string | null };
    contentToCorrect: string;
    critiqueContent: string;
    projectTopic: string | null;
    model?: string;
    effort?: "off" | "max" | "xhigh";
  }, { ctx }: { ctx: Context }) => {
    const {
      generationId,
      chapterId,
      correctorPrompt,
      contentToCorrect,
      critiqueContent,
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

    // Only "completed" is truly terminal. "failed" is NOT terminal —
    // transient LLM/provider errors should retry. See generate-chapter.ts.
    if (gen.status === "completed") {
      return;
    }

    // Handle "failed" status on retry — reset to pending if attempts remain.
    if (gen.status === "failed") {
      const maxAttempts = ctx.run.maxAttempts ?? 3;
      if (ctx.attempt.number >= maxAttempts) {
        return; // Final attempt already failed — skip
      }
      await db
        .update(chapterGenerations)
        .set({ status: "pending" })
        .where(eq(chapterGenerations.id, generationId));
      gen.status = "pending";
    }

    // Stale recovery — if a previous attempt crashed mid-execution, reset to pending
    if (gen.status === "generating") {
      const staleCutoff = new Date(Date.now() - STALE_TIMEOUT_MS);
      if (gen.createdAt && new Date(gen.createdAt) > staleCutoff) {
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
      return;
    }

    try {
      const placeholders = await getChapterPlaceholders(chapterId, projectTopic);

      const result = await generateChapterCorrection({
        correctorPrompt,
        content: contentToCorrect,
        critiqueContent,
        placeholders,
        model,
        effort,
        projectTopic,
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      });

      // Extract <capitulo_corregido> from the output for clean display
      const capMatch = result.text.match(
        /<capitulo_corregido>([\s\S]*?)<\/capitulo_corregido>/,
      );
      const cleanChapter = capMatch ? capMatch[1].trim() : result.text;

      await db
        .update(chapterGenerations)
        .set({
          status: "completed",
          assembledContent: cleanChapter,
          assemblyMetadata: {
            algorithm: "correction",
            model: result.model,
            fragmentCount: 1,
            correctionRaw: result.text,
          },
          completedAt: new Date(),
        })
        .where(eq(chapterGenerations.id, generationId));
    } catch (err) {
      const message = sanitizeError(err);
      const maxAttempts = ctx.run.maxAttempts ?? 3;
      const isLastAttempt = ctx.attempt.number >= maxAttempts;

      // Reset to pending on non-final attempts so Trigger.dev retry
      // picks up from a clean state rather than seeing "failed".
      await db
        .update(chapterGenerations)
        .set({ status: isLastAttempt ? "failed" : "pending", error: message })
        .where(eq(chapterGenerations.id, generationId));
      throw err;
    }
  },
});
