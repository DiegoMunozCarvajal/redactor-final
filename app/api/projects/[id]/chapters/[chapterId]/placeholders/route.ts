import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, chapters, chapterPlaceholders, prompts } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, and, asc, sql } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { hashPromptContents } from "@/lib/placeholder-utils";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; chapterId: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id, chapterId } = await params;

  // Verify project ownership
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Verify chapter belongs to project
  const [chapter] = await db
    .select({ id: chapters.id })
    .from(chapters)
    .where(and(eq(chapters.id, chapterId), eq(chapters.projectId, id)))
    .limit(1);
  if (!chapter) return NextResponse.json({ error: "chapter not found" }, { status: 404 });

  const rows = await db
    .select()
    .from(chapterPlaceholders)
    .where(eq(chapterPlaceholders.chapterId, chapterId))
    .orderBy(asc(chapterPlaceholders.name));

  // Compute current prompts hash for stale detection
  const promptRows = await db
    .select({ content: prompts.content, userPrompt: prompts.userPrompt })
    .from(prompts)
    .where(and(eq(prompts.chapterId, chapterId), eq(prompts.projectId, id)))
    .orderBy(asc(prompts.position));

  const currentPromptsHash = hashPromptContents(promptRows.map((p) => [p.content, p.userPrompt].filter(Boolean).join("")));

  return NextResponse.json({ placeholders: rows, currentPromptsHash });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; chapterId: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id, chapterId } = await params;

  // Verify project ownership
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Verify chapter belongs to project
  const [chapter] = await db
    .select({ id: chapters.id })
    .from(chapters)
    .where(and(eq(chapters.id, chapterId), eq(chapters.projectId, id)))
    .limit(1);
  if (!chapter) return NextResponse.json({ error: "chapter not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const definitions: Record<string, string | null> = body.placeholders ?? {};

  // Batch upsert placeholder definitions using ON CONFLICT to avoid N+1 updates
  const entries = Object.entries(definitions);
  if (entries.length > 0) {
    await db
      .insert(chapterPlaceholders)
      .values(
        entries.map(([name, definition]) => ({
          chapterId,
          name,
          definition,
        })),
      )
      .onConflictDoUpdate({
        target: [chapterPlaceholders.chapterId, chapterPlaceholders.name],
        set: { definition: sql`excluded.definition` },
      });
  }

  // Return updated list with current prompts hash for consistency with GET
  const rows = await db
    .select()
    .from(chapterPlaceholders)
    .where(eq(chapterPlaceholders.chapterId, chapterId))
    .orderBy(asc(chapterPlaceholders.name));

  const promptRows = await db
    .select({ content: prompts.content, userPrompt: prompts.userPrompt })
    .from(prompts)
    .where(and(eq(prompts.chapterId, chapterId), eq(prompts.projectId, id)))
    .orderBy(asc(prompts.position));

  const currentPromptsHash = hashPromptContents(promptRows.map((p) => [p.content, p.userPrompt].filter(Boolean).join("")));

  return NextResponse.json({ placeholders: rows, currentPromptsHash });
}
