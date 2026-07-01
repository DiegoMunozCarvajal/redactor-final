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
import { fillPlaceholdersSequential } from "@/lib/ai/placeholder-fill";
import { buildPlaceholderFillMetadata } from "@/lib/placeholder-fill-metadata";
import { hashPromptContents } from "@/lib/placeholder-utils";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; chapterId: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId, chapterId } = await params;

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

  // Rate limit: insert a generation row inside the lock so
  // checkProjectRateLimit counts fill operations alongside other generations.
  // Update to completed/failed after the SSE stream finishes.
  const lockResult = await withProjectLock(projectId, async () => {
    // Clean up stale fill generations before rate check (inside lock for TOCTOU safety).
    await cleanupStaleGenerations(projectId, "fill", { chapterId });

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
        generationMetadata: { type: "fill" },
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

  // Load placeholders with metadata
  const placeholderRows = await db
    .select()
    .from(chapterPlaceholders)
    .where(eq(chapterPlaceholders.chapterId, chapterId))
    .orderBy(asc(chapterPlaceholders.name));

  if (placeholderRows.length === 0) {
    return NextResponse.json({ error: "no placeholders to fill" }, { status: 400 });
  }

  // Load prompt contents (content + userPrompt) and source contexts for context
  const promptRows = await db
    .select({ content: prompts.content, userPrompt: prompts.userPrompt, sourceContext: prompts.sourceContext })
    .from(prompts)
    .where(and(eq(prompts.chapterId, chapterId), eq(prompts.projectId, projectId)))
    .orderBy(asc(prompts.position));

  const promptContents = promptRows.map((p) => [p.content, p.userPrompt].filter(Boolean).join("\n"));
  const sourceContexts = promptRows.map((p) => p.sourceContext ?? null);

  // Compute prompts hash for stale detection — includes userPrompt changes
  const promptsHash = hashPromptContents(promptContents);

  // Build placeholder defs for the sequential pipeline
  const placeholderDefs = placeholderRows.map((p) => ({
    name: p.name,
    function: p.function,
    notes: p.notes,
  }));

  // Stream results via SSE as each placeholder completes
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of fillPlaceholdersSequential(
          placeholderDefs,
          promptContents,
          project.topic ?? null,
          projectId,
          model,
          effort,
          undefined,
          chapterId,
          sourceContexts,
          req.signal,
        )) {
          const data = JSON.stringify(event);
          controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${data}\n\n`));

          // Persist definition to DB on each placeholder event
          if (event.type === "placeholder" && event.name && event.definition) {
            await db
              .update(chapterPlaceholders)
              .set({
                definition: event.definition,
                fillMetadata: buildPlaceholderFillMetadata({
                  provider: event.provider,
                  sources: event.sources,
                  ragChunks: event.ragChunks,
                  model,
                  promptsHash,
                }),
              })
              .where(
                and(
                  eq(chapterPlaceholders.chapterId, chapterId),
                  eq(chapterPlaceholders.name, event.name),
                ),
              );
          }
        }
        // Mark fill generation as completed
        await db
          .update(chapterGenerations)
          .set({ status: "completed", completedAt: new Date() })
          .where(eq(chapterGenerations.id, fillGen.id));
      } catch (err) {
        // Mark fill generation as failed
        await db
          .update(chapterGenerations)
          .set({ status: "failed", error: sanitizeError(err) })
          .where(eq(chapterGenerations.id, fillGen.id));
        const errorEvent = { type: "error", error: sanitizeError(err) };
        controller.enqueue(
          encoder.encode(`event: error\ndata: ${JSON.stringify(errorEvent)}\n\n`),
        );
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
