import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, chapters } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, sql } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { copyTemplatePromptsToChapter } from "@/lib/db/queries/copy-template-prompts";

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

  // Resolve and validate bookTemplateId before the transaction.
  let bookTemplateId: string | null = null;
  if (templateChapterId) {
    const [templateCh] = await db
      .select({ id: chapters.id, bookTemplateId: chapters.bookTemplateId, projectId: chapters.projectId })
      .from(chapters)
      .where(eq(chapters.id, templateChapterId))
      .limit(1);

    // templateChapterId must exist, be a template chapter (no projectId),
    // and belong to the same bookTemplate as the project.
    if (!templateCh || templateCh.projectId !== null) {
      return NextResponse.json(
        { error: "templateChapterId not found or is not a template chapter" },
        { status: 400 },
      );
    }
    if (project.bookTemplateId && templateCh.bookTemplateId !== project.bookTemplateId) {
      return NextResponse.json(
        { error: "templateChapterId does not belong to the project's book template" },
        { status: 400 },
      );
    }
    bookTemplateId = templateCh.bookTemplateId;
  }

  // Insert chapter, copy template prompts, and sync placeholders atomically.
  // Doing prompt/placeholder copy outside the transaction leaves orphaned state
  // on partial failure and skips placeholder initialization.
  const chapter = await db.transaction(async (tx) => {
    await tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .for("update");

    const [last] = await tx
      .select({ maxPos: sql<number>`coalesce(max(${chapters.position}), -1)::int` })
      .from(chapters)
      .where(eq(chapters.projectId, projectId));

    const position = (last?.maxPos ?? -1) + 1;

    const [ch] = await tx
      .insert(chapters)
      .values({
        bookTemplateId,
        projectId,
        position,
        title,
      })
      .returning();

    // Copy prompts and placeholders from template chapter if selected
    if (templateChapterId) {
      await copyTemplatePromptsToChapter(tx, templateChapterId, projectId, ch.id, user.id);
    }

    return ch;
  });

  return NextResponse.json(chapter);
}
