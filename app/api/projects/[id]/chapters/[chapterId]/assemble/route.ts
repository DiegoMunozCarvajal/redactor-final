import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, chapters, chapterGenerations, fragments, prompts, promptLibrary } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, and, inArray } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { checkProjectRateLimit, withProjectLock, cleanupStaleGenerations } from "@/lib/api/rate-limit";
import { ensureTriggerConfigured } from "@/lib/trigger/setup";
import { generateChapter } from "@/trigger/generate-chapter";
import { getChapterPlaceholders, getMissingPlaceholderNames } from "@/lib/placeholders";
import { sanitizeError } from "@/lib/sanitize-error";
import { logAudit } from "@/lib/audit";
import type { AssemblyAlgorithm } from "@/lib/generate";

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
  const fragmentIds: string[] = body.fragmentIds ?? [];
  const model = body.model as string | undefined;
  const effort = body.effort as "off" | "max" | "xhigh" | undefined;
  const assemblyPromptId = body.assemblyPromptId as string | undefined;
  const assemblyAlgorithm: AssemblyAlgorithm = body.assemblyAlgorithm === "sequential"
    ? "sequential"
    : body.assemblyAlgorithm === "halves"
      ? "halves"
      : "merge-sort";

  if (!Array.isArray(fragmentIds) || fragmentIds.length === 0) {
    return NextResponse.json({ error: "fragmentIds required" }, { status: 400 });
  }

  const MAX_FRAGMENTS = 100;
  if (fragmentIds.length > MAX_FRAGMENTS) {
    return NextResponse.json(
      { error: `too many fragments, max ${MAX_FRAGMENTS}` },
      { status: 400 },
    );
  }

  // Pre-flight: verify fragments exist and belong to this project's chapter
  const selectedFragments = await db
    .select({ id: fragments.id })
    .from(fragments)
    .innerJoin(chapterGenerations, eq(fragments.chapterGenerationId, chapterGenerations.id))
    .where(
      and(
        inArray(fragments.id, fragmentIds),
        eq(chapterGenerations.chapterId, chapterId),
      ),
    );

  if (selectedFragments.length !== fragmentIds.length) {
    return NextResponse.json(
      { error: "some fragments not found" },
      { status: 400 },
    );
  }

  // Pre-flight: verify an assembly prompt will be available at task execution.
  // Priority: explicit assemblyPromptId > project default > chapter embedded.
  if (assemblyPromptId) {
    const [ap] = await db
      .select({ id: promptLibrary.id })
      .from(promptLibrary)
      .where(and(eq(promptLibrary.id, assemblyPromptId), eq(promptLibrary.category, "assembly")))
      .limit(1);

    if (!ap) {
      return NextResponse.json(
        { error: "assembly prompt not found" },
        { status: 400 },
      );
    }
  } else if (!project.assemblyPromptId) {
    // No explicit prompt and no project default — must have chapter-level
    const [embedded] = await db
      .select({ id: prompts.id })
      .from(prompts)
      .where(
        and(
          eq(prompts.chapterId, chapterId),
          eq(prompts.projectId, projectId),
          eq(prompts.isAssembly, true),
        ),
      )
      .limit(1);

    if (!embedded) {
      return NextResponse.json(
        { error: "no assembly prompt configured. Provide assemblyPromptId or configure an assembly prompt for this chapter." },
        { status: 400 },
      );
    }
  }

  // Pre-flight: validate placeholders
  const placeholders = await getChapterPlaceholders(chapterId, project.topic);

  // Resolve which assembly prompt will be used for placeholder validation
  let apContent: string | null = null;
  let apUserPrompt: string | null = null;

  const effectiveAssemblyPromptId = assemblyPromptId ?? project.assemblyPromptId;
  if (effectiveAssemblyPromptId) {
    const [ap] = await db
      .select({ content: promptLibrary.content, userPrompt: promptLibrary.userPrompt })
      .from(promptLibrary)
      .where(and(eq(promptLibrary.id, effectiveAssemblyPromptId), eq(promptLibrary.category, "assembly")))
      .limit(1);
    if (ap) {
      apContent = ap.content;
      apUserPrompt = ap.userPrompt;
    }
  } else {
    const [embedded] = await db
      .select({ content: prompts.content, userPrompt: prompts.userPrompt })
      .from(prompts)
      .where(
        and(
          eq(prompts.chapterId, chapterId),
          eq(prompts.projectId, projectId),
          eq(prompts.isAssembly, true),
        ),
      )
      .limit(1);
    if (embedded) {
      apContent = embedded.content;
      apUserPrompt = embedded.userPrompt;
    }
  }

  const missingPlaceholders = getMissingPlaceholderNames(
    [apContent, apUserPrompt].filter(Boolean) as string[],
    placeholders,
  );
  if (missingPlaceholders.length > 0) {
    const missing = missingPlaceholders.join(", ");
    return NextResponse.json(
      {
        error: `Cannot assemble "${chapter.title}": missing placeholder definitions: {${missing.replace(/, /g, "}, {")}}. Fill them first.`,
      },
      { status: 400 },
    );
  }

  // Serialize rate limit check + generation row insert under advisory lock.
  // Trigger.dev dispatch happens OUTSIDE the lock — never hold advisory lock
  // during external API calls (Trigger.dev is an HTTP API).
  const lockResult = await withProjectLock(projectId, async () => {
    // Clean up stale assembly rows before rate check.
    await cleanupStaleGenerations(projectId, "assembly", {
      chapterId,
      statuses: ["pending", "generating", "assembling"],
    });

    // Rate check BEFORE creating our own row — otherwise it self-counts
    // and always trips MAX_GENERATIONS_PER_WINDOW = 1.
    const rateCheck = await checkProjectRateLimit(projectId);
    if (!rateCheck.allowed) {
      return { rateLimited: true as const, retryAfter: rateCheck.retryAfter };
    }

    const meta = {
      type: "assembly" as const,
      model: model ?? null,
      effort: effort ?? null,
      algorithm: assemblyAlgorithm,
      fragmentIds,
      ...(assemblyPromptId ? { assemblyPromptId } : {}),
    };
    const [row] = await db
      .insert(chapterGenerations)
      .values({
        projectId,
        chapterId,
        status: "pending" as const,
        generationMetadata: meta as typeof chapterGenerations.$inferSelect["generationMetadata"],
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
    await generateChapter.trigger(
      {
        generationId: gen.id,
        projectId,
        ...(model ? { model } : {}),
        ...(effort !== undefined ? { effort } : {}),
        assemblyAlgorithm,
        fragmentIds,
        ...(assemblyPromptId ? { assemblyPromptId } : {}),
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

  logAudit({
    userId: user.id,
    action: "chapter.assemble",
    resourceType: "chapter_generation",
    resourceId: gen.id,
    metadata: { projectId, chapterId, fragmentIds, assemblyAlgorithm },
  });

  return NextResponse.json(gen);
}
