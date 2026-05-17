import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, runs } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq } from "drizzle-orm";
import { checkProjectRateLimit, withProjectLock } from "@/lib/api/rate-limit";
import { generateBook } from "@/trigger/generate-book";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId } = await params;

  // Verify project ownership
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Rate limit check
  const rateCheck = await checkProjectRateLimit(projectId);
  if (!rateCheck.allowed) {
    return NextResponse.json({ error: "rate limited", retryAfter: rateCheck.retryAfter }, { status: 429 });
  }

  // Create run with advisory lock
  const lockResult = await withProjectLock(projectId, async () => {
    const [run] = await db
      .insert(runs)
      .values({ projectId, status: "pending" })
      .returning();

    // Trigger the generate job
    await generateBook.trigger({ runId: run.id });

    return run;
  });

  if (!lockResult.locked) {
    return NextResponse.json({ error: "project is locked" }, { status: 409 });
  }

  return NextResponse.json(lockResult.result);
}
