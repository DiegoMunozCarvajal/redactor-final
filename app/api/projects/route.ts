import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, chapters, prompts, projectPrompts, chapterPlaceholders, assemblyPrompts } from "@/lib/db/schema";
import { chapterGenerations } from "@/lib/db/schema/chapter-generations";
import { createClient } from "@/lib/supabase/server";
import { eq, asc, desc, and, isNull, sql, inArray } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { logAudit } from "@/lib/audit";
import { extractPlaceholders } from "@/lib/placeholders";

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
  const { name, topic, title, bookTemplateId, assemblyPromptId } = body;

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
  if (assemblyPromptId !== undefined && typeof assemblyPromptId !== "string") {
    return NextResponse.json({ error: "assemblyPromptId must be a string" }, { status: 400 });
  }

  let project: typeof projects.$inferSelect;
  try {
    project = await db.transaction(async (tx) => {
      const [p] = await tx
        .insert(projects)
        .values({ userId: user.id, name, title: title?.trim() || null, topic: topic?.trim() || null, bookTemplateId: bookTemplateId ?? null, assemblyPromptId: assemblyPromptId ?? null })
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
                function: prompt.function,
                notes: prompt.notes,
              })),
            );
          }
        }

        // Copy template chapter placeholders to project chapters (names only, no definitions).
        // Lowercase names to canonical form and deduplicate by (chapterId, lowerName).
        const allTemplateChapterIds = templateChapters.map((tc) => tc.id);
        if (allTemplateChapterIds.length > 0) {
          const templatePlaceholders = await tx
            .select()
            .from(chapterPlaceholders)
            .where(inArray(chapterPlaceholders.chapterId, allTemplateChapterIds));

          // Group by (projectChapterId, lowerName) — first function/notes wins
          const grouped = new Map<string, { chapterId: string; name: string; function: string | null; notes: string | null }>();
          for (const ph of templatePlaceholders) {
            const projectChapterId = chapterIdMap.get(ph.chapterId);
            if (!projectChapterId) continue;
            const key = `${projectChapterId}:${ph.name.toLowerCase()}`;
            if (!grouped.has(key)) {
              grouped.set(key, {
                chapterId: projectChapterId,
                name: ph.name.toLowerCase(),
                function: ph.function,
                notes: ph.notes,
              });
            }
          }

          if (grouped.size > 0) {
            await tx
              .insert(chapterPlaceholders)
              .values([...grouped.values()])
              .onConflictDoNothing();
          }
        }

        // Sync placeholders from project prompts — catch any {tokens} in prompt
        // content that weren't already in the template's chapterPlaceholders table
        for (const projectChapterId of [...chapterIdMap.values()]) {
          const ppContents = await tx
            .select({ content: projectPrompts.content, userPrompt: projectPrompts.userPrompt })
            .from(projectPrompts)
            .where(eq(projectPrompts.chapterId, projectChapterId));
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

        // Sync placeholders from global assembly prompt to all new project chapters
        if (assemblyPromptId) {
          const [globalAp] = await tx
            .select({ content: assemblyPrompts.content, userPrompt: assemblyPrompts.userPrompt })
            .from(assemblyPrompts)
            .where(eq(assemblyPrompts.id, assemblyPromptId))
            .limit(1);
          if (globalAp) {
            const apContents = [globalAp.content, globalAp.userPrompt].filter(
              (s): s is string => typeof s === "string" && s.length > 0,
            );
            const detected = extractPlaceholders(apContents);
            if (detected.length > 0) {
              const projectChapterIds = [...chapterIdMap.values()];
              for (const projectChapterId of projectChapterIds) {
                await tx
                  .insert(chapterPlaceholders)
                  .values(detected.map((name) => ({ chapterId: projectChapterId, name })))
                  .onConflictDoNothing();
              }
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
