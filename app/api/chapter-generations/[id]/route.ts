import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  chapterGenerations,
  fragments,
  projects,
  originalityAssessments,
} from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, asc, and, inArray, desc } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;

  const [gen] = await db
    .select()
    .from(chapterGenerations)
    .where(eq(chapterGenerations.id, id))
    .limit(1);
  if (!gen)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  // Verify via project ownership
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, gen.projectId))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const frags = await db
    .select()
    .from(fragments)
    .where(eq(fragments.chapterGenerationId, id))
    .orderBy(asc(fragments.position));

  // Resolve originality safety status (exposes no risk labels or source hashes)
  let originalityStatus: "clean" | "quarantined" | "unavailable" = "clean";

  if (gen.status === "quarantined") {
    originalityStatus = "quarantined";
  } else if (gen.status === "failed") {
    const errText = gen.error ?? (gen.generationMetadata as Record<string, unknown>)?.error ?? "";
    if (typeof errText === "string" && errText.includes("OriginalityDetectorUnavailable")) {
      originalityStatus = "unavailable";
    }
  }

  return NextResponse.json({ ...gen, fragments: frags, originalityStatus });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;

  const [gen] = await db
    .select()
    .from(chapterGenerations)
    .where(eq(chapterGenerations.id, id))
    .limit(1);
  if (!gen)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, gen.projectId))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const { status, error } = body;

  if (status && !["failed"].includes(status)) {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }

  // Only allow transitioning from active states to failed. Completed generations
  // stay completed — manual override would hide valid content from assembly views.
  const whereConditions = [eq(chapterGenerations.id, id)];
  if (status === "failed") {
    whereConditions.push(inArray(chapterGenerations.status, ["pending", "generating", "planning", "assembling"]));
  }

  const [updated] = await db
    .update(chapterGenerations)
    .set({
      ...(status !== undefined && { status }),
      ...(error !== undefined && { error }),
      ...(status === "completed" ? { completedAt: new Date() } : {}),
    })
    .where(and(...whereConditions))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "conflict" }, { status: 409 });
  }

  return NextResponse.json(updated);
}
