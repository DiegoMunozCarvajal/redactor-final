import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, chapters, chapterGenerations, critiquePrompts } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, and, desc } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { checkProjectRateLimit, withProjectLock } from "@/lib/api/rate-limit";
import { generateChapterCritique } from "@/lib/generate";
import { getChapterPlaceholders, getMissingPlaceholderNames } from "@/lib/placeholders";
import { sanitizeError } from "@/lib/sanitize-error";
import { logAudit } from "@/lib/audit";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; chapterId: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId, chapterId } = await params;

  // Verify project ownership
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.userId !== user.id)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  const [chapter] = await db
    .select()
    .from(chapters)
    .where(and(eq(chapters.id, chapterId), eq(chapters.projectId, projectId)))
    .limit(1);
  if (!chapter)
    return NextResponse.json({ error: "chapter not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const critiquePromptId = body.critiquePromptId as string | undefined;
  const model = body.model as string | undefined;
  const temperatureRaw = body.temperature;
  const temperature = typeof temperatureRaw === "number" && temperatureRaw >= 0 && temperatureRaw <= 1 ? temperatureRaw : undefined;
  const effort = body.effort as "off" | "max" | undefined;

  if (!critiquePromptId) {
    return NextResponse.json(
      { error: "critiquePromptId is required" },
      { status: 400 },
    );
  }

  // Determine what content to critique: use provided content or fetch latest assembly
  let contentToCritique: string;
  if (body.content && typeof body.content === "string") {
    contentToCritique = body.content;
  } else {
    // Fetch the latest completed assembly for this chapter
    const [latest] = await db
      .select()
      .from(chapterGenerations)
      .where(
        and(
          eq(chapterGenerations.projectId, projectId),
          eq(chapterGenerations.chapterId, chapterId),
          eq(chapterGenerations.status, "completed"),
        ),
      )
      .orderBy(desc(chapterGenerations.completedAt))
      .limit(1);

    if (!latest?.assembledContent) {
      return NextResponse.json(
        { error: "No assembled content found. Assemble the chapter first, or provide content directly." },
        { status: 400 },
      );
    }
    contentToCritique = latest.assembledContent;
  }

  // Load the critique prompt
  const [cp] = await db
    .select()
    .from(critiquePrompts)
    .where(eq(critiquePrompts.id, critiquePromptId))
    .limit(1);

  if (!cp) {
    return NextResponse.json(
      { error: "critique prompt not found" },
      { status: 400 },
    );
  }

  const placeholders = await getChapterPlaceholders(chapterId, project.topic);
  const missingPlaceholders = getMissingPlaceholderNames(
    [cp.content, cp.userPrompt].filter(Boolean) as string[],
    placeholders,
  );
  if (missingPlaceholders.length > 0) {
    const missing = missingPlaceholders.join(", ");
    return NextResponse.json(
      {
        error: `Cannot run critique "${cp.name}": missing placeholder definitions: {${missing.replace(/, /g, "}, {")}}. Fill them first.`,
      },
      { status: 400 },
    );
  }

  const resolvedModel = model ?? "deepseek-v4-pro";

  let generationId: string | undefined;

  const lockResult = await withProjectLock(projectId, async () => {
    const rateCheck = await checkProjectRateLimit(projectId);
    if (!rateCheck.allowed) {
      return { rateLimited: true as const, retryAfter: rateCheck.retryAfter };
    }

    const [gen] = await db
      .insert(chapterGenerations)
      .values({
        projectId,
        chapterId,
        status: "generating",
        generationMetadata: {
          type: "critique",
          promptId: cp.id,
          promptTitle: cp.name,
          model: resolvedModel,
        },
      })
      .returning();
    generationId = gen.id;

    try {
      const result = await generateChapterCritique({
        critiquePrompt: {
          content: cp.content,
          userPrompt: cp.userPrompt,
        },
        content: contentToCritique,
        placeholders,
        model: resolvedModel,
        temperature,
        effort,
        projectTopic: project.topic,
      });

      await db
        .update(chapterGenerations)
        .set({
          status: "completed",
          assembledContent: result.text,
          assemblyMetadata: {
            algorithm: "critique",
            promptId: cp.id,
            promptTitle: cp.name,
            promptSource: "library",
            model: result.model,
            fragmentCount: 1,
          },
          completedAt: new Date(),
        })
        .where(eq(chapterGenerations.id, gen.id));

      return { generationId: gen.id, critiqueContent: result.text };
    } catch (err) {
      const message = sanitizeError(err);
      await db
        .update(chapterGenerations)
        .set({ status: "failed", error: message })
        .where(eq(chapterGenerations.id, gen.id));
      throw err;
    }
  });

  if (!lockResult.locked) {
    return NextResponse.json(
      { error: "project is locked" },
      { status: 409 },
    );
  }

  if ("rateLimited" in lockResult.result && lockResult.result.rateLimited) {
    return NextResponse.json(
      { error: "rate limited", retryAfter: lockResult.result.retryAfter },
      { status: 429 },
    );
  }

  const genId = generationId;
  if (!genId) {
    return NextResponse.json({ error: "failed to create generation" }, { status: 500 });
  }

  logAudit({
    userId: user.id,
    action: "chapter.critique",
    resourceType: "chapter_generation",
    resourceId: genId,
    metadata: { projectId, chapterId, critiquePromptId: cp.id },
  });

  return NextResponse.json(lockResult.result);
}
