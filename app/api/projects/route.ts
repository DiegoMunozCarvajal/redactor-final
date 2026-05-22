import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, chapters, prompts, projectPrompts, chapterPlaceholders } from "@/lib/db/schema";
import { chapterGenerations } from "@/lib/db/schema/chapter-generations";
import { createClient } from "@/lib/supabase/server";
import { eq, asc, desc, and, isNull, count, sql, inArray } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { logAudit } from "@/lib/audit";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await db
    .select({
      project: projects,
      chapterCount: count(chapters.id).as("chapterCount"),
      completedCount: sql<number>`count(${chapterGenerations.id}) filter (where ${chapterGenerations.status} = 'completed')`.as("completedCount"),
    })
    .from(projects)
    .leftJoin(chapters, eq(chapters.projectId, projects.id))
    .leftJoin(chapterGenerations, eq(chapterGenerations.chapterId, chapters.id))
    .where(eq(projects.userId, user.id))
    .groupBy(projects.id)
    .orderBy(desc(projects.createdAt));

  const result = rows.map((r) => ({
    ...r.project,
    chapterCount: Number(r.chapterCount),
    completedCount: Number(r.completedCount),
  }));
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { name, bookTemplateId } = body;

  // Server-side validation
  if (typeof name !== "string" || name.length < 1 || name.length > 200) {
    return NextResponse.json({ error: "name must be 1-200 characters" }, { status: 400 });
  }

  let project: typeof projects.$inferSelect;
  try {
    project = await db.transaction(async (tx) => {
      const [p] = await tx
        .insert(projects)
        .values({ userId: user.id, name, bookTemplateId: bookTemplateId ?? null })
        .returning();

      // If a template was selected, copy its chapters as project chapters
      if (bookTemplateId) {
        const templateChapters = await tx
          .select()
          .from(chapters)
          .where(
            and(
              eq(chapters.bookTemplateId, bookTemplateId),
              isNull(chapters.projectId),
            ),
          )
          .orderBy(asc(chapters.position));

        const chapterIdMap = new Map<string, string>();

        for (const chapter of templateChapters) {
          const [projectChapter] = await tx
            .insert(chapters)
            .values({
              bookTemplateId,
              projectId: p.id,
              position: chapter.position,
              title: chapter.title,
            })
            .returning();

          chapterIdMap.set(chapter.id, projectChapter.id);

          const templatePrompts = await tx
            .select()
            .from(prompts)
            .where(eq(prompts.chapterId, chapter.id))
            .orderBy(asc(prompts.position));

          if (templatePrompts.length > 0) {
            await tx.insert(projectPrompts).values(
              templatePrompts.map((prompt) => ({
                projectId: p.id,
                chapterId: projectChapter.id,
                position: prompt.position,
                isAssembly: prompt.isAssembly,
                title: prompt.title,
                content: prompt.content,
              })),
            );
          }
        }

        // Copy template chapter placeholders to project chapters (names only, no definitions)
        const allTemplateChapterIds = templateChapters.map((tc) => tc.id);
        if (allTemplateChapterIds.length > 0) {
          const templatePlaceholders = await tx
            .select()
            .from(chapterPlaceholders)
            .where(inArray(chapterPlaceholders.chapterId, allTemplateChapterIds));

          for (const ph of templatePlaceholders) {
            const projectChapterId = chapterIdMap.get(ph.chapterId);
            if (projectChapterId) {
              await tx
                .insert(chapterPlaceholders)
                .values({ chapterId: projectChapterId, name: ph.name })
                .onConflictDoNothing();
            }
          }
        }
      }

      return p;
    });
  } catch (error) {
    console.error("Failed to create project:", error instanceof Error ? error.message : String(error));
    return NextResponse.json(
      { error: "failed to create project" },
      { status: 500 },
    );
  }

  logAudit({
    userId: user.id,
    action: "project.create",
    resourceType: "project",
    resourceId: project.id,
    metadata: { name: project.name },
  });

  return NextResponse.json(project);
}
