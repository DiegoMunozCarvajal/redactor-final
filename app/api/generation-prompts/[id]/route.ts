import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generationSystemPrompts } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/admin";
import { csrfCheck } from "@/lib/api/csrf";
import { eq } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!admin.authorized) return admin.response;

  const { id } = await params;
  const [row] = await db
    .select()
    .from(generationSystemPrompts)
    .where(eq(generationSystemPrompts.id, id))
    .limit(1);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json(row);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfErr = csrfCheck(req);
  if (csrfErr) return csrfErr;

  const admin = await requireAdmin();
  if (!admin.authorized) return admin.response;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const update: Record<string, unknown> = {};

  if (body.name !== undefined) {
    if (typeof body.name !== "string") {
      return NextResponse.json({ error: "name must be a string" }, { status: 400 });
    }
    const trimmed = body.name.trim();
    if (!trimmed) {
      return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
    }
    update.name = trimmed;
  }

  if (body.description !== undefined) {
    update.description =
      typeof body.description === "string" ? body.description.trim() || null : null;
  }

  if (body.content !== undefined) {
    if (typeof body.content !== "string") {
      return NextResponse.json({ error: "content must be a string" }, { status: 400 });
    }
    const trimmed = body.content.trim();
    if (!trimmed) {
      return NextResponse.json({ error: "content cannot be empty" }, { status: 400 });
    }
    update.content = trimmed;
  }

  if (body.is_default !== undefined) {
    update.isDefault = body.is_default === true;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }

  update.updatedAt = new Date();

  let row;
  if (update.isDefault) {
    // Transaction with FOR UPDATE prevents race condition on default switch.
    // The unique partial index catches any edge case the transaction misses.
    try {
      const [updated] = await db.transaction(async (tx) => {
        await tx
          .select()
          .from(generationSystemPrompts)
          .where(eq(generationSystemPrompts.isDefault, true))
          .for("update");

        await tx
          .update(generationSystemPrompts)
          .set({ isDefault: false })
          .where(eq(generationSystemPrompts.isDefault, true));

        return tx
          .update(generationSystemPrompts)
          .set(update)
          .where(eq(generationSystemPrompts.id, id))
          .returning();
      });
      row = updated;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "23505" || code === "40001") {
        return NextResponse.json(
          { error: "A default prompt already exists. Retry." },
          { status: 409 },
        );
      }
      console.error("[generation-prompts] PATCH failed:", err);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  } else {
    const [updated] = await db
      .update(generationSystemPrompts)
      .set(update)
      .where(eq(generationSystemPrompts.id, id))
      .returning();
    row = updated;
  }

  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfErr = csrfCheck(req);
  if (csrfErr) return csrfErr;

  const admin = await requireAdmin();
  if (!admin.authorized) return admin.response;

  const { id } = await params;
  await db.delete(generationSystemPrompts).where(eq(generationSystemPrompts.id, id));
  return NextResponse.json({ ok: true });
}
