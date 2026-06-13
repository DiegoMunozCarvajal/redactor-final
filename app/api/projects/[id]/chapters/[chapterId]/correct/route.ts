import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, chapters, chapterGenerations, correctorPrompts } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, and, desc, sql } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { checkProjectRateLimit, withProjectLock } from "@/lib/api/rate-limit";
import { generateChapterCorrection } from "@/lib/generate";
import { DEFAULT_GENERATION_MODEL } from "@/lib/ai/providers";
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
  const correctorPromptId = body.correctorPromptId as string | undefined;
  const correctorPrompt = body.correctorPrompt as { content: string; userPrompt?: string | null } | undefined;
  const critiqueGenerationId = body.critiqueGenerationId as string | undefined;
  const model = body.model as string | undefined;
  const effort = body.effort as "off" | "max" | undefined;

  // Require either correctorPromptId (from library) or correctorPrompt (inline from project prompt)
  if (!correctorPromptId && !correctorPrompt) {
    return NextResponse.json(
      { error: "correctorPromptId or correctorPrompt is required" },
      { status: 400 },
    );
  }

  if (!critiqueGenerationId) {
    return NextResponse.json(
      { error: "critiqueGenerationId is required" },
      { status: 400 },
    );
  }

  // Load the critique generation to get its content
  const [critiqueGen] = await db
    .select()
    .from(chapterGenerations)
    .where(
      and(
        eq(chapterGenerations.id, critiqueGenerationId),
        eq(chapterGenerations.projectId, projectId),
        eq(chapterGenerations.chapterId, chapterId),
      ),
    )
    .limit(1);

  if (!critiqueGen?.assembledContent) {
    return NextResponse.json(
      { error: "critique generation not found or has no content" },
      { status: 400 },
    );
  }

  // Determine what content to correct: use provided content or fetch latest assembly
  let contentToCorrect: string;
  if (body.content && typeof body.content === "string") {
    contentToCorrect = body.content;
  } else {
    // Fetch the latest completed assembly for this chapter (exclude critiques and corrections)
    const [latestAssembly] = await db
      .select()
      .from(chapterGenerations)
      .where(
        and(
          eq(chapterGenerations.projectId, projectId),
          eq(chapterGenerations.chapterId, chapterId),
          eq(chapterGenerations.status, "completed"),
          sql`(${chapterGenerations.generationMetadata}->>'type' IS NULL OR ${chapterGenerations.generationMetadata}->>'type' NOT IN ('critique', 'correction'))`,
        ),
      )
      .orderBy(desc(chapterGenerations.completedAt))
      .limit(1);

    if (!latestAssembly?.assembledContent) {
      return NextResponse.json(
        { error: "No assembled content found. Assemble the chapter first, or provide content directly." },
        { status: 400 },
      );
    }
    contentToCorrect = latestAssembly.assembledContent;
  }

  // Resolve corrector prompt: inline object or library lookup
  let cpContent: string;
  let cpUserPrompt: string | null;
  let cpName: string;

  if (correctorPrompt) {
    cpContent = correctorPrompt.content;
    cpUserPrompt = correctorPrompt.userPrompt ?? null;
    cpName = "Project Corrector";
  } else {
    const [cp] = await db
      .select()
      .from(correctorPrompts)
      .where(eq(correctorPrompts.id, correctorPromptId!))
      .limit(1);

    if (!cp) {
      return NextResponse.json(
        { error: "corrector prompt not found" },
        { status: 400 },
      );
    }
    cpContent = cp.content;
    cpUserPrompt = cp.userPrompt;
    cpName = cp.name;
  }

  const placeholders = await getChapterPlaceholders(chapterId, project.topic);
  const missingPlaceholders = getMissingPlaceholderNames(
    [cpContent, cpUserPrompt].filter(Boolean) as string[],
    placeholders,
  );
  if (missingPlaceholders.length > 0) {
    const missing = missingPlaceholders.join(", ");
    return NextResponse.json(
      {
        error: `Cannot run corrector "${cpName}": missing placeholder definitions: {${missing.replace(/, /g, "}, {")}}. Fill them first.`,
      },
      { status: 400 },
    );
  }

  const resolvedModel = model ?? DEFAULT_GENERATION_MODEL;

  let generationId: string | undefined;

  const lockResult = await withProjectLock(projectId, async () => {
    const rateCheck = await checkProjectRateLimit(projectId);
    if (!rateCheck.allowed) {
      return { rateLimited: true as const, retryAfter: rateCheck.retryAfter };
    }

    let gen: typeof chapterGenerations.$inferSelect | undefined;

    try {
      const [inserted] = await db
        .insert(chapterGenerations)
        .values({
          projectId,
          chapterId,
          status: "generating",
          generationMetadata: {
            type: "correction",
            promptId: correctorPromptId ?? "inline",
            promptTitle: cpName,
            model: resolvedModel,
            critiqueGenerationId,
          },
        })
        .returning();
      gen = inserted;
      generationId = gen.id;

      const result = await generateChapterCorrection({
        correctorPrompt: {
          content: cpContent,
          userPrompt: cpUserPrompt,
        },
        content: contentToCorrect,
        critiqueContent: critiqueGen.assembledContent!,
        placeholders,
        model: resolvedModel,
        effort,
        projectTopic: project.topic,
      });

      // Extract <capitulo_corregido> from the output for clean display
      const capMatch = result.text.match(/<capitulo_corregido>([\s\S]*?)<\/capitulo_corregido>/);
      const cleanChapter = capMatch ? capMatch[1].trim() : result.text;

      await db
        .update(chapterGenerations)
        .set({
          status: "completed",
          assembledContent: cleanChapter,
          assemblyMetadata: {
            algorithm: "correction",
            promptId: correctorPromptId ?? "inline",
            promptTitle: cpName,
            promptSource: correctorPromptId ? "library" : "project",
            model: result.model,
            fragmentCount: 1,
            critiqueGenerationId,
            correctionRaw: result.text,
          },
          completedAt: new Date(),
        })
        .where(eq(chapterGenerations.id, gen.id));

      return { generationId: gen.id, correctionContent: result.text };
    } catch (err) {
      const message = sanitizeError(err);
      if (gen) {
        await db
          .update(chapterGenerations)
          .set({ status: "failed", error: message })
          .where(eq(chapterGenerations.id, gen.id));
      }
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
    action: "chapter.correction",
    resourceType: "chapter_generation",
    resourceId: genId,
    metadata: { projectId, chapterId, correctorPromptId: correctorPromptId ?? "inline", critiqueGenerationId },
  });

  return NextResponse.json(lockResult.result);
}
