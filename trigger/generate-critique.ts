import { task, type Context } from "@trigger.dev/sdk";
import { db } from "@/lib/db";
import { chapterGenerations } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { STALE_TIMEOUT_MS } from "@/lib/api/rate-limit";
import { sanitizeError } from "@/lib/sanitize-error";
import { loadEditorialBundle, snapshotFromGenerationMetadata, renderEditorialData } from "@/lib/editorial-brief/context";
import { runCritique } from "@/lib/review/critique";
import { assertTemplateGenerationAllowed } from "@/lib/template-pipeline/authorization";

/** Per-call LLM timeout. Must be below task maxDuration (600 s) so the
 *  AbortError fires inside the try/catch before a hard task kill. */
const LLM_TIMEOUT_MS = 480_000; // 8 minutes

export const generateCritique = task({
  id: "generate-critique",
  maxDuration: 600,
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
    critiquePromptRevisionId: string;
    contentToCritique: string;
    editorialBriefId?: string;
    editorialBriefVersion?: number;
    editorialBriefHash?: string;
    model?: string;
    effort?: "off" | "max" | "xhigh";
  }, { ctx }: { ctx: Context }) => {
    const {
      generationId,
      projectId,
      chapterId,
      critiquePromptRevisionId,
      contentToCritique,
      model,
      effort,
    } = payload;

    // Re-authorize at execution time — closes the queue-delay race where a
    // template could become quarantined after the API enqueued the task.
    const currentAuthorization = await assertTemplateGenerationAllowed(
      payload.projectId,
    );

    // Load generation
    const [gen] = await db
      .select()
      .from(chapterGenerations)
      .where(eq(chapterGenerations.id, generationId))
      .limit(1);
    if (!gen) throw new Error(`ChapterGeneration ${generationId} not found`);

    // Resolve editorial brief snapshot from generation metadata.
    const critGenSnapshot = snapshotFromGenerationMetadata(
      (gen.generationMetadata as Record<string, unknown> | null) ?? {},
    );

    let critEditorialBundle: Awaited<ReturnType<typeof loadEditorialBundle>> = null;
    if (critGenSnapshot) {
      try {
        critEditorialBundle = await loadEditorialBundle({
          projectId,
          briefId: critGenSnapshot.editorialBriefId,
          expectedHash: critGenSnapshot.editorialBriefHash,
        });
      } catch (err) {
        await db
          .update(chapterGenerations)
          .set({
            status: "failed",
            error: `Editorial brief hash mismatch: ${sanitizeError(err)}`,
          })
          .where(eq(chapterGenerations.id, generationId));
        throw err;
      }
    }

    if (gen.status === "completed") return;

    if (gen.status === "failed") {
      const maxAttempts = ctx.run.maxAttempts ?? 3;
      if (ctx.attempt.number >= maxAttempts) return;
      await db
        .update(chapterGenerations)
        .set({ status: "pending" })
        .where(eq(chapterGenerations.id, generationId));
      gen.status = "pending";
    }

    if (gen.status === "generating") {
      const staleCutoff = new Date(Date.now() - STALE_TIMEOUT_MS);
      if (gen.createdAt && new Date(gen.createdAt) > staleCutoff) return;
      await db
        .update(chapterGenerations)
        .set({ status: "pending" })
        .where(eq(chapterGenerations.id, generationId));
      gen.status = "pending";
    }

    if (gen.status !== "pending") {
      const msg = `Unrecognized generation status "${gen.status}" for ${generationId}`;
      await db
        .update(chapterGenerations)
        .set({ status: "failed", error: msg })
        .where(eq(chapterGenerations.id, generationId));
      throw new Error(msg);
    }

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
    if (!updated) return;

    try {
      const result = await runCritique({
        projectId,
        chapterId,
        chapterGenerationId: generationId,
        model: model ?? "claude-sonnet-4-20250514",
        effort,
        revisionId: critiquePromptRevisionId,
        editorialContext: critEditorialBundle
          ? renderEditorialData(critEditorialBundle, { chapterId }) ?? ""
          : "",
        chapterContent: contentToCritique,
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      });

      await db
        .update(chapterGenerations)
        .set({
          status: "completed",
          assembledContent: result.text,
          assemblyMetadata: {
            algorithm: "critique",
            model,
            fragmentCount: 1,
            critiqueExecutionId: result.executionId,
            tokensUsed: result.usage.totalTokens,
            ...(result.usage.costUsd != null ? { costUsd: result.usage.costUsd } : {}),
            ...(result.durationMs ? { durationMs: result.durationMs } : {}),
          } as Record<string, unknown>,
          completedAt: new Date(),
        })
        .where(eq(chapterGenerations.id, generationId));
    } catch (err) {
      const message = sanitizeError(err);
      const maxAttempts = ctx.run.maxAttempts ?? 3;
      const isLastAttempt = ctx.attempt.number >= maxAttempts;

      await db
        .update(chapterGenerations)
        .set({ status: isLastAttempt ? "failed" : "pending", error: message })
        .where(eq(chapterGenerations.id, generationId));
      throw err;
    }
  },
});
