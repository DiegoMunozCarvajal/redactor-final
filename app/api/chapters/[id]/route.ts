import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chapters } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { requireAdmin } from "@/lib/auth/admin";
import { logAudit } from "@/lib/audit";

// GET is intentionally open to all authenticated users — chapter details must be
// visible when browsing templates for project creation.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

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
  const body = await req.json();
  const { title, position } = body;

  const [chapter] = await db
    .update(chapters)
    .set({ title, position })
    .where(eq(chapters.id, id))
    .returning();

  if (!chapter) return NextResponse.json({ error: "not found" }, { status: 404 });

  logAudit({
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
  await db.delete(chapters).where(eq(chapters.id, id));

  logAudit({
    userId: admin.user.id,
    action: "chapter.delete",
    resourceType: "chapter",
    resourceId: id,
  });

  return NextResponse.json({ ok: true });
}
