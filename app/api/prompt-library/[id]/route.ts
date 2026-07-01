import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { promptLibrary } from "@/lib/db/schema";
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
  const [row] = await db.select().from(promptLibrary).where(eq(promptLibrary.id, id)).limit(1);
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
  const { name, description, content, userPrompt, category } = body;

  if (content !== undefined && (typeof content !== "string" || content.length > 100_000)) {
    return NextResponse.json({ error: "content too long" }, { status: 400 });
  }
  if (userPrompt !== undefined && (typeof userPrompt !== "string" || userPrompt.length > 50_000)) {
    return NextResponse.json({ error: "userPrompt too long" }, { status: 400 });
  }

  const [updated] = await db
    .update(promptLibrary)
    .set({
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(content !== undefined ? { content } : {}),
      ...(userPrompt !== undefined ? { userPrompt } : {}),
      ...(category !== undefined ? { category } : {}),
      updatedAt: new Date(),
    })
    .where(eq(promptLibrary.id, id))
    .returning();

  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });

  logAudit({
    userId: admin.user.id,
    action: "prompt_library.update",
    resourceType: "prompt_library",
    resourceId: updated.id,
    metadata: { name: updated.name, category: updated.category },
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
  const [deleted] = await db.delete(promptLibrary).where(eq(promptLibrary.id, id)).returning();
  if (!deleted) return NextResponse.json({ error: "not found" }, { status: 404 });

  logAudit({
    userId: admin.user.id,
    action: "prompt_library.delete",
    resourceType: "prompt_library",
    resourceId: deleted.id,
    metadata: { name: deleted.name, category: deleted.category },
  });

  return NextResponse.json({ success: true });
}
