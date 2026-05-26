import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, projectPrompts, chapterGenerations, fragments } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, and } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { withProjectLock } from "@/lib/api/rate-limit";
import { generatePromptContent } from "@/lib/generate";
import { getProviderForModel } from "@/lib/ai/providers";
import { getChapterPlaceholders } from "@/lib/placeholders";
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
  const temperature = typeof body.temperature === "number" && body.temperature >= 0 && body.temperature <= 1 ? body.temperature : undefined;

  if (body.temperature !== undefined && (typeof body.temperature !== "number" || body.temperature < 0 || body.temperature > 1)) {
    return NextResponse.json({ error: "temperature must be a number between 0 and 1" }, { status: 400 });
  }

  let generationId: string | undefined;

  const lockResult = await withProjectLock(projectId, async () => {
    // Advisory lock serializes same-project access.
    // No sliding window check needed — single fragments are lightweight.

    // Create generation record inside lock so concurrent requests
    // don't see a stale "generating" record before the lock is acquired.
    // NOTE: This creates a full chapterGeneration row for a single-fragment
    // run. While this shows as a "completed" generation in the chapter UI,
    // it's required by the fragments FK (fragments.chapterGenerationId is
    // NOT NULL). Single-fragment runs are distinguishable from full chapter
    // runs by checking whether all prompt types have fragments.
    const [gen] = await db
      .insert(chapterGenerations)
      .values({
        projectId,
        chapterId: prompt.chapterId,
        status: "pending",
      })
      .returning();
    generationId = gen.id;

    try {
      const placeholders = await getChapterPlaceholders(prompt.chapterId, project.topic);

      const result = await generatePromptContent({
        prompt,
        placeholders,
        projectTopic: project.topic,
        ...(model ? { model } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
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
        .set({ status: "completed", completedAt: new Date() })
        .where(eq(chapterGenerations.id, gen.id));

      return { generationId: gen.id, fragment };
    } catch (err) {
      const message = sanitizeError(err);
      await db
        .update(chapterGenerations)
        .set({ status: "failed", error: message })
        .where(eq(chapterGenerations.id, gen.id));
      return { generationId: gen.id, error: message };
    }
  });

  if (!lockResult.locked) {
    return NextResponse.json(
      { error: "project is locked" },
      { status: 409 },
    );
  }

  if ("error" in lockResult.result && lockResult.result.error) {
    return NextResponse.json(
      { error: lockResult.result.error },
      { status: 500 },
    );
  }

  logAudit({
    userId: user.id,
    action: "prompt.generate",
    resourceType: "project_prompt",
    resourceId: promptId,
    metadata: { projectId, generationId: generationId! },
  });

  return NextResponse.json(lockResult.result);
}
