import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, chapters, chapterGenerations, chapterPlaceholders, generationSystemPrompts } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, asc, desc, and, inArray, sql } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { logAudit } from "@/lib/audit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  // Load project-scoped chapters — only fields needed for the dashboard listing
  const chapterList = await db
    .select({
      id: chapters.id,
      position: chapters.position,
      title: chapters.title,
    })
    .from(chapters)
    .where(eq(chapters.projectId, project.id))
    .orderBy(asc(chapters.position));

  // Load latest generation per chapter in a single query (was N+1).
  // Exclude title generations — they have no assembledContent and inflate completed counts.
  // Select only needed columns; assembledContent can be 50-200KB per row.
  const allGenerations = await db
    .select({
      id: chapterGenerations.id,
      projectId: chapterGenerations.projectId,
      chapterId: chapterGenerations.chapterId,
      status: chapterGenerations.status,
      generationMetadata: chapterGenerations.generationMetadata,
      assemblyMetadata: chapterGenerations.assemblyMetadata,
      error: chapterGenerations.error,
      createdAt: chapterGenerations.createdAt,
      completedAt: chapterGenerations.completedAt,
    })
    .from(chapterGenerations)
    .where(and(
      eq(chapterGenerations.projectId, project.id),
      sql`${chapterGenerations.generationMetadata}->>'type' IS NULL OR ${chapterGenerations.generationMetadata}->>'type' NOT IN ('title', 'prompt')`,
    ))
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

  // Touch last accessed timestamp
  await db.update(projects)
    .set({ lastAccessedAt: new Date() })
    .where(eq(projects.id, id))
    .execute()
    .catch((err) => console.warn("[projects] Failed to touch lastAccessedAt:", err));

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
  const { title, subtitle, topic, generationSystemPromptId } = body;

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
  if (generationSystemPromptId !== undefined) {
    if (generationSystemPromptId !== null) {
      if (typeof generationSystemPromptId !== "string" || !UUID_RE.test(generationSystemPromptId)) {
        return NextResponse.json({ error: "invalid generationSystemPromptId" }, { status: 400 });
      }
      // Verify FK exists
      const [prompt] = await db
        .select({ id: generationSystemPrompts.id })
        .from(generationSystemPrompts)
        .where(eq(generationSystemPrompts.id, generationSystemPromptId))
        .limit(1);
      if (!prompt) {
        return NextResponse.json({ error: "generationSystemPromptId not found" }, { status: 400 });
      }
    }
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
        ...(generationSystemPromptId !== undefined && { generationSystemPromptId }),
      })
      .where(eq(projects.id, id))
      .returning();

    // Sync {tema} placeholder definition when topic changes.
    // Also updates tema variants (tema_libro, tema_del_libro, topic, etc.)
    if (topic !== undefined && topic !== project.topic) {
      const projectChapterIds = await tx
        .select({ id: chapters.id })
        .from(chapters)
        .where(eq(chapters.projectId, id));

      const chapterIds = projectChapterIds.map((ch) => ch.id);

      if (chapterIds.length > 0) {
        // Fetch all placeholders for all project chapters in a single query
        const allPhRows = await tx
          .select({ chapterId: chapterPlaceholders.chapterId, name: chapterPlaceholders.name })
          .from(chapterPlaceholders)
          .where(inArray(chapterPlaceholders.chapterId, chapterIds));

        // Group tema-variant placeholders by chapter
        const updatesByChapter = new Map<string, string[]>();
        for (const ph of allPhRows) {
          const segments = ph.name.toLowerCase().split("_");
          if (segments.includes("tema") || segments.includes("topic")) {
            const names = updatesByChapter.get(ph.chapterId) ?? [];
            names.push(ph.name);
            updatesByChapter.set(ph.chapterId, names);
          }
        }

        // Batch update all tema variants
        for (const [chId, names] of updatesByChapter) {
          await tx
            .update(chapterPlaceholders)
            .set({ definition: topic })
            .where(
              and(
                eq(chapterPlaceholders.chapterId, chId),
                inArray(chapterPlaceholders.name, names),
              ),
            );
        }
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
