import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  projects,
  projectPrompts,
  chapterPlaceholders,
  chapters,
} from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, and, asc } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { type ReasoningEffort } from "@/lib/ai/completion";
import { fillOnePlaceholder } from "@/lib/ai/placeholder-fill";
import { resolvePlaceholdersDirect } from "@/lib/placeholders";
import { buildPlaceholderFillMetadata } from "@/lib/placeholder-fill-metadata";
import { hashPromptContents } from "@/lib/placeholder-utils";

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

  const promptRows = await db
    .select({ content: projectPrompts.content, sourceContext: projectPrompts.sourceContext })
    .from(projectPrompts)
    .where(eq(projectPrompts.chapterId, chapterId))
    .orderBy(asc(projectPrompts.position));
  const promptContents = promptRows.map((p) => p.content);
  const sourceContexts = promptRows.map((p) => p.sourceContext ?? null);

  // Compute prompts hash for stale detection
  const promptsHash = hashPromptContents(promptContents);

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
  );

  if (resolved[name]) {
    await db
      .update(chapterPlaceholders)
      .set({
        definition: resolved[name],
        fillMetadata: buildPlaceholderFillMetadata({
          provider: "direct",
          model,
          promptsHash,
        }),
      })
      .where(
        and(
          eq(chapterPlaceholders.chapterId, chapterId),
          eq(chapterPlaceholders.name, name),
        ),
      );

    return NextResponse.json({ name, definition: resolved[name], sources: [] });
  }

  // Find this placeholder's function and notes from DB for classification
  const [placeholderRow] = existingRows.filter((r) => r.name === name);
  const phDef = {
    name,
    function: placeholderRow?.function ?? null,
    notes: placeholderRow?.notes ?? null,
  };

  try {
    const result = await fillOnePlaceholder(
      phDef,
      project.topic ?? null,
      projectId,
      promptContents,
      existingDefinitions,
      model,
      effort,
      undefined,
      chapterId,
      sourceContexts,
      req.signal,
    );

    // Persist definition to DB
    await db
      .update(chapterPlaceholders)
      .set({
        definition: result.definition,
        fillMetadata: buildPlaceholderFillMetadata({
          provider: result.provider,
          sources: result.sources,
          ragChunks: result.ragChunks,
          model,
          promptsHash,
        }),
      })
      .where(
        and(
          eq(chapterPlaceholders.chapterId, chapterId),
          eq(chapterPlaceholders.name, name),
        ),
      );

    return NextResponse.json({
      name,
      definition: result.definition,
      sources: result.sources,
      ragChunks: result.ragChunks,
      provider: result.provider,
    });
  } catch (err) {
    console.error("[fill/single] Failed:", err);
    return NextResponse.json({ error: "Generation failed" }, { status: 502 });
  }
}
