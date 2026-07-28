import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { projects, sources, chapters } from "@/lib/db/schema";
import { chapterPlaceholders } from "@/lib/db/schema/chapter-placeholders";
import { createClient } from "@/lib/supabase/server";
import { eq, and, asc, inArray } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { logAudit } from "@/lib/audit";
import { createEditorialBriefDraft } from "@/lib/editorial-brief/repository";
import { extractEditorialBriefDraft } from "@/lib/editorial-brief/extract";
import { mapRepoError } from "../map-repo-error";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const extractBodySchema = z.object({
  sourceId: z.string().uuid("sourceId must be a valid UUID"),
  model: z.string().optional(),
  schemaVersion: z.enum(["3.0"]).optional(),
});

// ---------------------------------------------------------------------------
// POST — extract editorial brief from research source
// ---------------------------------------------------------------------------

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfError = csrfCheck(_req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId } = await params;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Parse body
  let body: z.infer<typeof extractBodySchema>;
  try {
    const text = await _req.text();
    body = extractBodySchema.parse(JSON.parse(text));
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: `Invalid body: ${err.errors.map((e) => e.message).join("; ")}` },
        { status: 400 },
      );
    }
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  try {
    // Load source and verify it belongs to the project
    const [source] = await db
      .select()
      .from(sources)
      .where(and(eq(sources.id, body.sourceId), eq(sources.projectId, projectId)))
      .limit(1);

    if (!source) {
      return NextResponse.json(
        { error: "Source not found in this project" },
        { status: 404 },
      );
    }

    if (!source.extractedText) {
      return NextResponse.json(
        { error: "Source has no extracted text; cannot extract brief" },
        { status: 400 },
      );
    }

    // Load chapters for the project
    const projectChapters = await db
      .select({ id: chapters.id, title: chapters.title })
      .from(chapters)
      .where(eq(chapters.projectId, projectId))
      .orderBy(asc(chapters.position));

    if (projectChapters.length === 0) {
      return NextResponse.json(
        { error: "Project has no chapters; cannot extract editorial brief" },
        { status: 400 },
      );
    }

    // Batch-load available placeholder names for all chapters in one query
    const chapterIds = projectChapters.map((ch) => ch.id);
    const allPlaceholders = await db
      .select({
        chapterId: chapterPlaceholders.chapterId,
        name: chapterPlaceholders.name,
      })
      .from(chapterPlaceholders)
      .where(inArray(chapterPlaceholders.chapterId, chapterIds))
      .orderBy(asc(chapterPlaceholders.name));

    const placeholdersByChapter = new Map<string, string[]>();
    for (const p of allPlaceholders) {
      const list = placeholdersByChapter.get(p.chapterId) ?? [];
      list.push(p.name);
      placeholdersByChapter.set(p.chapterId, list);
    }

    const chapterContext = projectChapters.map((ch) => ({
      chapterId: ch.id,
      title: ch.title,
      availablePlaceholders: placeholdersByChapter.get(ch.id) ?? [],
    }));

    // Extract via LLM
    const extracted = await extractEditorialBriefDraft({
      sourceText: source.extractedText,
      projectId,
      projectTopic: project.topic ?? "",
      chapterContext,
      model: body.model,
      schemaVersion: body.schemaVersion,
    });

    // Create draft from extraction result, binding the extracted source
    const brief = await createEditorialBriefDraft({
      projectId,
      content: extracted.draft.content,
      contracts: extracted.draft.contracts,
      evidenceSourceIds: [source.id],
    });

    await logAudit({
      userId: user.id,
      action: "editorial-brief.extract",
      resourceType: "editorial_brief",
      resourceId: brief.id,
      metadata: { projectId, sourceId: body.sourceId, version: brief.version },
    });

    return NextResponse.json(
      { ...brief, executionId: extracted.executionId },
      { status: 201 },
    );
  } catch (err) {
    // Forward source-text-size errors as 400 (they are payload-size issues,
    // not repository conflicts) before falling through to the shared mapper.
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("exceeds maximum")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return mapRepoError(err);
  }
}
