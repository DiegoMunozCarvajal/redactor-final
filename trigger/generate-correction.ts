import { task, type Context } from "@trigger.dev/sdk";
import { db } from "@/lib/db";
import { chapterGenerations } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { STALE_TIMEOUT_MS } from "@/lib/api/rate-limit";
import { sanitizeError } from "@/lib/sanitize-error";
import { loadEditorialBundle, snapshotFromGenerationMetadata, renderEditorialData } from "@/lib/editorial-brief/context";
import { runCorrection } from "@/lib/review/correction";
import { assertTemplateGenerationAllowed } from "@/lib/template-pipeline/authorization";
import { runOriginalityGate } from "@/lib/originality/gate";
import {
  OriginalityContaminationError,
  OriginalityDetectorUnavailableError,
} from "@/lib/originality/contracts";

/** Per-call LLM timeout. Must be below task maxDuration (600 s) so the
 *  AbortError fires inside the try/catch before a hard task kill. */
const LLM_TIMEOUT_MS = 480_000; // 8 minutes

export const generateCorrection = task({
  id: "generate-correction",
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
    correctorPromptRevisionId: string;
    contentToCorrect: string;
    critiqueContent: string;
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
      correctorPromptRevisionId,
      contentToCorrect,
      critiqueContent,
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
    const corrGenSnapshot = snapshotFromGenerationMetadata(
      (gen.generationMetadata as Record<string, unknown> | null) ?? {},
    );

    let corrEditorialBundle: Awaited<ReturnType<typeof loadEditorialBundle>> = null;
    if (corrGenSnapshot) {
      try {
        corrEditorialBundle = await loadEditorialBundle({
          projectId,
          briefId: corrGenSnapshot.editorialBriefId,
          expectedHash: corrGenSnapshot.editorialBriefHash,
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
      try {
        await runOriginalityGate({
          context: {
            projectId,
            chapterId,
            chapterGenerationId: generationId,
            stage: "correction",
            fieldPath: "correction.content",
            authorization: currentAuthorization,
          },
          generate: async () => {
            const result = await runCorrection({
              projectId,
              chapterId,
              chapterGenerationId: generationId,
              model: model ?? "claude-sonnet-4-20250514",
              effort,
              revisionId: correctorPromptRevisionId,
              editorialContext: corrEditorialBundle
                ? renderEditorialData(corrEditorialBundle, { chapterId }) ?? ""
                : "",
              chapterContent: contentToCorrect,
              critiqueContent,
              signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
            });

            return {
              value: result,
              text: result.text,
              executionId: result.executionId,
              promptRevisions: { corrector: result.revisionId },
            };
          },
          persistAccepted: async (tx, candidate, assessmentId, lineage) => {
            const result = candidate.value;
            const capMatch = result.text.match(
              /<capitulo_corregido>([\s\S]*?)<\/capitulo_corregido>/,
            );
            const cleanChapter = capMatch ? capMatch[1].trim() : result.text;

            await tx
              .update(chapterGenerations)
              .set({
                status: "completed",
                assembledContent: cleanChapter,
                assemblyMetadata: {
                  algorithm: "correction",
                  model,
                  fragmentCount: 1,
                  correctionRaw: result.text,
                  correctionExecutionId: result.executionId,
                  originalityLineage: lineage,
                  originalityAssessmentId: assessmentId,
                } as Record<string, unknown>,
                completedAt: new Date(),
              })
              .where(eq(chapterGenerations.id, generationId));
            return { entityType: "chapter_generation", entityId: generationId };
          },
        });
      } catch (gateErr) {
        if (gateErr instanceof OriginalityContaminationError) {
          return; // Already quarantined by gate
        }
        if (gateErr instanceof OriginalityDetectorUnavailableError) {
          await db
            .update(chapterGenerations)
            .set({ status: "failed", error: sanitizeError(gateErr) })
            .where(eq(chapterGenerations.id, generationId));
          return;
        }
        throw gateErr; // Let outer catch handle other errors
      }
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
