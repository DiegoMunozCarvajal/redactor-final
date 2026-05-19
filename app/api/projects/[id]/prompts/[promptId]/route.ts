import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, projectPrompts, fragments } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, and } from "drizzle-orm";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; promptId: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId, promptId } = await params;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const [existing] = await db
    .select()
    .from(projectPrompts)
    .where(
      and(
        eq(projectPrompts.id, promptId),
        eq(projectPrompts.projectId, projectId),
      ),
    )
    .limit(1);
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await req.json();
  const { content } = body;

  const [updated] = await db
    .update(projectPrompts)
    .set({
      ...(content !== undefined && { content }),
    })
    .where(eq(projectPrompts.id, promptId))
    .returning();

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; promptId: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId, promptId } = await params;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const [existing] = await db
    .select()
    .from(projectPrompts)
    .where(
      and(
        eq(projectPrompts.id, promptId),
        eq(projectPrompts.projectId, projectId),
      ),
    )
    .limit(1);
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await db.delete(fragments).where(eq(fragments.projectPromptId, promptId));
  await db.delete(projectPrompts).where(eq(projectPrompts.id, promptId));

  return NextResponse.json({ ok: true });
}
