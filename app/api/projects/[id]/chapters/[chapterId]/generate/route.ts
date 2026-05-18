import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, chapterGenerations } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq } from "drizzle-orm";
import { checkProjectRateLimit, withProjectLock } from "@/lib/api/rate-limit";
import { csrfCheck } from "@/lib/api/csrf";
import "@/lib/trigger/setup";
import { generateChapter, sanitizeError } from "@/trigger/generate-chapter";
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

  // Create generation record BEFORE acquiring lock — so the row survives
  // even if the Trigger.dev dispatch fails and the lock transaction rolls back.
  const [gen] = await db
    .insert(chapterGenerations)
    .values({ projectId, chapterId, status: "generating" })
    .returning();

  // Serialize rate limit check and Trigger.dev dispatch under advisory lock.
  // Rate limit must be inside the lock to close the TOCTOU window where two
  // concurrent requests both pass the check before either acquires the lock.
  const lockResult = await withProjectLock(projectId, async () => {
    const rateCheck = await checkProjectRateLimit(projectId);
    if (!rateCheck.allowed) {
      return { rateLimited: true as const, retryAfter: rateCheck.retryAfter };
    }

    try {
      await generateChapter.trigger({
        generationId: gen.id,
        projectId,
        ...(model ? { model } : {}),
      });
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
    resourceId: gen.id,
    metadata: { projectId, chapterId },
  });

  return NextResponse.json(lockResult.result);
}
