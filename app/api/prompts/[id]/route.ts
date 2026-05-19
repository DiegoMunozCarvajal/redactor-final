import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { prompts } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { requireAdmin } from "@/lib/auth/admin";
import { logAudit } from "@/lib/audit";

// NOTE: Uses PUT for partial update (PATCH semantics).
// Kept as PUT for backward compatibility with admin UI.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const admin = await requireAdmin();
  if (!admin.authorized) return admin.response;

  const { id } = await params;
  const body = await req.json();
  const { type, title, content, position } = body;

  if (content !== undefined && (typeof content !== "string" || content.length > 20000)) {
    return NextResponse.json({ error: "content too long" }, { status: 400 });
  }

  const [prompt] = await db
    .update(prompts)
    .set({ type, title, content, position })
    .where(eq(prompts.id, id))
    .returning();

  if (!prompt) return NextResponse.json({ error: "not found" }, { status: 404 });

  logAudit({
    userId: admin.user.id,
    action: "prompt.update",
    resourceType: "prompt",
    resourceId: prompt.id,
    metadata: { title: prompt.title, type: prompt.type },
  });

  return NextResponse.json(prompt);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = csrfCheck(_req);
  if (csrfError) return csrfError;

  const admin = await requireAdmin();
  if (!admin.authorized) return admin.response;

  const { id } = await params;
  await db.delete(prompts).where(eq(prompts.id, id));

  logAudit({
    userId: admin.user.id,
    action: "prompt.delete",
    resourceType: "prompt",
    resourceId: id,
  });

  return NextResponse.json({ ok: true });
}
