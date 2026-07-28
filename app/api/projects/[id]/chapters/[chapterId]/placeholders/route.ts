import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, chapters, chapterPlaceholders, prompts, placeholderVersions } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, and, asc } from "drizzle-orm";
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
  const entries = Object.entries(definitions);

  const PLACEHOLDER_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
  const MAX_ENTRIES = 100;
  const MAX_NAME_LENGTH = 100;

  if (entries.length > MAX_ENTRIES) {
    return NextResponse.json(
      { error: `max ${MAX_ENTRIES} placeholders per request` },
      { status: 400 },
    );
  }

  for (const [name, def] of entries) {
    if (!name || name.length > MAX_NAME_LENGTH) {
      return NextResponse.json(
        { error: `placeholder name too long (max ${MAX_NAME_LENGTH})` },
        { status: 400 },
      );
    }
    if (!PLACEHOLDER_NAME_RE.test(name)) {
      return NextResponse.json(
        { error: `invalid placeholder name: "${name}"` },
        { status: 400 },
      );
    }
    if (def !== null && typeof def !== "string") {
      return NextResponse.json(
        { error: `definition for "${name}" must be string or null` },
        { status: 400 },
      );
    }
  }

  // Validate definition lengths before any DB writes
  for (const [name, def] of entries) {
    if (typeof def === "string" && def.length > 10_000) {
      return NextResponse.json(
        { error: `definition for "${name}" exceeds 10,000 characters` },
        { status: 400 },
      );
    }
  }

  // Fetch existing placeholder rows to detect changes
  const existingRows = await db
    .select({
      id: chapterPlaceholders.id,
      name: chapterPlaceholders.name,
      definition: chapterPlaceholders.definition,
    })
    .from(chapterPlaceholders)
    .where(eq(chapterPlaceholders.chapterId, chapterId));

  const existingByName = new Map(existingRows.map((r) => [r.name, r]));

  // Process each entry: create version if definition changed or is new
  for (const [name, definition] of entries) {
    const existing = existingByName.get(name);

    if (existing) {
      // Existing placeholder — check if definition actually changed
      const oldDef = existing.definition ?? null;
      const newDef = definition ?? null;
      if (oldDef !== newDef) {
        if (newDef !== null) {
          // Definition changed to non-null → create version
          const [version] = await db
            .insert(placeholderVersions)
            .values({
              placeholderId: existing.id,
              definition: newDef,
              fillMetadata: {
                sources: [],
                filledAt: new Date().toISOString(),
                definitionOrigin: "manual",
              },
            })
            .returning({ id: placeholderVersions.id });

          await db
            .update(chapterPlaceholders)
            .set({
              definition: newDef,
              activeVersionId: version.id,
              definitionOrigin: "manual",
            })
            .where(eq(chapterPlaceholders.id, existing.id));
        } else {
          // Definition set to null → no version, clear activeVersionId
          await db
            .update(chapterPlaceholders)
            .set({
              definition: null,
              activeVersionId: null,
            })
            .where(eq(chapterPlaceholders.id, existing.id));
        }
      }
    } else {
      // New placeholder — insert row + create version if definition is non-null
      const [inserted] = await db
        .insert(chapterPlaceholders)
        .values({ chapterId, name, definition })
        .returning({ id: chapterPlaceholders.id });

      if (definition !== null && inserted) {
        const [version] = await db
          .insert(placeholderVersions)
          .values({
            placeholderId: inserted.id,
            definition,
            fillMetadata: {
              sources: [],
              filledAt: new Date().toISOString(),
              definitionOrigin: "manual",
            },
          })
          .returning({ id: placeholderVersions.id });

        await db
          .update(chapterPlaceholders)
          .set({
            activeVersionId: version.id,
            definitionOrigin: "manual",
          })
          .where(eq(chapterPlaceholders.id, inserted.id));
      }
    }
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
