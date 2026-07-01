import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, chapters } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, asc, sql } from "drizzle-orm";
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

  // Resolve bookTemplateId before the transaction (read-only, no lock needed)
  let bookTemplateId: string | null = null;
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
      .where(eq(chapters.projectId, projectId))
      .for("update");

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
      await copyTemplatePromptsToChapter(tx, templateChapterId, projectId, ch.id);
    }

    return ch;
  });

  return NextResponse.json(chapter);
}
