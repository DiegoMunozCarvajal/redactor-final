import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, chapters, chapterGenerations } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, and, desc, sql } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { checkProjectRateLimit, withProjectLock, cleanupStaleGenerations } from "@/lib/api/rate-limit";
import { ensureTriggerConfigured } from "@/lib/trigger/setup";
import { generateCorrection } from "@/trigger/generate-correction";
import { sanitizeError } from "@/lib/sanitize-error";
import { logAudit } from "@/lib/audit";
import { snapshotFromGenerationMetadata, metadataFromSnapshot } from "@/lib/editorial-brief/context";
import { assertTemplateGenerationAllowed } from "@/lib/template-pipeline/authorization";
import { generationBlockedResponse } from "@/lib/template-pipeline/http";
import type { GenerationAuthorization } from "@/lib/template-pipeline/contracts";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; chapterId: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId, chapterId } = await params;

  // Verify project ownership
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.userId !== user.id)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  const [chapter] = await db
    .select()
    .from(chapters)
    .where(and(eq(chapters.id, chapterId), eq(chapters.projectId, projectId)))
    .limit(1);
  if (!chapter)
    return NextResponse.json({ error: "chapter not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const correctorPromptRevisionId = body.correctorPromptRevisionId as string | undefined;
  const critiqueGenerationId = body.critiqueGenerationId as string | undefined;
  const model = body.model as string | undefined;
  const effort = body.effort as "off" | "max" | undefined;

  if (!correctorPromptRevisionId) {
    return NextResponse.json(
      { error: "correctorPromptRevisionId is required" },
      { status: 400 },
    );
  }

  if (!critiqueGenerationId) {
    return NextResponse.json(
      { error: "critiqueGenerationId is required" },
      { status: 400 },
    );
  }

  // Load the critique generation — must be a completed critique output
  const [critiqueGen] = await db
    .select()
    .from(chapterGenerations)
    .where(
      and(
        eq(chapterGenerations.id, critiqueGenerationId),
        eq(chapterGenerations.projectId, projectId),
        eq(chapterGenerations.chapterId, chapterId),
        eq(chapterGenerations.status, "completed"),
        sql`${chapterGenerations.generationMetadata}->>'type' = 'critique'`,
      ),
    )
    .limit(1);

  if (!critiqueGen?.assembledContent) {
    return NextResponse.json(
      { error: "critique generation not found, not completed, or has no content" },
      { status: 400 },
    );
  }

  // Correction inherits editorial snapshot from the critique generation metadata.
  // We do NOT capture the current approved brief — the correction must reference
  // the same brief version that was used for the critique it responds to.
  const critiqueSnapshot = snapshotFromGenerationMetadata(
    critiqueGen.generationMetadata ?? {},
  );

  // Determine what content to correct: use provided content or fetch latest assembly
  let contentToCorrect: string;
  if (body.content && typeof body.content === "string") {
    if (body.content.length > 200_000) {
      return NextResponse.json(
        { error: "content too large, max 200KB" },
        { status: 400 },
      );
    }
    contentToCorrect = body.content;
  } else {
    // Fetch the latest content to correct: prefer the most recent correction,
    // falling back to the original assembly. Exclude critique outputs (we don't
    // correct a critique — we correct content).
    const [latestAssembly] = await db
      .select()
      .from(chapterGenerations)
      .where(
        and(
          eq(chapterGenerations.projectId, projectId),
          eq(chapterGenerations.chapterId, chapterId),
          eq(chapterGenerations.status, "completed"),
          sql`(${chapterGenerations.generationMetadata}->>'type' IS NULL OR ${chapterGenerations.generationMetadata}->>'type' NOT IN ('critique', 'title', 'prompt'))`,
        ),
      )
      .orderBy(desc(chapterGenerations.completedAt))
      .limit(1);

    if (!latestAssembly?.assembledContent) {
      return NextResponse.json(
        { error: "No assembled content found. Assemble the chapter first, or provide content directly." },
        { status: 400 },
      );
    }
    contentToCorrect = latestAssembly.assembledContent;
  }

  // Prompt revision validated at runtime by executeVersionedPrompt
  const resolvedModel = model ?? "claude-sonnet-4-20250514";

  // Authorize generation before acquiring project lock.
  // Source-free projects and templates with clean v2 lineage pass;
  // blocked templates throw GenerationBlockedError (mapped to 409 below).
  let authorization: GenerationAuthorization;
  try {
    authorization = await assertTemplateGenerationAllowed(projectId);
  } catch (error) {
    const blocked = generationBlockedResponse(error);
    if (blocked) return blocked;
    throw error;
  }
  const lockResult = await withProjectLock(projectId, async () => {
    // Clean up stale correction rows before rate check (inside lock for TOCTOU safety).
    await cleanupStaleGenerations(projectId, "correction", { chapterId });

    const rateCheck = await checkProjectRateLimit(projectId);
    if (!rateCheck.allowed) {
      return { rateLimited: true as const, retryAfter: rateCheck.retryAfter };
    }

    const [row] = await db
      .insert(chapterGenerations)
      .values({
        projectId,
        chapterId,
        status: "pending",
        generationMetadata: {
          type: "correction",
          correctorPromptRevisionId,
          model: resolvedModel,
          critiqueGenerationId,
          ...(critiqueSnapshot ? metadataFromSnapshot(critiqueSnapshot) : {}),
          templateAuthorization: authorization,
        },
      })
      .returning();

    return { rateLimited: false as const, gen: row };
  });

  if (!lockResult.locked) {
    return NextResponse.json(
      { error: "project is locked" },
      { status: 409 },
    );
  }

  if (lockResult.result.rateLimited) {
    return NextResponse.json(
      { error: "rate limited", retryAfter: lockResult.result.retryAfter },
      { status: 429, headers: { "Retry-After": String(lockResult.result.retryAfter) } },
    );
  }

  const gen = lockResult.result.gen;

  // Trigger.dev dispatch outside the lock
  try {
    ensureTriggerConfigured();
    await generateCorrection.trigger(
      {
        generationId: gen.id,
        projectId,
        chapterId,
        correctorPromptRevisionId,
        contentToCorrect,
        critiqueContent: critiqueGen.assembledContent!,
        ...(critiqueSnapshot
          ? {
              editorialBriefId: critiqueSnapshot.editorialBriefId,
              editorialBriefVersion: critiqueSnapshot.editorialBriefVersion,
              editorialBriefHash: critiqueSnapshot.editorialBriefHash,
            }
          : {}),
        ...(model ? { model } : {}),
        ...(effort !== undefined ? { effort } : {}),
      },
      { idempotencyKey: gen.id },
    );
  } catch (err) {
    const message = sanitizeError(err);
    await db
      .update(chapterGenerations)
      .set({ status: "failed", error: message })
      .where(eq(chapterGenerations.id, gen.id));
    return NextResponse.json({ error: message }, { status: 502 });
  }

  await logAudit({
    userId: user.id,
    action: "chapter.correction",
    resourceType: "chapter_generation",
    resourceId: gen.id,
    metadata: { projectId, chapterId, correctorPromptRevisionId, critiqueGenerationId },
  });

  return NextResponse.json(gen);
}
