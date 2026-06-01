import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, chapterGenerations } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq } from "drizzle-orm";
import { checkProjectRateLimit, withProjectLock } from "@/lib/api/rate-limit";
import { csrfCheck } from "@/lib/api/csrf";
import { ensureTriggerConfigured } from "@/lib/trigger/setup";
import { generateChapter } from "@/trigger/generate-chapter";
import { sanitizeError } from "@/lib/sanitize-error";
import type { AssemblyAlgorithm } from "@/lib/generate";
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
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const model = body.model as string | undefined;
  const effort = body.effort as "off" | "max" | "xhigh" | undefined;
  const skipAssembly = body.skipAssembly === true;
  const assemblyAlgorithm: AssemblyAlgorithm = body.assemblyAlgorithm === "sequential"
    ? "sequential"
    : body.assemblyAlgorithm === "halves"
      ? "halves"
      : "merge-sort";

  // Serialize rate limit check and Trigger.dev dispatch under advisory lock.
  // Rate limit must be inside the lock to close the TOCTOU window where two
  // concurrent requests both pass the check before either acquires the lock.
  //
  // Create the generation row INSIDE the lock so a failed lock acquisition
  // doesn't leave a stuck "generating" row behind.
  let gen: typeof chapterGenerations.$inferSelect | null = null;
  const lockResult = await withProjectLock(projectId, async () => {
    const [row] = await db
      .insert(chapterGenerations)
      .values({ projectId, chapterId, status: "pending" })
      .returning();
    gen = row;
    const rateCheck = await checkProjectRateLimit(projectId);
    if (!rateCheck.allowed) {
      // Delete the row we just created — don't leave a stuck "generating" row
      await db.delete(chapterGenerations).where(eq(chapterGenerations.id, row.id));
      return { rateLimited: true as const, retryAfter: rateCheck.retryAfter };
    }

    try {
      ensureTriggerConfigured();
      await generateChapter.trigger(
        {
          generationId: gen.id,
          projectId,
          ...(model ? { model } : {}),
          ...(effort !== undefined ? { effort } : {}),
          skipAssembly,
          assemblyAlgorithm,
        },
        { idempotencyKey: gen.id },
      );
      return gen;
    } catch (err) {
      const message = sanitizeError(err);
      await db
        .update(chapterGenerations)
        .set({ status: "failed", error: message })
        .where(eq(chapterGenerations.id, gen.id));
      return gen;
    }
  });

  if (!lockResult.locked) {
    return NextResponse.json(
      { error: "project is locked" },
      { status: 409 },
    );
  }

  // Rate limit was hit inside the lock — 429 with retry-after
  if ("rateLimited" in lockResult.result && lockResult.result.rateLimited) {
    return NextResponse.json(
      { error: "rate limited", retryAfter: lockResult.result.retryAfter },
      { status: 429 },
    );
  }

  logAudit({
    userId: user.id,
    action: "chapter.generate",
    resourceType: "chapter_generation",
    resourceId: gen!.id,
    metadata: { projectId, chapterId },
  });

  return NextResponse.json(lockResult.result);
}
