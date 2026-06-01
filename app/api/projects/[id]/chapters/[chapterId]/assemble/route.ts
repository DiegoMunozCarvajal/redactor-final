import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, chapters, chapterGenerations, fragments, projectPrompts, assemblyPrompts } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, and, asc, inArray } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { checkProjectRateLimit, withProjectLock } from "@/lib/api/rate-limit";
import { generateChapterAssemblyHierarchical, generateChapterAssemblySequential, generateChapterAssemblyHalves, type AssemblyAlgorithm } from "@/lib/generate";
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
  const fragmentIds: string[] = body.fragmentIds ?? [];
  const model = body.model as string | undefined;
  const temperatureRaw = body.temperature;
  const temperature = typeof temperatureRaw === "number" && temperatureRaw >= 0 && temperatureRaw <= 1 ? temperatureRaw : undefined;
  const effort = body.effort as "off" | "max" | undefined;
  const assemblyPromptId = body.assemblyPromptId as string | undefined;
  const assemblyAlgorithm: AssemblyAlgorithm = body.assemblyAlgorithm === "sequential"
    ? "sequential"
    : body.assemblyAlgorithm === "halves"
      ? "halves"
      : "merge-sort";

  if (temperatureRaw !== undefined && (typeof temperatureRaw !== "number" || temperatureRaw < 0 || temperatureRaw > 1)) {
    return NextResponse.json({ error: "temperature must be a number between 0 and 1" }, { status: 400 });
  }

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

  // Load selected fragments with prompt titles
  const selectedFragments = await db
    .select({
      id: fragments.id,
      content: fragments.content,
      position: fragments.position,
      generationId: fragments.chapterGenerationId,
      promptTitle: projectPrompts.title,
    })
    .from(fragments)
    .leftJoin(projectPrompts, eq(fragments.projectPromptId, projectPrompts.id))
    .where(inArray(fragments.id, fragmentIds))
    .orderBy(asc(fragments.position));

  if (selectedFragments.length !== fragmentIds.length) {
    return NextResponse.json(
      { error: "some fragments not found" },
      { status: 400 },
    );
  }

  // Load the assembly prompt — either from the global assembly_prompts table (if assemblyPromptId provided)
  // or from the chapter's embedded project prompt (backward compat).
  let assemblyPrompt: {
    id: string;
    title: string;
    content: string;
    userPrompt?: string | null;
    source: "library" | "chapter";
  } | null = null;

  if (assemblyPromptId) {
    const [ap] = await db
      .select()
      .from(assemblyPrompts)
      .where(eq(assemblyPrompts.id, assemblyPromptId))
      .limit(1);

    if (!ap) {
      return NextResponse.json(
        { error: "assembly prompt not found" },
        { status: 400 },
      );
    }
    assemblyPrompt = {
      id: ap.id,
      title: ap.name,
      content: ap.content,
      userPrompt: ap.userPrompt,
      source: "library",
    };
  } else {
    const [embedded] = await db
      .select()
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
    assemblyPrompt = {
      id: embedded.id,
      title: embedded.title,
      content: embedded.content,
      userPrompt: embedded.userPrompt,
      source: "chapter",
    };
  }

  const placeholders = await getChapterPlaceholders(chapterId, project.topic);
  const missingPlaceholders = getMissingPlaceholderNames(
    [assemblyPrompt.content, assemblyPrompt.userPrompt].filter(Boolean) as string[],
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

  let generationId: string | undefined;

  const lockResult = await withProjectLock(projectId, async () => {
    const rateCheck = await checkProjectRateLimit(projectId);
    if (!rateCheck.allowed) {
      return { rateLimited: true as const, retryAfter: rateCheck.retryAfter };
    }

    // Create generation record inside lock, after rate check,
    // so the check doesn't count this request's own record.
    const [gen] = await db
      .insert(chapterGenerations)
      .values({ projectId, chapterId, status: "assembling" })
      .returning();
    generationId = gen.id;

    try {
      const fragmentContents = selectedFragments.map((f) => ({
        title: f.promptTitle ?? undefined,
        content: f.content ?? "",
      }));
      const assemble = assemblyAlgorithm === "sequential"
        ? generateChapterAssemblySequential
        : assemblyAlgorithm === "halves"
          ? generateChapterAssemblyHalves
          : generateChapterAssemblyHierarchical;

      const assembled = await assemble(
        assemblyPrompt,
        fragmentContents,
        placeholders,
        model,
        temperature,
        effort,
        undefined,
      );

      await db
        .update(chapterGenerations)
        .set({
          status: "completed",
          assembledContent: assembled.text,
          assemblyMetadata: {
            algorithm: assemblyAlgorithm,
            promptId: assemblyPrompt.id,
            promptTitle: assemblyPrompt.title,
            promptSource: assemblyPrompt.source,
            model: assembled.model,
            fragmentCount: fragmentContents.length,
          },
          completedAt: new Date(),
        })
        .where(eq(chapterGenerations.id, gen.id));

      return { generationId: gen.id, assembledContent: assembled.text };
    } catch (err) {
      const message = sanitizeError(err);
      await db
        .update(chapterGenerations)
        .set({ status: "failed", error: message })
        .where(eq(chapterGenerations.id, gen.id));
      throw err;
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
    action: "chapter.assemble",
    resourceType: "chapter_generation",
    resourceId: genId,
    metadata: { projectId, chapterId, fragmentIds },
  });

  return NextResponse.json(lockResult.result);
}
