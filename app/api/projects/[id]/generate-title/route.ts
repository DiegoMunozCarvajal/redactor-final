import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, chapters, chapterGenerations } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, and, asc } from "drizzle-orm";
import { generateTitle } from "@/lib/title/generate";
import { checkProjectRateLimit, withProjectLock, cleanupStaleGenerations } from "@/lib/api/rate-limit";
import { csrfCheck } from "@/lib/api/csrf";
import { sanitizeError } from "@/lib/sanitize-error";
import { loadEditorialBundle, snapshotFromBundle, metadataFromSnapshot, renderEditorialScope } from "@/lib/editorial-brief/context";

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

  // Resolve editorial brief snapshot before the lock so we can capture
  // the exact approved version at queue time.
  const briefBundle = await loadEditorialBundle({ projectId });
  const briefSnapshot = briefBundle ? snapshotFromBundle(briefBundle) : null;

  // Serialize rate limit check + generation row insert under advisory lock.
  // Creating a chapterGenerations row (type "title") ensures checkProjectRateLimit
  // counts it — preventing unlimited title generations per project.
  const lockResult = await withProjectLock(projectId, async () => {
    // Clean up stale title generation rows BEFORE the rate check.
    // If a previous title generation crashed (stuck in "generating"),
    // the stale row would count against the rate limit and block all
    // future generations permanently. Title gens go directly to
    // "generating" — no Trigger.dev dispatch to recover them.
    await cleanupStaleGenerations(projectId, "title", {
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
        chapterId: firstChapter.id,
        status: "generating",
        generationMetadata: {
          type: "title",
          ...(briefSnapshot ? metadataFromSnapshot(briefSnapshot) : {}),
        },
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
      { status: 429, headers: { "Retry-After": String(lockResult.result.retryAfter) } },
    );
  }

  const generationId = lockResult.result.generationId;

  // Guarantee DB cleanup on client abort or request teardown so the
  // generation row doesn't stay "generating" until the 30-min stale sweep.
  _req.signal.addEventListener("abort", () => {
    db
      .update(chapterGenerations)
      .set({ status: "failed", error: "Request aborted (client disconnect or timeout)" })
      .where(and(eq(chapterGenerations.id, generationId), eq(chapterGenerations.status, "generating")))
      .catch(() => {}); // Best-effort
  }, { once: true });

  // Render title-scoped editorial context (no chapter contract — title scope
  // uses audience, promise, packaging, and guardrails only).
  const editorialContext = briefBundle
    ? renderEditorialScope(briefBundle, { scope: "title" })
    : null;

  // LLM call outside the lock
  let titleResult;
  try {
    titleResult = await generateTitle({
      projectId,
      editorialContext: editorialContext ?? "",
      projectTopic: project.topic ?? "",
    });
  } catch (err) {
    const message = sanitizeError(err);
    await db
      .update(chapterGenerations)
      .set({ status: "failed", error: message })
      .where(eq(chapterGenerations.id, generationId));
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const { title, subtitle, executionId } = titleResult;

  // Atomic: both updates succeed or neither does.
  // Prevents inconsistent state where title is saved but generation
  // stays "generating" — which would permanently block rate limiting.
  await db.transaction(async (tx) => {
    await tx
      .update(projects)
      .set({ title, subtitle: subtitle || null })
      .where(eq(projects.id, projectId));

    await tx
      .update(chapterGenerations)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(chapterGenerations.id, generationId));
  });

  return NextResponse.json({ title, subtitle, executionId });

}
