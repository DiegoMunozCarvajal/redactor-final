import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, chapters, chapterGenerations, promptLibrary } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, and, desc, sql } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { checkProjectRateLimit, withProjectLock, cleanupStaleGenerations } from "@/lib/api/rate-limit";
import { DEFAULT_GENERATION_MODEL } from "@/lib/ai/providers";
import { ensureTriggerConfigured } from "@/lib/trigger/setup";
import { generateCritique } from "@/trigger/generate-critique";
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
  const critiquePromptId = body.critiquePromptId as string | undefined;
  const critiquePrompt = body.critiquePrompt as { content: string; userPrompt?: string | null } | undefined;
  const model = body.model as string | undefined;
  const effort = body.effort as "off" | "max" | undefined;

  if (!critiquePromptId && !critiquePrompt) {
    return NextResponse.json(
      { error: "critiquePromptId or critiquePrompt is required" },
      { status: 400 },
    );
  }

  if (critiquePrompt) {
    if (typeof critiquePrompt.content !== "string" || critiquePrompt.content.length === 0) {
      return NextResponse.json(
        { error: "critiquePrompt.content must be a non-empty string" },
        { status: 400 },
      );
    }
    if (critiquePrompt.content.length > 100_000) {
      return NextResponse.json(
        { error: "critiquePrompt.content too large, max 100KB" },
        { status: 400 },
      );
    }
    if (critiquePrompt.userPrompt && critiquePrompt.userPrompt.length > 50_000) {
      return NextResponse.json(
        { error: "critiquePrompt.userPrompt too large, max 50KB" },
        { status: 400 },
      );
    }
  }

  // Determine what content to critique: use provided content or fetch latest assembly
  let contentToCritique: string;
  if (body.content && typeof body.content === "string") {
    if (body.content.length > 200_000) {
      return NextResponse.json(
        { error: "content too large, max 200KB" },
        { status: 400 },
      );
    }
    contentToCritique = body.content;
  } else {
    // Fetch the latest content to critique: prefer the most recent correction,
    // falling back to the original assembly. Exclude critique outputs (we don't
    // critique a critique).
    const [latest] = await db
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

    if (!latest?.assembledContent) {
      return NextResponse.json(
        { error: "No assembled content found. Assemble the chapter first, or provide content directly." },
        { status: 400 },
      );
    }
    contentToCritique = latest.assembledContent;
  }

  // Resolve critique prompt: inline object or library prompt
  let cpContent: string;
  let cpUserPrompt: string | null;
  let cpName: string;

  if (critiquePrompt) {
    cpContent = critiquePrompt.content;
    cpUserPrompt = critiquePrompt.userPrompt ?? null;
    cpName = "Project Critique";
  } else {
    const [cp] = await db
      .select()
      .from(promptLibrary)
      .where(and(eq(promptLibrary.id, critiquePromptId!), eq(promptLibrary.category, "critique")))
      .limit(1);

    if (!cp) {
      return NextResponse.json(
        { error: "critique prompt not found" },
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
        error: `Cannot run critique "${cpName}": missing placeholder definitions: {${missing.replace(/, /g, "}, {")}}. Fill them first.`,
      },
      { status: 400 },
    );
  }

  const resolvedModel = model ?? DEFAULT_GENERATION_MODEL;

  const lockResult = await withProjectLock(projectId, async () => {
    // Clean up stale critique rows before rate check (inside lock for TOCTOU safety).
    await cleanupStaleGenerations(projectId, "critique", { chapterId });

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
          type: "critique",
          promptId: critiquePromptId ?? "inline",
          promptTitle: cpName,
          model: resolvedModel,
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
    await generateCritique.trigger(
      {
        generationId: gen.id,
        projectId,
        chapterId,
        critiquePrompt: {
          content: cpContent,
          userPrompt: cpUserPrompt,
        },
        contentToCritique,
        projectTopic: project.topic,
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
    action: "chapter.critique",
    resourceType: "chapter_generation",
    resourceId: gen.id,
    metadata: { projectId, chapterId, critiquePromptId: critiquePromptId ?? "inline" },
  });

  return NextResponse.json(gen);
}
