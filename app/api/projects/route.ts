import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, chapters, prompts, chapterPlaceholders, bookTemplates } from "@/lib/db/schema";
import { chapterGenerations } from "@/lib/db/schema/chapter-generations";
import { createClient } from "@/lib/supabase/server";
import { eq, asc, desc, and, isNull, sql, inArray } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { logAudit } from "@/lib/audit";
import { extractPlaceholders } from "@/lib/placeholders";
import { copyTemplatePromptsToChapter } from "@/lib/db/queries/copy-template-prompts";

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
      chapterCount: sql<number>`count(distinct ${chapters.id})`.as("chapterCount"),
      completedCount: sql<number>`count(distinct ${chapterGenerations.chapterId}) filter (where ${chapterGenerations.status} = 'completed')`.as("completedCount"),
    })
    .from(projects)
    .leftJoin(chapters, eq(chapters.projectId, projects.id))
    .leftJoin(chapterGenerations, and(
      eq(chapterGenerations.chapterId, chapters.id),
      sql`(${chapterGenerations.generationMetadata}->>'type' IS NULL OR ${chapterGenerations.generationMetadata}->>'type' NOT IN ('title', 'fill', 'critique', 'prompt'))`,
    ))
    .where(eq(projects.userId, user.id))
    .groupBy(projects.id)
    .orderBy(sql`${projects.lastAccessedAt} DESC NULLS LAST`, desc(projects.createdAt))
    .limit(100);

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
  const { name, topic, title, bookTemplateId } = body;

  // Reject legacy fields — Plan 2 resolves via prompt registry
  if (body.assemblyPromptId !== undefined) {
    return NextResponse.json(
      { error: "assemblyPromptId is deprecated. Configure assembly defaults via prompt-defaults API." },
      { status: 400 },
    );
  }

  // Server-side validation
  if (typeof name !== "string" || name.length < 1 || name.length > 200) {
    return NextResponse.json({ error: "name must be 1-200 characters" }, { status: 400 });
  }
  if (title !== undefined && (typeof title !== "string" || title.length < 1 || title.length > 300)) {
    return NextResponse.json({ error: "title must be 1-300 characters" }, { status: 400 });
  }
  if (topic !== undefined && (typeof topic !== "string" || topic.length > 500)) {
    return NextResponse.json({ error: "topic must be a string of 500 characters or less" }, { status: 400 });
  }

  let project: typeof projects.$inferSelect;
  try {
    project = await db.transaction(async (tx) => {
      // Validate template availability inside the transaction to close
      // the TOCTOU window where an admin changes status between check and insert.
      if (bookTemplateId) {
        const [template] = await tx
          .select({ id: bookTemplates.id, status: bookTemplates.status })
          .from(bookTemplates)
          .where(eq(bookTemplates.id, bookTemplateId))
          .limit(1);
        if (!template) {
          throw { status: 400, message: "template not found" };
        }
        if (template.status !== "ready") {
          throw { status: 400, message: "template is not available" };
        }
      }

      const [p] = await tx
        .insert(projects)
        .values({ userId: user.id, name, title: title?.trim() || null, topic: topic?.trim() || null, bookTemplateId: bookTemplateId ?? null })
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

          await copyTemplatePromptsToChapter(tx, chapter.id, p.id, projectChapter.id, user.id);
        }

        // Sync placeholders from project prompts — catch any {tokens} in prompt
        // content that weren't already in the template's chapterPlaceholders table
        for (const projectChapterId of [...chapterIdMap.values()]) {
          const ppContents = await tx
            .select({ content: prompts.content, userPrompt: prompts.userPrompt })
            .from(prompts)
            .where(and(eq(prompts.chapterId, projectChapterId), eq(prompts.projectId, p.id)));
          const contents = ppContents.flatMap((p) => [p.content, p.userPrompt].filter(Boolean) as string[]);
          const detected = extractPlaceholders(contents);
          if (detected.length > 0) {
            await tx
              .insert(chapterPlaceholders)
              .values(detected.map((name) => ({ chapterId: projectChapterId, name })))
              .onConflictDoNothing();
          }
        }

        // Backfill {tema} placeholder from project topic for all new project chapters.
        // Also handles tema variants (tema_libro, tema_del_libro, topic, etc.)
        if (p.topic) {
          const projectChapterIds = [...chapterIdMap.values()];
          for (const projectChapterId of projectChapterIds) {
            // Fetch any placeholders that are tema variants
            const phRows = await tx
              .select({ name: chapterPlaceholders.name })
              .from(chapterPlaceholders)
              .where(eq(chapterPlaceholders.chapterId, projectChapterId));

            const temaVariantNames = phRows
              .filter((ph) => {
                const segments = ph.name.toLowerCase().split("_");
                return segments.includes("tema") || segments.includes("topic");
              })
              .map((ph) => ph.name);

            // Ensure all tema variants have definitions (single UPDATE with inArray)
            if (temaVariantNames.length > 0) {
              await tx
                .update(chapterPlaceholders)
                .set({ definition: p.topic })
                .where(
                  and(
                    eq(chapterPlaceholders.chapterId, projectChapterId),
                    inArray(chapterPlaceholders.name, temaVariantNames),
                  ),
                );
            }

            // Also ensure a canonical {tema} row exists for prompts that reference it
            await tx
              .insert(chapterPlaceholders)
              .values({ chapterId: projectChapterId, name: "tema", definition: p.topic })
              .onConflictDoUpdate({
                target: [chapterPlaceholders.chapterId, chapterPlaceholders.name],
                set: { definition: p.topic },
              });
          }
        }

      }

      return p;
    });
  } catch (error) {
    // Re-thrown validation errors from inside the transaction (template check)
    if (error && typeof error === "object" && "status" in error && "message" in error) {
      return NextResponse.json(
        { error: (error as { message: string }).message },
        { status: (error as { status: number }).status },
      );
    }
    console.error("Failed to create project:", error instanceof Error ? error.message : String(error));
    return NextResponse.json(
      { error: "failed to create project" },
      { status: 500 },
    );
  }

  await logAudit({
    userId: user.id,
    action: "project.create",
    resourceType: "project",
    resourceId: project.id,
    metadata: { name: project.name },
  });

  return NextResponse.json(project);
}
