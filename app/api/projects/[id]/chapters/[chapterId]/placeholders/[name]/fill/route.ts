import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  projects,
  prompts,
  chapterPlaceholders,
  chapters,
  chapterGenerations,
} from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, and, asc } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { checkProjectRateLimit, withProjectLock, cleanupStaleGenerations } from "@/lib/api/rate-limit";
import { sanitizeError } from "@/lib/sanitize-error";
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
    .select({ content: prompts.content, userPrompt: prompts.userPrompt, sourceContext: prompts.sourceContext })
    .from(prompts)
    .where(and(eq(prompts.chapterId, chapterId), eq(prompts.projectId, projectId)))
    .orderBy(asc(prompts.position));
  const promptContents = promptRows.map((p) => [p.content, p.userPrompt].filter(Boolean).join("\n"));
  const sourceContexts = promptRows.map((p) => p.sourceContext ?? null);

  // Compute prompts hash for stale detection — includes userPrompt changes
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

  // Verify requested placeholder name exists before any lock or LLM call
  const [placeholderRow] = existingRows.filter((r) => r.name === name);
  if (!placeholderRow) {
    return NextResponse.json({ error: "placeholder not found" }, { status: 404 });
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

  // LLM path: rate-limit via generation row inside advisory lock.
  // Same pattern as batch fill route — prevents unbounded concurrent LLM calls.
  const lockResult = await withProjectLock(projectId, async () => {
    // Clean up stale fill generations before rate check (inside lock for TOCTOU safety).
    // Single fills go directly to "generating" — no Trigger.dev dispatch.
    await cleanupStaleGenerations(projectId, "fill", {
      chapterId,
      statuses: ["generating"],
    });

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
        generationMetadata: { type: "fill", name },
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

  if ("rateLimited" in lockResult.result && lockResult.result.rateLimited) {
    return NextResponse.json(
      { error: "rate limited", retryAfter: lockResult.result.retryAfter },
      { status: 429, headers: { "Retry-After": String(lockResult.result.retryAfter) } },
    );
  }

  const fillGen = lockResult.result.gen;

  const phDef = {
    name,
    function: placeholderRow.function ?? null,
    notes: placeholderRow.notes ?? null,
  };

  // LLM call outside the lock
  let result;
  try {
    result = await fillOnePlaceholder(
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
  } catch (err) {
    const message = sanitizeError(err);
    await db
      .update(chapterGenerations)
      .set({ status: "failed", error: message })
      .where(eq(chapterGenerations.id, fillGen.id));
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // Guard: don't persist empty definitions. generateAndValidate returns ""
  // when both attempts fail (structural or originality). Mark as failed so
  // the UI shows the error and user can retry.
  if (!result.definition) {
    await db
      .update(chapterGenerations)
      .set({ status: "failed", error: "definition generation returned empty — both attempts failed" })
      .where(eq(chapterGenerations.id, fillGen.id));
    return NextResponse.json(
      { error: "definition generation failed — try again" },
      { status: 502 },
    );
  }

  // Persist definition + mark generation completed
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

  await db
    .update(chapterGenerations)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(chapterGenerations.id, fillGen.id));

  return NextResponse.json({
    name,
    definition: result.definition,
    sources: result.sources,
    ragChunks: result.ragChunks,
    provider: result.provider,
  });
}
