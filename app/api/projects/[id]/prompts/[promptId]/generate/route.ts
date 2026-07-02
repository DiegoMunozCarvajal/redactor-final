import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, prompts, chapterGenerations, fragments } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, and, lt, sql, inArray } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { STALE_TIMEOUT_MS, checkProjectRateLimit, withProjectLock } from "@/lib/api/rate-limit";
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
    .from(prompts)
    .where(and(eq(prompts.projectId, projectId), eq(prompts.id, promptId)))
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

  // Rate limit + generation insert must be atomic. Without a lock, two
  // concurrent POSTs can both pass checkProjectRateLimit (count=0), both
  // insert a "generating" row, and both fire LLM calls — doubling cost.
  // The lock is released before the LLM call so UI-driven parallelism works.
  const lockResult = await withProjectLock(projectId, async () => {
    // Clean up stale generation rows for this prompt BEFORE the rate check.
    // If a previous prompt generation crashed (stuck in "pending" or
    // "generating"), the stale row would count against the rate limit and
    // block all future generations permanently — cleanup must run first.
    const staleCutoff = new Date(Date.now() - STALE_TIMEOUT_MS);
    const [staleRunning] = await db
      .select({ id: chapterGenerations.id })
      .from(chapterGenerations)
      .where(
        and(
          eq(chapterGenerations.projectId, projectId),
          eq(chapterGenerations.chapterId, prompt.chapterId),
          inArray(chapterGenerations.status, ["pending", "generating"]),
          sql`${chapterGenerations.generationMetadata}->>'type' = 'prompt'`,
          sql`${chapterGenerations.generationMetadata}->>'promptId' = ${promptId}`,
          lt(chapterGenerations.createdAt, staleCutoff),
        ),
      )
      .limit(1);
    if (staleRunning) {
      await db
        .update(chapterGenerations)
        .set({ status: "failed", error: "Stale generation (timed out after 30 minutes)" })
        .where(eq(chapterGenerations.id, staleRunning.id));
    }

    const rateLimit = await checkProjectRateLimit(projectId);
    if (!rateLimit.allowed) {
      return { rateLimited: true as const, retryAfter: rateLimit.retryAfter };
    }

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

    return { rateLimited: false as const, gen };
  });

  if (!lockResult.locked) {
    return NextResponse.json(
      { error: "project is locked" },
      { status: 409 },
    );
  }

  const result = lockResult.result;
  if (result.rateLimited) {
    return NextResponse.json(
      { error: "Too many concurrent generations for this project", retryAfter: result.retryAfter },
      { status: 429, headers: { "Retry-After": String(result.retryAfter) } },
    );
  }

  const gen = result.gen;

  // Guarantee DB cleanup on client abort or request teardown so the
  // generation row doesn't stay "generating" until the 30-min stale sweep.
  req.signal.addEventListener("abort", () => {
    db
      .update(chapterGenerations)
      .set({ status: "failed", error: "Request aborted (client disconnect or timeout)" })
      .where(and(eq(chapterGenerations.id, gen.id), eq(chapterGenerations.status, "generating")))
      .catch(() => {}); // Best-effort
  }, { once: true });

  try {
    const result = await generatePromptContent({
      prompt,
      placeholders,
      projectTopic: project.topic,
      ...(model ? { model } : {}),
      ...(effort !== undefined ? { effort } : {}),
    });

    // Fragment insert + generation completion must be atomic.
    // If the insert succeeds but the update fails, the fragment is
    // orphaned and the generation stays in "generating" indefinitely.
    const [fragment] = await db.transaction(async (tx) => {
      const [f] = await tx
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

      await tx
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

      return [f];
    });

    await logAudit({
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
