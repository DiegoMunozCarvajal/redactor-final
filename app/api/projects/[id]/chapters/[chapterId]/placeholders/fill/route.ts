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
import { loadEditorialBundle } from "@/lib/editorial-brief/context";

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
  // Default to true — protect manually-edited definitions from being overwritten.
  // Set to false only when user explicitly requests a full re-fill.
  const onlyMissingOrStale = body.onlyMissingOrStale !== false;

  // Load current approved editorial brief for evidence-driven RAG and snapshot capture.
  const briefBundle = await loadEditorialBundle({ projectId });

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

    // Check for placeholders inside the lock so empty chapters don't
    // leave a zombie generation row that blocks rate limiting.
    const phRows = await db
      .select()
      .from(chapterPlaceholders)
      .where(eq(chapterPlaceholders.chapterId, chapterId))
      .orderBy(asc(chapterPlaceholders.name));

    if (phRows.length === 0) {
      await db
        .update(chapterGenerations)
        .set({ status: "failed", error: "no placeholders to fill" })
        .where(eq(chapterGenerations.id, gen.id));
      return { rateLimited: false as const, gen, emptyPlaceholders: true as const };
    }

    return { rateLimited: false as const, gen, emptyPlaceholders: false as const, phRows };
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

  if (lockResult.result.emptyPlaceholders) {
    return NextResponse.json({ error: "no placeholders to fill" }, { status: 400 });
  }

  const fillGen = lockResult.result.gen;
  const placeholderRows = lockResult.result.phRows;

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

  // Filter out placeholders that already have a fresh definition
  // when onlyMissingOrStale is true (default). Protects manually-edited
  // definitions from being overwritten by a bulk fill-all operation.
  const toFill = onlyMissingOrStale
    ? placeholderRows.filter((p) => {
        if (!p.definition) return true; // Missing — always fill
        const meta = p.fillMetadata as { promptsHash?: string; editorialBriefHash?: string } | null;
        if (!meta?.promptsHash && !meta?.editorialBriefHash) return true; // No hash — fill (stale detection impossible)
        if (meta.promptsHash && meta.promptsHash !== promptsHash) return true; // Prompts changed
        if (meta.editorialBriefHash && briefBundle && meta.editorialBriefHash !== briefBundle.hash) return true; // Brief changed
        return false;
      })
    : placeholderRows;

  // Build placeholder defs for the sequential pipeline
  const placeholderDefs = toFill.map((p) => ({
    name: p.name,
    function: p.function,
    notes: p.notes,
  }));

  // If all placeholders already have fresh definitions, skip the fill entirely.
  if (placeholderDefs.length === 0) {
    await db
      .update(chapterGenerations)
      .set({ status: "completed", error: "all placeholders already filled", completedAt: new Date() })
      .where(eq(chapterGenerations.id, fillGen.id));
    return NextResponse.json({ message: "all placeholders already filled", skipped: true });
  }

  // Stream results via SSE as each placeholder completes
  const encoder = new TextEncoder();

  // Guarantee DB cleanup on client abort or request teardown.
  // If the server dies mid-stream without this, the generation row
  // stays "generating" until the 30-min stale sweep.
  const markFailedOnAbort = async () => {
    try {
      await db
        .update(chapterGenerations)
        .set({ status: "failed", error: "Request aborted (client disconnect or timeout)" })
        .where(and(eq(chapterGenerations.id, fillGen.id), eq(chapterGenerations.status, "generating")));
    } catch {
      // Best-effort — ignore if DB is unreachable during teardown
    }
  };
  req.signal.addEventListener("abort", markFailedOnAbort, { once: true });

  const stream = new ReadableStream({
    async start(controller) {
      let hadError = false;
      let terminalEvent: "done" | "cancelled" | "error" | null = null;

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
          briefBundle,
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
                  ...(briefBundle
                    ? {
                        editorialBriefId: briefBundle.id,
                        editorialBriefVersion: briefBundle.version,
                        editorialBriefHash: briefBundle.hash,
                      }
                    : {}),
                  ...(event.evidenceQuery ? { evidenceQuery: event.evidenceQuery } : {}),
                  ...(event.evidenceSourceIds ? { evidenceSourceIds: event.evidenceSourceIds } : {}),
                }),
              })
              .where(
                and(
                  eq(chapterPlaceholders.chapterId, chapterId),
                  eq(chapterPlaceholders.name, event.name),
                ),
              );
          }

          // Track terminal events from the generator.
          // Individual placeholder errors are not terminal — the generator
          // continues to the next placeholder and eventually emits "done".
          // Track hadError separately so a late "done" doesn't overwrite it.
          if (event.type === "cancelled") {
            terminalEvent = "cancelled";
          } else if (event.type === "error") {
            hadError = true;
            terminalEvent = "error";
          } else if (event.type === "done") {
            terminalEvent = "done";
          }
        }

        // Set appropriate DB status based on terminal event.
        // hadError takes precedence over "done" — some placeholders may have
        // failed even though the generator completed all iterations.
        if (terminalEvent === "cancelled") {
          await db
            .update(chapterGenerations)
            .set({ status: "failed", error: "Fill cancelled by user" })
            .where(eq(chapterGenerations.id, fillGen.id));
        } else if (hadError || terminalEvent === "error") {
          await db
            .update(chapterGenerations)
            .set({ status: "failed", error: "Fill encountered errors" })
            .where(eq(chapterGenerations.id, fillGen.id));
        } else if (terminalEvent === "done") {
          await db
            .update(chapterGenerations)
            .set({ status: "completed", completedAt: new Date() })
            .where(eq(chapterGenerations.id, fillGen.id));
        }
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
