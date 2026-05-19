import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { prompts, promptVersions } from "@/lib/db/schema";
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
  const { title, content, position, isAssembly } = body;

  if (content !== undefined && (typeof content !== "string" || content.length > 20000)) {
    return NextResponse.json({ error: "content too long" }, { status: 400 });
  }

  // Save version before updating
  const [current] = await db
    .select()
    .from(prompts)
    .where(eq(prompts.id, id))
    .limit(1);
  if (current) {
    await db.insert(promptVersions).values({
      promptId: current.id,
      title: current.title,
      content: current.content,
    });
  }

  const [prompt] = await db
    .update(prompts)
    .set({ title, content, position, isAssembly })
    .where(eq(prompts.id, id))
    .returning();

  if (!prompt) return NextResponse.json({ error: "not found" }, { status: 404 });

  logAudit({
    userId: admin.user.id,
    action: "prompt.update",
    resourceType: "prompt",
    resourceId: prompt.id,
    metadata: { title: prompt.title, isAssembly: prompt.isAssembly },
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
