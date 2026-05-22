import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, chapters, chapterGenerations, fragments, projectPrompts } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, and, inArray, asc } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { checkProjectRateLimit, withProjectLock } from "@/lib/api/rate-limit";
import { generateChapterAssembly } from "@/lib/generate";
import { getChapterPlaceholders } from "@/lib/placeholders";
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
  const temperature = typeof body.temperature === "number" ? body.temperature : undefined;

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

  // Load the assembly prompt for this chapter
  const [assemblyPrompt] = await db
    .select()
    .from(projectPrompts)
    .where(
      and(
        eq(projectPrompts.chapterId, chapterId),
        eq(projectPrompts.isAssembly, true),
      ),
    )
    .limit(1);

  if (!assemblyPrompt) {
    return NextResponse.json(
      { error: "no assembly prompt configured" },
      { status: 400 },
    );
  }

  // Create a new generation for the assembly
  const [gen] = await db
    .insert(chapterGenerations)
    .values({ projectId, chapterId, status: "generating" })
    .returning();

  const lockResult = await withProjectLock(projectId, async () => {
    const rateCheck = await checkProjectRateLimit(projectId);
    if (!rateCheck.allowed) {
      return { rateLimited: true as const, retryAfter: rateCheck.retryAfter };
    }

    try {
      const fragmentContents = selectedFragments.map((f) => ({
        content: f.content ?? "",
      }));

      const placeholders = await getChapterPlaceholders(chapterId);

      const assembled = await generateChapterAssembly(
        assemblyPrompt,
        fragmentContents,
        placeholders,
        model,
        temperature,
      );

      await db
        .update(chapterGenerations)
        .set({
          status: "completed",
          assembledContent: assembled.text,
          completedAt: new Date(),
        })
        .where(eq(chapterGenerations.id, gen.id));

      // Clean up old "generating" generations that supplied the fragments
      const oldGenIds = [...new Set(selectedFragments.map((f) => f.generationId))];
      await db
        .delete(chapterGenerations)
        .where(inArray(chapterGenerations.id, oldGenIds));

      return { generationId: gen.id, assembledContent: assembled.text };
    } catch (err) {
      const message =
        err instanceof Error ? err.message.slice(0, 500) : "Unknown error";
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

  logAudit({
    userId: user.id,
    action: "chapter.assemble",
    resourceType: "chapter_generation",
    resourceId: gen.id,
    metadata: { projectId, chapterId, fragmentIds },
  });

  return NextResponse.json(lockResult.result);
}
