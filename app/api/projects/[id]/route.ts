import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, chapters, chapterGenerations, chapterPlaceholders } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, asc, desc, and } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { logAudit } from "@/lib/audit";

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

  // Load project-scoped chapters
  const chapterList = await db
    .select()
    .from(chapters)
    .where(eq(chapters.projectId, project.id))
    .orderBy(asc(chapters.position));

  // Load latest generation per chapter in a single query (was N+1)
  const allGenerations = await db
    .select()
    .from(chapterGenerations)
    .where(eq(chapterGenerations.projectId, project.id))
    .orderBy(desc(chapterGenerations.createdAt));

  // Group by chapterId — since ordered by createdAt DESC, first match is latest
  const latestByChapterId = new Map<string, typeof allGenerations[number]>();
  for (const gen of allGenerations) {
    if (!latestByChapterId.has(gen.chapterId)) {
      latestByChapterId.set(gen.chapterId, gen);
    }
  }

  const chaptersWithGenerations = chapterList.map((ch) => ({
    id: ch.id,
    position: ch.position,
    title: ch.title,
    latestGeneration: latestByChapterId.get(ch.id) ?? null,
  }));

  return NextResponse.json({
    ...project,
    chapters: chaptersWithGenerations,
  });
}

export async function PATCH(
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

  const { id } = await params;
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const { title, subtitle, topic } = body;

  // Server-side validation
  if (topic !== undefined && (typeof topic !== "string" || topic.length > 500)) {
    return NextResponse.json({ error: "topic too long" }, { status: 400 });
  }
  if (title !== undefined && (typeof title !== "string" || title.length > 300)) {
    return NextResponse.json({ error: "title too long" }, { status: 400 });
  }
  if (subtitle !== undefined && (typeof subtitle !== "string" || subtitle.length > 300)) {
    return NextResponse.json({ error: "subtitle too long" }, { status: 400 });
  }

  // Update project and sync {tema} placeholder in a single transaction
  // so topic change and placeholder sync are atomic
  const updated = await db.transaction(async (tx) => {
    const [u] = await tx
      .update(projects)
      .set({
        ...(title !== undefined && { title }),
        ...(subtitle !== undefined && { subtitle }),
        ...(topic !== undefined && { topic }),
      })
      .where(eq(projects.id, id))
      .returning();

    // Sync {tema} placeholder definition when topic changes
    if (topic !== undefined && topic !== project.topic) {
      const projectChapterIds = await tx
        .select({ id: chapters.id })
        .from(chapters)
        .where(eq(chapters.projectId, id));

      for (const ch of projectChapterIds) {
        await tx
          .update(chapterPlaceholders)
          .set({ definition: topic })
          .where(
            and(
              eq(chapterPlaceholders.chapterId, ch.id),
              eq(chapterPlaceholders.name, "tema"),
            ),
          );
      }
    }

    return u;
  });

  logAudit({
    userId: user.id,
    action: "project.update",
    resourceType: "project",
    resourceId: project.id,
    metadata: { name: project.name },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfError = csrfCheck(_req);
  if (csrfError) return csrfError;

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

  try {
    await db.delete(projects).where(eq(projects.id, id));
  } catch (error) {
    console.error("Failed to delete project", { projectId: id, error });
    return NextResponse.json(
      { error: "Failed to delete project" },
      { status: 500 },
    );
  }

  logAudit({
    userId: user.id,
    action: "project.delete",
    resourceType: "project",
    resourceId: project.id,
    metadata: { name: project.name },
  });

  return NextResponse.json({ ok: true });
}
