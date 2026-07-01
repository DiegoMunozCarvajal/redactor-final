import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chapters } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/admin";
import { eq } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { logAudit } from "@/lib/audit";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin.authorized) return admin.response;

  const { id } = await params;
  const [chapter] = await db.select().from(chapters).where(eq(chapters.id, id)).limit(1);
  if (!chapter) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(chapter);
}

// NOTE: Uses PUT for partial update (PATCH semantics).
// Kept as PUT for backward compatibility with admin UI.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const admin = await requireAdmin();
  if (!admin.authorized) return admin.response;

  const { id } = await params;

  // Admin can edit any chapter — no ownership check needed
  const [existing] = await db
    .select({ id: chapters.id })
    .from(chapters)
    .where(eq(chapters.id, id))
    .limit(1);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const { title, position } = body;

  const [chapter] = await db
    .update(chapters)
    .set({
      ...(title !== undefined && { title }),
      ...(position !== undefined && { position }),
    })
    .where(eq(chapters.id, id))
    .returning();

  if (!chapter) return NextResponse.json({ error: "not found" }, { status: 404 });

  await logAudit({
    userId: admin.user.id,
    action: "chapter.update",
    resourceType: "chapter",
    resourceId: chapter.id,
    metadata: { title: chapter.title, position: chapter.position },
  });

  return NextResponse.json(chapter);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = csrfCheck(_req);
  if (csrfError) return csrfError;

  const admin = await requireAdmin();
  if (!admin.authorized) return admin.response;

  const { id } = await params;

  // Admin can delete any chapter — no ownership check needed
  const [existing] = await db
    .select({ id: chapters.id })
    .from(chapters)
    .where(eq(chapters.id, id))
    .limit(1);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  await db.delete(chapters).where(eq(chapters.id, id));

  await logAudit({
    userId: admin.user.id,
    action: "chapter.delete",
    resourceType: "chapter",
    resourceId: id,
  });

  return NextResponse.json({ ok: true });
}
