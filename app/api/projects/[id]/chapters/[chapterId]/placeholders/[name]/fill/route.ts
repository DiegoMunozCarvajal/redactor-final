import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  projects,
  chapterBriefs,
  projectPrompts,
  chapterPlaceholders,
  chapterConfigPrompts,
  chapters,
} from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, and, asc } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { fillSinglePlaceholder } from "@/lib/ai/placeholder-fill";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; chapterId: string; name: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId, chapterId, name } = await params;

  // Verify project ownership
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Verify chapter belongs to project
  const [chapter] = await db
    .select()
    .from(chapters)
    .where(and(eq(chapters.id, chapterId), eq(chapters.projectId, projectId)))
    .limit(1);
  if (!chapter) {
    return NextResponse.json({ error: "chapter not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const model = (body.model as string) || undefined;

  const [brief] = await db
    .select()
    .from(chapterBriefs)
    .where(eq(chapterBriefs.chapterId, chapterId));
  const promptRows = await db
    .select({ content: projectPrompts.content })
    .from(projectPrompts)
    .where(eq(projectPrompts.chapterId, chapterId))
    .orderBy(asc(projectPrompts.position));
  const existingRows = await db
    .select()
    .from(chapterPlaceholders)
    .where(eq(chapterPlaceholders.chapterId, chapterId));

  const [config] = await db
    .select()
    .from(chapterConfigPrompts)
    .where(
      and(
        eq(chapterConfigPrompts.chapterId, chapterId),
        eq(chapterConfigPrompts.type, "fill_placeholders"),
      ),
    );

  // Build existing definitions map (exclude the one being filled)
  const existingDefinitions: Record<string, string> = {};
  for (const row of existingRows) {
    if (row.definition && row.name !== name) {
      existingDefinitions[row.name] = row.definition;
    }
  }

  try {
    const { definition, sources } = await fillSinglePlaceholder(
      name,
      brief?.content ?? "",
      project.description ?? "",
      promptRows.map((p) => p.content),
      existingDefinitions,
      model,
      config?.content,
    );

    // Persist definition to DB
    await db
      .update(chapterPlaceholders)
      .set({ definition })
      .where(
        and(
          eq(chapterPlaceholders.chapterId, chapterId),
          eq(chapterPlaceholders.name, name),
        ),
      );

    return NextResponse.json({ name, definition, sources });
  } catch (err) {
    console.error("[fill/single] Failed:", err);
    return NextResponse.json({ error: "Generation failed", detail: (err as Error).message }, { status: 502 });
  }
}
