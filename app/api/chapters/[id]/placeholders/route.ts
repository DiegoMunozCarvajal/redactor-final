import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chapterPlaceholders, chapters, projects } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, asc } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;

  // Verify ownership: template chapters (projectId IS NULL) are public to
  // authenticated users; project chapters require project ownership.
  const [chapter] = await db
    .select({ projectId: chapters.projectId })
    .from(chapters)
    .where(eq(chapters.id, id))
    .limit(1);

  if (!chapter) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (chapter.projectId !== null) {
    const [project] = await db
      .select({ userId: projects.userId })
      .from(projects)
      .where(eq(projects.id, chapter.projectId))
      .limit(1);
    if (!project || project.userId !== user.id) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
  }

  const rows = await db
    .select()
    .from(chapterPlaceholders)
    .where(eq(chapterPlaceholders.chapterId, id))
    .orderBy(asc(chapterPlaceholders.name));

  return NextResponse.json(rows);
}
