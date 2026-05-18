import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, chapters, chapterGenerations, fragments, projectPrompts } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, asc, desc, and } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";

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

  // Load fragments for each generation
  const generationsWithFragments = await Promise.all(
    genList.map(async (gen) => {
      const fragList = await db
        .select({
          id: fragments.id,
          position: fragments.position,
          content: fragments.content,
          modelUsed: fragments.modelUsed,
          tokensUsed: fragments.tokensUsed,
          type: projectPrompts.type,
        })
        .from(fragments)
        .leftJoin(projectPrompts, eq(fragments.projectPromptId, projectPrompts.id))
        .where(eq(fragments.chapterGenerationId, gen.id))
        .orderBy(asc(fragments.position));

      return {
        ...gen,
        fragments: fragList,
      };
    }),
  );

  return NextResponse.json({
    projectName: project.name,
    projectTopic: project.topic,
    chapter: {
      id: chapter.id,
      position: chapter.position,
      title: chapter.title,
    },
    generations: generationsWithFragments,
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

  const body = await req.json();
  const { title, position } = body;

  if (position !== undefined && (position < 0 || position > 1000))
    return NextResponse.json({ error: "position must be 0-1000" }, { status: 400 });

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

  // Delete associated records first (FK restrict)
  await db.delete(chapterGenerations).where(eq(chapterGenerations.chapterId, chapterId));
  await db.delete(projectPrompts).where(eq(projectPrompts.chapterId, chapterId));
  await db.delete(chapters).where(and(eq(chapters.id, chapterId), eq(chapters.projectId, projectId)));
  return NextResponse.json({ ok: true });
}
