import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { metaPrompts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { requireAdmin } from "@/lib/auth/admin";
import { logAudit } from "@/lib/audit";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!admin.authorized) return admin.response;

  const { id } = await params;
  const [row] = await db.select().from(metaPrompts).where(eq(metaPrompts.id, id)).limit(1);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json(row);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const admin = await requireAdmin();
  if (!admin.authorized) return admin.response;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { name, description, content, userPrompt } = body;

  if (name !== undefined && typeof name !== "string") {
    return NextResponse.json({ error: "name must be a string" }, { status: 400 });
  }
  if (content !== undefined && (typeof content !== "string" || content.length > 20000)) {
    return NextResponse.json({ error: "content must be a string and under 20000 characters" }, { status: 400 });
  }
  if (userPrompt !== undefined && (typeof userPrompt !== "string" || userPrompt.length > 20000)) {
    return NextResponse.json({ error: "userPrompt must be a string and under 20000 characters" }, { status: 400 });
  }

  const [updated] = await db
    .update(metaPrompts)
    .set({
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(content !== undefined ? { content } : {}),
      ...(userPrompt !== undefined ? { userPrompt } : {}),
      updatedAt: new Date(),
    })
    .where(eq(metaPrompts.id, id))
    .returning();

  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });

  logAudit({
    userId: admin.user.id,
    action: "meta_prompt.update",
    resourceType: "meta_prompt",
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

  const admin = await requireAdmin();
  if (!admin.authorized) return admin.response;

  const { id } = await params;
  const [deleted] = await db.delete(metaPrompts).where(eq(metaPrompts.id, id)).returning();
  if (!deleted) return NextResponse.json({ error: "not found" }, { status: 404 });

  logAudit({
    userId: admin.user.id,
    action: "meta_prompt.delete",
    resourceType: "meta_prompt",
    resourceId: deleted.id,
    metadata: { name: deleted.name },
  });

  return NextResponse.json({ ok: true });
}
