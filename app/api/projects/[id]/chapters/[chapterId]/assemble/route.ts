import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, chapters, chapterGenerations, fragments, projectPrompts, assemblyPrompts } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, and, inArray } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { checkProjectRateLimit, withProjectLock } from "@/lib/api/rate-limit";
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

  // Pre-flight: verify fragments exist
  const selectedFragments = await db
    .select({ id: fragments.id })
    .from(fragments)
    .where(inArray(fragments.id, fragmentIds));

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
      .select({ id: assemblyPrompts.id })
      .from(assemblyPrompts)
      .where(eq(assemblyPrompts.id, assemblyPromptId))
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
      .select({ id: projectPrompts.id })
      .from(projectPrompts)
      .where(
        and(
          eq(projectPrompts.chapterId, chapterId),
          eq(projectPrompts.isAssembly, true),
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
      .select({ content: assemblyPrompts.content, userPrompt: assemblyPrompts.userPrompt })
      .from(assemblyPrompts)
      .where(eq(assemblyPrompts.id, effectiveAssemblyPromptId))
      .limit(1);
    if (ap) {
      apContent = ap.content;
      apUserPrompt = ap.userPrompt;
    }
  } else {
    const [embedded] = await db
      .select({ content: projectPrompts.content, userPrompt: projectPrompts.userPrompt })
      .from(projectPrompts)
      .where(
        and(
          eq(projectPrompts.chapterId, chapterId),
          eq(projectPrompts.isAssembly, true),
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

  // Serialize rate limit check and Trigger.dev dispatch under advisory lock
  let gen: typeof chapterGenerations.$inferSelect | null = null;
  const lockResult = await withProjectLock(projectId, async () => {
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
    gen = row;

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

  const genId = gen!.id;

  logAudit({
    userId: user.id,
    action: "chapter.assemble",
    resourceType: "chapter_generation",
    resourceId: genId,
    metadata: { projectId, chapterId, fragmentIds, assemblyAlgorithm },
  });

  return NextResponse.json(lockResult.result);
}
