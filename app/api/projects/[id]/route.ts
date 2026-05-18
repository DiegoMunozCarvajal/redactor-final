import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, chapters, chapterGenerations } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, asc, desc, and } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Load template chapters
  const chapterList = await db
    .select()
    .from(chapters)
    .where(eq(chapters.bookTemplateId, project.bookTemplateId))
    .orderBy(asc(chapters.position));

  // Load latest generation per chapter (scoped to this project)
  const chaptersWithGenerations = await Promise.all(
    chapterList.map(async (ch) => {
      const [latestGen] = await db
        .select()
        .from(chapterGenerations)
        .where(
          and(
            eq(chapterGenerations.projectId, project.id),
            eq(chapterGenerations.chapterId, ch.id),
          ),
        )
        .orderBy(desc(chapterGenerations.createdAt))
        .limit(1);

      return {
        id: ch.id,
        position: ch.position,
        title: ch.title,
        latestGeneration: latestGen ?? null,
      };
    }),
  );

  return NextResponse.json({
    ...project,
    chapters: chaptersWithGenerations,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await req.json();
  const { title, subtitle, topic } = body;

  const [updated] = await db
    .update(projects)
    .set({
      ...(title !== undefined && { title }),
      ...(subtitle !== undefined && { subtitle }),
      ...(topic !== undefined && { topic }),
    })
    .where(eq(projects.id, id))
    .returning();

  return NextResponse.json(updated);
}
