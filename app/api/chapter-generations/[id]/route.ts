import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chapterGenerations, fragments, projects } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, asc } from "drizzle-orm";
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

  return NextResponse.json({ ...gen, fragments: frags });
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

  const [updated] = await db
    .update(chapterGenerations)
    .set({
      ...(status !== undefined && { status }),
      ...(error !== undefined && { error }),
      ...(status === "failed" ? { completedAt: new Date() } : {}),
    })
    .where(eq(chapterGenerations.id, id))
    .returning();

  return NextResponse.json(updated);
}
