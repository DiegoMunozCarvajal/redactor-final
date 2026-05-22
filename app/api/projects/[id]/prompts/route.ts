import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, projectPrompts } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, asc } from "drizzle-orm";
import { syncChapterPlaceholders } from "@/lib/placeholders";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId } = await params;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const chapterId = req.nextUrl.searchParams.get("chapterId");

  const promptList = await db
    .select()
    .from(projectPrompts)
    .where(
      chapterId
        ? eq(projectPrompts.chapterId, chapterId)
        : eq(projectPrompts.projectId, projectId),
    )
    .orderBy(asc(projectPrompts.position));

  return NextResponse.json(promptList);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId } = await params;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await req.json();
  const { chapterId, title, content, isAssembly } = body;

  if (!chapterId || !title || !content) {
    return NextResponse.json(
      { error: "chapterId, title, and content are required" },
      { status: 400 },
    );
  }

  // Get max position for this chapter
  const existing = await db
    .select()
    .from(projectPrompts)
    .where(eq(projectPrompts.chapterId, chapterId))
    .orderBy(asc(projectPrompts.position));
  const maxPos = existing.reduce((max, p) => Math.max(max, p.position), -1);

  const [prompt] = await db
    .insert(projectPrompts)
    .values({
      projectId,
      chapterId,
      title,
      content,
      position: maxPos + 1,
      isAssembly: isAssembly ?? false,
    })
    .returning();

  // Sync placeholders
  const allPrompts = await db
    .select({ content: projectPrompts.content })
    .from(projectPrompts)
    .where(eq(projectPrompts.chapterId, chapterId));
  await syncChapterPlaceholders(chapterId, allPrompts.map((p) => p.content));

  return NextResponse.json(prompt);
}
