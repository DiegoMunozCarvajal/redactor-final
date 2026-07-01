import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { projects, chapters, chapterGenerations } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, asc } from "drizzle-orm";
import { generatePromptContent } from "@/lib/generate";
import { getChapterPlaceholders } from "@/lib/placeholders";
import { checkProjectRateLimit, withProjectLock } from "@/lib/api/rate-limit";
import { csrfCheck } from "@/lib/api/csrf";
import { sanitizeError } from "@/lib/sanitize-error";

const titleResponseSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().optional(),
});

export async function POST(
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

  const { id: projectId } = await params;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Load first chapter for placeholders + FK anchor before the lock.
  const [firstChapter] = await db
    .select({ id: chapters.id })
    .from(chapters)
    .where(eq(chapters.projectId, projectId))
    .orderBy(asc(chapters.position))
    .limit(1);

  if (!firstChapter) {
    return NextResponse.json(
      { error: "project has no chapters yet" },
      { status: 400 },
    );
  }

  // Serialize rate limit check + generation row insert under advisory lock.
  // Creating a chapterGenerations row (type "title") ensures checkProjectRateLimit
  // counts it — preventing unlimited title generations per project.
  const lockResult = await withProjectLock(projectId, async () => {
    const rateCheck = await checkProjectRateLimit(projectId);
    if (!rateCheck.allowed) {
      return { rateLimited: true as const, retryAfter: rateCheck.retryAfter };
    }

    const [gen] = await db
      .insert(chapterGenerations)
      .values({
        projectId,
        chapterId: firstChapter.id,
        status: "generating",
        generationMetadata: { type: "title" },
      })
      .returning();

    return { rateLimited: false as const, generationId: gen.id };
  });

  if (!lockResult.locked) {
    return NextResponse.json(
      { error: "project is locked" },
      { status: 409 },
    );
  }

  if (lockResult.result.rateLimited) {
    return NextResponse.json(
      { error: "rate limited", retryAfter: lockResult.result.retryAfter },
      { status: 429 },
    );
  }

  const generationId = lockResult.result.generationId;

  // LLM call outside the lock
  const placeholders = await getChapterPlaceholders(firstChapter.id, project.topic);

  let result;
  try {
    result = await generatePromptContent({
      prompt: {
        content:
          'Genera un título y subtítulo atractivo para un libro sobre {tema}. Responde en formato JSON: { "title": "...", "subtitle": "..." }',
      },
      placeholders,
      projectTopic: project.topic,
    });
  } catch (err) {
    const message = sanitizeError(err);
    await db
      .update(chapterGenerations)
      .set({ status: "failed", error: message })
      .where(eq(chapterGenerations.id, generationId));
    return NextResponse.json({ error: message }, { status: 502 });
  }

  let title = "";
  let subtitle = "";
  try {
    const parsed = titleResponseSchema.parse(JSON.parse(result.text));
    title = parsed.title;
    subtitle = parsed.subtitle ?? "";
  } catch (err) {
    console.error(
      "[generate-title] Failed to parse title JSON:",
      err instanceof Error ? err.message : "Unknown error",
    );
    await db
      .update(chapterGenerations)
      .set({ status: "failed", error: "Failed to parse title from model response" })
      .where(eq(chapterGenerations.id, generationId));
    return NextResponse.json(
      { error: "Failed to parse title from model response" },
      { status: 500 },
    );
  }

  await db
    .update(projects)
    .set({ title, subtitle: subtitle || null })
    .where(eq(projects.id, projectId));

  await db
    .update(chapterGenerations)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(chapterGenerations.id, generationId));

  return NextResponse.json({ title, subtitle });

}
