import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, chapters, prompts, projectPrompts } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, asc, sql } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";

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
  const title = body.title || "New chapter";
  const templateChapterId = body.templateChapterId as string | undefined;

  // Get next position
  const [last] = await db
    .select({ maxPos: sql<number>`coalesce(max(${chapters.position}), -1)::int` })
    .from(chapters)
    .where(eq(chapters.projectId, projectId));

  const position = (last?.maxPos ?? -1) + 1;

  let bookTemplateId: string | null = null;

  // If a template chapter is selected, get its book_template_id
  if (templateChapterId) {
    const [templateCh] = await db
      .select()
      .from(chapters)
      .where(eq(chapters.id, templateChapterId))
      .limit(1);
    if (templateCh) {
      bookTemplateId = templateCh.bookTemplateId;
    }
  }

  const [chapter] = await db
    .insert(chapters)
    .values({
      bookTemplateId,
      projectId,
      position,
      title,
    })
    .returning();

  // Copy prompts from template chapter if selected
  if (templateChapterId) {
    const templatePrompts = await db
      .select()
      .from(prompts)
      .where(eq(prompts.chapterId, templateChapterId))
      .orderBy(asc(prompts.position));

    if (templatePrompts.length > 0) {
      await db.insert(projectPrompts).values(
        templatePrompts.map((p) => ({
          projectId,
          chapterId: chapter.id,
          position: p.position,
          isAssembly: p.isAssembly,
          title: p.title,
          content: p.content,
        })),
      );
    }
  }

  return NextResponse.json(chapter);
}
