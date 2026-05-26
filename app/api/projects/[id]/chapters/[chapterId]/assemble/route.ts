import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, chapters, chapterGenerations, fragments, projectPrompts, chapterBriefs, assemblyPrompts } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, and, asc, inArray } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { checkProjectRateLimit, withProjectLock } from "@/lib/api/rate-limit";
import { generateChapterAssembly } from "@/lib/generate";
import { getChapterPlaceholders } from "@/lib/placeholders";
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

  if (temperatureRaw !== undefined && (typeof temperatureRaw !== "number" || temperatureRaw < 0 || temperatureRaw > 1)) {
    return NextResponse.json({ error: "temperature must be a number between 0 and 1" }, { status: 400 });
  }

  if (!Array.isArray(fragmentIds) || fragmentIds.length === 0) {
    return NextResponse.json({ error: "fragmentIds required" }, { status: 400 });
  }

  // Load selected fragments
  const selectedFragments = await db
    .select({
      id: fragments.id,
      content: fragments.content,
      position: fragments.position,
      generationId: fragments.chapterGenerationId,
    })
    .from(fragments)
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
  let assemblyPrompt: { title: string; content: string } | null = null;

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
    assemblyPrompt = { title: ap.name, content: ap.content };
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
    assemblyPrompt = { title: embedded.title, content: embedded.content };
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
      .values({ projectId, chapterId, status: "pending" })
      .returning();
    generationId = gen.id;

    try {
      const fragmentContents = selectedFragments.map((f) => ({
        content: f.content ?? "",
      }));

      const placeholders = await getChapterPlaceholders(chapterId, project.topic);

      const [brief] = await db
        .select({ content: chapterBriefs.content })
        .from(chapterBriefs)
        .where(eq(chapterBriefs.chapterId, chapterId))
        .limit(1);

      const assembled = await generateChapterAssembly(
        assemblyPrompt,
        fragmentContents,
        placeholders,
        model,
        temperature,
        effort,
        undefined,
        brief?.content ?? undefined,
      );

      await db
        .update(chapterGenerations)
        .set({
          status: "completed",
          assembledContent: assembled.text,
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
