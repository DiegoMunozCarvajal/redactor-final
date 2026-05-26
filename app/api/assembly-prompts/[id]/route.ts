import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { assemblyPrompts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const [row] = await db.select().from(assemblyPrompts).where(eq(assemblyPrompts.id, id)).limit(1);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json(row);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { name, description, content, userPrompt } = body;

  const [updated] = await db
    .update(assemblyPrompts)
    .set({
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(content !== undefined ? { content } : {}),
      ...(userPrompt !== undefined ? { userPrompt } : {}),
      updatedAt: new Date(),
    })
    .where(eq(assemblyPrompts.id, id))
    .returning();

  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });

  logAudit({
    userId: user.id,
    action: "assembly_prompt.update",
    resourceType: "assembly_prompt",
    resourceId: updated.id,
    metadata: { name: updated.name },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const [deleted] = await db.delete(assemblyPrompts).where(eq(assemblyPrompts.id, id)).returning();
  if (!deleted) return NextResponse.json({ error: "not found" }, { status: 404 });

  logAudit({
    userId: user.id,
    action: "assembly_prompt.delete",
    resourceType: "assembly_prompt",
    resourceId: deleted.id,
    metadata: { name: deleted.name },
  });

  return NextResponse.json({ success: true });
}
