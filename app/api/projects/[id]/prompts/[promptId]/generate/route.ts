import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, projectPrompts, chapterGenerations, fragments } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, and } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { generatePromptContent } from "@/lib/generate";
import { getProviderForModel } from "@/lib/ai/providers";
import { getChapterPlaceholders, getMissingPlaceholderNames } from "@/lib/placeholders";
import { sanitizeError } from "@/lib/sanitize-error";
import { logAudit } from "@/lib/audit";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; promptId: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId, promptId } = await params;

  // Verify project ownership
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Load the prompt, verifying it belongs to this project
  const [prompt] = await db
    .select()
    .from(projectPrompts)
    .where(and(eq(projectPrompts.projectId, projectId), eq(projectPrompts.id, promptId)))
    .limit(1);
  if (!prompt) {
    return NextResponse.json({ error: "prompt not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const model = body.model as string | undefined;
  const effort = body.effort as "off" | "max" | undefined;

  const placeholders = await getChapterPlaceholders(prompt.chapterId, project.topic);
  const missingPlaceholders = getMissingPlaceholderNames(
    [prompt.content, prompt.userPrompt].filter(Boolean) as string[],
    placeholders,
  );
  if (missingPlaceholders.length > 0) {
    const missing = missingPlaceholders.join(", ");
    return NextResponse.json(
      {
        error: `Cannot generate "${prompt.title}": missing placeholder definitions: {${missing.replace(/, /g, "}, {")}}. Fill them first.`,
      },
      { status: 400 },
    );
  }

  // Create generation row before the LLM call so UI can poll real status.
  // Do not hold project advisory lock during LLM work; fragment generation is
  // independent per prompt and must support UI-driven parallelism.
  const [gen] = await db
    .insert(chapterGenerations)
    .values({
      projectId,
      chapterId: prompt.chapterId,
      status: "generating",
      generationMetadata: {
        type: "prompt",
        promptId: prompt.id,
        promptTitle: prompt.title,
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {}),
      },
    })
    .returning();

  try {
    const result = await generatePromptContent({
      prompt,
      placeholders,
      projectTopic: project.topic,
      ...(model ? { model } : {}),
      ...(effort !== undefined ? { effort } : {}),
    });

    const [fragment] = await db
      .insert(fragments)
      .values({
        chapterGenerationId: gen.id,
        projectPromptId: prompt.id,
        position: prompt.position,
        content: result.text,
        modelUsed: result.model,
        tokensUsed:
          (result.usage?.inputTokens ?? 0) +
          (result.usage?.outputTokens ?? 0),
        metadata: { provider: getProviderForModel(result.model) },
      })
      .returning();

    await db
      .update(chapterGenerations)
      .set({
        status: "completed",
        generationMetadata: {
          type: "prompt",
          promptId: prompt.id,
          promptTitle: prompt.title,
          model: result.model,
          provider: getProviderForModel(result.model),
          ...(effort ? { effort } : {}),
        },
        completedAt: new Date(),
      })
      .where(eq(chapterGenerations.id, gen.id));

    logAudit({
      userId: user.id,
      action: "prompt.generate",
      resourceType: "project_prompt",
      resourceId: promptId,
      metadata: { projectId, generationId: gen.id },
    });

    return NextResponse.json({ generationId: gen.id, fragment });
  } catch (err) {
    const message = sanitizeError(err);
    await db
      .update(chapterGenerations)
      .set({ status: "failed", error: message })
      .where(eq(chapterGenerations.id, gen.id));

    return NextResponse.json(
      { error: message, generationId: gen.id },
      { status: 500 },
    );
  }
}
