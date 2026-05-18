import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, chapterGenerations } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq } from "drizzle-orm";
import { checkProjectRateLimit, withProjectLock } from "@/lib/api/rate-limit";
import { generateChapter } from "@/trigger/generate-chapter";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; chapterId: string }> },
) {
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

  // Rate limit check
  const rateCheck = await checkProjectRateLimit(projectId);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "rate limited", retryAfter: rateCheck.retryAfter },
      { status: 429 },
    );
  }

  // Create generation with advisory lock
  const lockResult = await withProjectLock(projectId, async () => {
    const [gen] = await db
      .insert(chapterGenerations)
      .values({ projectId, chapterId, status: "generating" })
      .returning();

    await generateChapter.trigger({
      generationId: gen.id,
      projectId,
    });

    return gen;
  });

  if (!lockResult.locked) {
    return NextResponse.json(
      { error: "project is locked" },
      { status: 409 },
    );
  }

  return NextResponse.json(lockResult.result);
}
