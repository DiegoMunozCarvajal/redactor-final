import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chapters } from "@/lib/db/schema";
import { csrfCheck } from "@/lib/api/csrf";
import { requireAdmin } from "@/lib/auth/admin";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

const reorderSchema = z.object({
  chapters: z
    .array(
      z.object({
        id: z.string().uuid(),
        position: z.number().int().min(0).max(1000),
      }),
    )
    .min(1)
    .max(100),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const admin = await requireAdmin();
  if (!admin.authorized) return admin.response;

  const { id: bookTemplateId } = await params;

  const body = await req.json().catch(() => ({}));
  const parsed = reorderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { chapters: reordered } = parsed.data;

  // Validate no duplicate positions — the schema only checks type/range.
  const positionSet = new Set(reordered.map((c) => c.position));
  if (positionSet.size !== reordered.length) {
    return NextResponse.json(
      { error: "duplicate positions are not allowed" },
      { status: 400 },
    );
  }

  // Verify all chapter IDs belong to this template
  const chapterIds = reordered.map((c) => c.id);
  const existingChapters = await db
    .select({ id: chapters.id })
    .from(chapters)
    .where(
      and(
        eq(chapters.bookTemplateId, bookTemplateId),
        isNull(chapters.projectId),
        inArray(chapters.id, chapterIds),
      ),
    );

  const existingIds = new Set(existingChapters.map((c) => c.id));
  const invalidIds = reordered.filter((c) => !existingIds.has(c.id));
  if (invalidIds.length > 0) {
    return NextResponse.json(
      { error: "some chapter IDs do not belong to this template" },
      { status: 400 },
    );
  }

  // Two-phase update to avoid unique index conflicts on (bookTemplateId, position):
  // Phase 1: shift all affected chapters to unique negative positions (no conflicts possible)
  // Phase 2: set to final target positions
  await db.transaction(async (tx) => {
    // Lock target chapter rows to serialize concurrent reorders
    await tx
      .select({ id: chapters.id })
      .from(chapters)
      .where(inArray(chapters.id, reordered.map((c) => c.id)))
      .for("update");

    for (let i = 0; i < reordered.length; i++) {
      await tx
        .update(chapters)
        .set({ position: -(i + 1) })
        .where(eq(chapters.id, reordered[i].id));
    }

    for (const ch of reordered) {
      await tx
        .update(chapters)
        .set({ position: ch.position })
        .where(eq(chapters.id, ch.id));
    }
  });

  return NextResponse.json({ ok: true });
}
