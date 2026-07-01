import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, chapters, chapterGenerations, promptLibrary } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, and, desc, lt, sql, inArray } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { checkProjectRateLimit, withProjectLock, STALE_TIMEOUT_MS } from "@/lib/api/rate-limit";
import { DEFAULT_GENERATION_MODEL } from "@/lib/ai/providers";
import { ensureTriggerConfigured } from "@/lib/trigger/setup";
import { generateCorrection } from "@/trigger/generate-correction";
import { getChapterPlaceholders, getMissingPlaceholderNames } from "@/lib/placeholders";
import { sanitizeError } from "@/lib/sanitize-error";
import { logAudit } from "@/lib/audit";

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
  const correctorPromptId = body.correctorPromptId as string | undefined;
  const correctorPrompt = body.correctorPrompt as { content: string; userPrompt?: string | null } | undefined;
  const critiqueGenerationId = body.critiqueGenerationId as string | undefined;
  const model = body.model as string | undefined;
  const effort = body.effort as "off" | "max" | undefined;

  // Require either correctorPromptId (from library) or correctorPrompt (inline from project prompt)
  if (!correctorPromptId && !correctorPrompt) {
    return NextResponse.json(
      { error: "correctorPromptId or correctorPrompt is required" },
      { status: 400 },
    );
  }

  // Validate inline corrector prompt if provided
  if (correctorPrompt != null) {
    if (typeof correctorPrompt.content !== "string" || correctorPrompt.content.length > 100_000) {
      return NextResponse.json(
        { error: "correctorPrompt.content must be a string under 100KB" },
        { status: 400 },
      );
    }
    if (correctorPrompt.userPrompt !== undefined && correctorPrompt.userPrompt !== null &&
        (typeof correctorPrompt.userPrompt !== "string" || correctorPrompt.userPrompt.length > 50_000)) {
      return NextResponse.json(
        { error: "correctorPrompt.userPrompt must be a string under 50KB" },
        { status: 400 },
      );
    }
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

  // Resolve corrector prompt: inline object or library lookup
  let cpContent: string;
  let cpUserPrompt: string | null;
  let cpName: string;

  if (correctorPrompt) {
    cpContent = correctorPrompt.content;
    cpUserPrompt = correctorPrompt.userPrompt ?? null;
    cpName = "Project Corrector";
  } else {
    const [cp] = await db
      .select()
      .from(promptLibrary)
      .where(and(eq(promptLibrary.id, correctorPromptId!), eq(promptLibrary.category, "corrector")))
      .limit(1);

    if (!cp) {
      return NextResponse.json(
        { error: "corrector prompt not found" },
        { status: 400 },
      );
    }
    cpContent = cp.content;
    cpUserPrompt = cp.userPrompt;
    cpName = cp.name;
  }

  const placeholders = await getChapterPlaceholders(chapterId, project.topic);
  const missingPlaceholders = getMissingPlaceholderNames(
    [cpContent, cpUserPrompt].filter(Boolean) as string[],
    placeholders,
  );
  if (missingPlaceholders.length > 0) {
    const missing = missingPlaceholders.join(", ");
    return NextResponse.json(
      {
        error: `Cannot run corrector "${cpName}": missing placeholder definitions: {${missing.replace(/, /g, "}, {")}}. Fill them first.`,
      },
      { status: 400 },
    );
  }

  const resolvedModel = model ?? DEFAULT_GENERATION_MODEL;

  // Clean up stale correction rows before creating a new one.
  // Checks both "pending" (Trigger.dev never picked it up) and "generating"
  // (crashed mid-execution). Stale pending rows block the rate limiter forever.
  const staleCutoff = new Date(Date.now() - STALE_TIMEOUT_MS);
  const [staleRunning] = await db
    .select({ id: chapterGenerations.id })
    .from(chapterGenerations)
    .where(
      and(
        eq(chapterGenerations.projectId, projectId),
        eq(chapterGenerations.chapterId, chapterId),
        inArray(chapterGenerations.status, ["pending", "generating"]),
        sql`${chapterGenerations.generationMetadata}->>'type' = 'correction'`,
        lt(chapterGenerations.createdAt, staleCutoff),
      ),
    )
    .limit(1);
  if (staleRunning) {
    await db
      .update(chapterGenerations)
      .set({ status: "failed", error: "Stale generation (timed out after 30 minutes)" })
      .where(eq(chapterGenerations.id, staleRunning.id));
  }

  let generationId: string | undefined;

  const lockResult = await withProjectLock(projectId, async () => {
    const rateCheck = await checkProjectRateLimit(projectId);
    if (!rateCheck.allowed) {
      return { rateLimited: true as const, retryAfter: rateCheck.retryAfter };
    }

    let gen: typeof chapterGenerations.$inferSelect | null = null;

    const [row] = await db
      .insert(chapterGenerations)
      .values({
        projectId,
        chapterId,
        status: "pending",
        generationMetadata: {
          type: "correction",
          promptId: correctorPromptId ?? "inline",
          promptTitle: cpName,
          model: resolvedModel,
          critiqueGenerationId,
        },
      })
      .returning();
    gen = row;
    generationId = gen.id;

    try {
      ensureTriggerConfigured();
      await generateCorrection.trigger(
        {
          generationId: gen.id,
          projectId,
          chapterId,
          correctorPrompt: {
            content: cpContent,
            userPrompt: cpUserPrompt,
          },
          contentToCorrect,
          critiqueContent: critiqueGen.assembledContent!,
          projectTopic: project.topic,
          ...(model ? { model } : {}),
          ...(effort !== undefined ? { effort } : {}),
        },
        { idempotencyKey: gen.id },
      );

      return gen;
    } catch (err) {
      const message = sanitizeError(err);
      await db
        .update(chapterGenerations)
        .set({ status: "failed", error: message })
        .where(eq(chapterGenerations.id, gen.id));
      return gen;
    }
  });

  if (!lockResult.locked) {
    return NextResponse.json(
      { error: "project is locked" },
      { status: 409 },
    );
  }

  if ("rateLimited" in lockResult.result && lockResult.result.rateLimited) {
    return NextResponse.json(
      { error: "rate limited", retryAfter: lockResult.result.retryAfter },
      { status: 429 },
    );
  }

  const genId = generationId;
  if (!genId) {
    return NextResponse.json({ error: "failed to create generation" }, { status: 500 });
  }

  logAudit({
    userId: user.id,
    action: "chapter.correction",
    resourceType: "chapter_generation",
    resourceId: genId,
    metadata: { projectId, chapterId, correctorPromptId: correctorPromptId ?? "inline", critiqueGenerationId },
  });

  return NextResponse.json(lockResult.result);
}
