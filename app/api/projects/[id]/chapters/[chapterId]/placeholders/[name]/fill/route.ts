import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  projects,
  chapterBriefs,
  projectPrompts,
  chapterPlaceholders,
  chapters,
} from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, and, asc } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { type ReasoningEffort } from "@/lib/ai/completion";
import { fillSinglePlaceholder } from "@/lib/ai/placeholder-fill";
import { resolvePlaceholdersDirect } from "@/lib/placeholders";

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
  const effort = body.effort as ReasoningEffort | undefined;
  const temperatureRaw = body.temperature;
  if (temperatureRaw !== undefined && (typeof temperatureRaw !== "number" || temperatureRaw < 0 || temperatureRaw > 1)) {
    return NextResponse.json({ error: "temperature must be a number between 0 and 1" }, { status: 400 });
  }
  const temperature = temperatureRaw as number | undefined;

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

  // Build existing definitions map (exclude the one being filled)
  const existingDefinitions: Record<string, string> = {};
  for (const row of existingRows) {
    if (row.definition && row.name !== name) {
      existingDefinitions[row.name] = row.definition;
    }
  }

  // Check if this placeholder can be resolved directly (no LLM)
  const { resolved } = resolvePlaceholdersDirect(
    [name],
    project.topic ?? null,
    brief?.content ?? "",
  );

  if (resolved[name]) {
    await db
      .update(chapterPlaceholders)
      .set({ definition: resolved[name] })
      .where(
        and(
          eq(chapterPlaceholders.chapterId, chapterId),
          eq(chapterPlaceholders.name, name),
        ),
      );

    return NextResponse.json({ name, definition: resolved[name], sources: [] });
  }

  try {
    const { definition, sources } = await fillSinglePlaceholder(
      name,
      brief?.content ?? "",
      project.description ?? "",
      promptRows.map((p) => p.content),
      existingDefinitions,
      model,
      undefined,
      effort,
      temperature,
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
    return NextResponse.json({ error: "Generation failed" }, { status: 502 });
  }
}
