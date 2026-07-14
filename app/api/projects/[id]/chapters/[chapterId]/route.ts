import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, chapters, chapterGenerations, fragments, prompts } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, asc, desc, and, sql, inArray, isNotNull, ne } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { z } from "zod";
import { loadEditorialBundle } from "@/lib/editorial-brief/context";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; chapterId: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId, chapterId } = await params;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const [chapter] = await db
    .select()
    .from(chapters)
    .where(and(eq(chapters.id, chapterId), eq(chapters.projectId, projectId)))
    .limit(1);
  if (!chapter) {
    return NextResponse.json({ error: "chapter not found" }, { status: 404 });
  }

  // Compute display number: 1-based rank among project chapters sorted by position
  const [rankResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(chapters)
    .where(
      and(
        eq(chapters.projectId, projectId),
        sql`${chapters.position} < ${chapter.position}`,
      ),
    );
  const chapterNumber = (rankResult?.count ?? 0) + 1;

  // All generations for this chapter+project, newest first
  const genList = await db
    .select()
    .from(chapterGenerations)
    .where(
      and(
        eq(chapterGenerations.projectId, projectId),
        eq(chapterGenerations.chapterId, chapterId),
      ),
    )
    .orderBy(desc(chapterGenerations.createdAt));

  // Load fragments for all generations in a single query (was N+1)
  const genIds = genList.map((g) => g.id);
  let allFragments: Array<{
    id: string;
    chapterGenerationId: string;
    projectPromptId: string | null;
    position: number;
    content: string | null;
    modelUsed: string | null;
    tokensUsed: number | null;
    isAssembly: boolean | null;
    createdAt: Date;
  }> = [];
  if (genIds.length > 0) {
    allFragments = await db
      .select({
        id: fragments.id,
        chapterGenerationId: fragments.chapterGenerationId,
        projectPromptId: fragments.projectPromptId,
        position: fragments.position,
        content: fragments.content,
        modelUsed: fragments.modelUsed,
        tokensUsed: fragments.tokensUsed,
        isAssembly: prompts.isAssembly,
        createdAt: fragments.createdAt,
      })
      .from(fragments)
      .leftJoin(prompts, eq(fragments.projectPromptId, prompts.id))
      .where(inArray(fragments.chapterGenerationId, genIds))
      .orderBy(asc(fragments.position));
  }

  // Group by generationId
  const fragsByGenId = new Map<string, typeof allFragments>();
  for (const f of allFragments) {
    const list = fragsByGenId.get(f.chapterGenerationId) ?? [];
    list.push(f);
    fragsByGenId.set(f.chapterGenerationId, list);
  }

  const generationsWithFragments = genList.map((gen) => ({
    ...gen,
    fragments: fragsByGenId.get(gen.id) ?? [],
  }));

  // Load active editorial brief summary for staleness checks
  const activeBundle = await loadEditorialBundle({ projectId }).catch(
    () => null,
  );
  const activeBrief = activeBundle
    ? { id: activeBundle.id, version: activeBundle.version, hash: activeBundle.hash }
    : null;

  return NextResponse.json({
    projectName: project.title ?? project.name,
    projectTopic: project.topic,
    chapter: {
      id: chapter.id,
      position: chapter.position,
      title: chapter.title,
      chapterNumber,
    },
    generations: generationsWithFragments,
    activeBrief,
  });
}

export async function PATCH(
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

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));

  const patchSchema = z.object({
    title: z.string().min(1).max(500).optional(),
    position: z.number().int().min(0).optional(),
  });

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { title, position } = parsed.data;

  if (position !== undefined) {
    const [conflict] = await db
      .select({ id: chapters.id })
      .from(chapters)
      .where(
        and(
          eq(chapters.projectId, projectId),
          eq(chapters.position, position),
          ne(chapters.id, chapterId),
        ),
      )
      .limit(1);
    if (conflict) {
      return NextResponse.json(
        { error: `position ${position} already taken by another chapter` },
        { status: 409 },
      );
    }
  }

  const [chapter] = await db
    .update(chapters)
    .set({
      ...(title !== undefined && { title }),
      ...(position !== undefined && { position }),
    })
    .where(and(eq(chapters.id, chapterId), eq(chapters.projectId, projectId)))
    .returning();

  if (!chapter)
    return NextResponse.json({ error: "chapter not found" }, { status: 404 });

  return NextResponse.json(chapter);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; chapterId: string }> },
) {
  const csrfError = csrfCheck(_req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId, chapterId } = await params;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Verify chapter belongs to project
  const [chapter] = await db
    .select({ id: chapters.id })
    .from(chapters)
    .where(and(eq(chapters.id, chapterId), eq(chapters.projectId, projectId)))
    .limit(1);
  if (!chapter) return NextResponse.json({ error: "chapter not found" }, { status: 404 });

  // Delete associated records in a transaction so partial failure doesn't
  // leave orphaned generations or prompts without a chapter.
  await db.transaction(async (tx) => {
    await tx.delete(chapterGenerations).where(eq(chapterGenerations.chapterId, chapterId));
    await tx.delete(prompts).where(and(eq(prompts.chapterId, chapterId), isNotNull(prompts.projectId)));
    await tx.delete(chapters).where(and(eq(chapters.id, chapterId), eq(chapters.projectId, projectId)));
  });
  return NextResponse.json({ ok: true });
}
