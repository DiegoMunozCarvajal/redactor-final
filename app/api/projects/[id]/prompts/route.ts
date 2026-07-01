import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, chapters, projectPrompts } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, asc, and } from "drizzle-orm";
import { syncChapterPlaceholders } from "@/lib/placeholders";
import { csrfCheck } from "@/lib/api/csrf";

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

  // If filtering by chapter, verify chapter belongs to project
  if (chapterId) {
    const [chapter] = await db
      .select({ id: chapters.id })
      .from(chapters)
      .where(and(eq(chapters.id, chapterId), eq(chapters.projectId, projectId)))
      .limit(1);
    if (!chapter) return NextResponse.json({ error: "chapter not found" }, { status: 404 });
  }

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
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

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

  const body = await req.json().catch(() => ({}));
  const { chapterId, title, content, userPrompt, isAssembly, isCritique, isCorrector } = body;

  // Validate required fields before any DB query
  if (!chapterId || !title || !content) {
    return NextResponse.json(
      { error: "chapterId, title, and content are required" },
      { status: 400 },
    );
  }

  if (
    typeof title !== "string" || title.length > 500 ||
    typeof content !== "string" || content.length > 100_000 ||
    (userPrompt !== undefined && userPrompt !== null && (typeof userPrompt !== "string" || userPrompt.length > 100_000))
  ) {
    return NextResponse.json(
      { error: "title max 500 chars, content/userPrompt max 100KB each" },
      { status: 400 },
    );
  }

  // Verify chapter belongs to project
  const [chapter] = await db
    .select({ id: chapters.id })
    .from(chapters)
    .where(and(eq(chapters.id, chapterId), eq(chapters.projectId, projectId)))
    .limit(1);
  if (!chapter) return NextResponse.json({ error: "chapter not found" }, { status: 404 });

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
      userPrompt,
      position: maxPos + 1,
      isAssembly: isAssembly ?? false,
      isCritique: isCritique ?? false,
      isCorrector: isCorrector ?? false,
    })
    .returning();

  // Sync placeholders
  const allPrompts = await db
    .select({ content: projectPrompts.content, userPrompt: projectPrompts.userPrompt })
    .from(projectPrompts)
    .where(eq(projectPrompts.chapterId, chapterId));
  await syncChapterPlaceholders(
    chapterId,
    allPrompts.flatMap((p) => [p.content, p.userPrompt].filter(Boolean) as string[]),
    project.topic,
  );

  return NextResponse.json(prompt);
}
