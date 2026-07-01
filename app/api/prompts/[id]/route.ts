import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { prompts, promptVersions, chapters, projects } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { requireAdmin } from "@/lib/auth/admin";
import { logAudit } from "@/lib/audit";
import { syncChapterPlaceholders } from "@/lib/placeholders";

// NOTE: Uses PUT for partial update (PATCH semantics).
// Kept as PUT for backward compatibility with admin UI.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const admin = await requireAdmin();
  if (!admin.authorized) return admin.response;

  const { id } = await params;

  // Admin can edit any prompt — no ownership check needed

  const body = await req.json().catch(() => ({}));
  const { title, content, userPrompt, position, isAssembly, isCritique, isCorrector } = body;

  if (content !== undefined && (typeof content !== "string" || content.length > 20000)) {
    return NextResponse.json({ error: "content too long" }, { status: 400 });
  }
  if (userPrompt !== undefined && (typeof userPrompt !== "string" || userPrompt.length > 20000)) {
    return NextResponse.json({ error: "userPrompt too long" }, { status: 400 });
  }

  // Load current role flags to validate final state, not just payload
  const [currentFlags] = await db
    .select({ isAssembly: prompts.isAssembly, isCritique: prompts.isCritique, isCorrector: prompts.isCorrector })
    .from(prompts)
    .where(eq(prompts.id, id))
    .limit(1);
  if (!currentFlags) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Validate role flags are mutually exclusive (compute next state, not just payload)
  const nextAssembly = isAssembly ?? currentFlags.isAssembly;
  const nextCritique = isCritique ?? currentFlags.isCritique;
  const nextCorrector = isCorrector ?? currentFlags.isCorrector;
  const roleCount = [nextAssembly, nextCritique, nextCorrector].filter(Boolean).length;
  if (roleCount > 1) {
    return NextResponse.json(
      { error: "at most one of isAssembly, isCritique, isCorrector can be true" },
      { status: 400 },
    );
  }

  // Version insert, prompt update, and placeholder sync in one transaction
  // so partial failure doesn't leave phantom versions or stale placeholders.
  const prompt = await db.transaction(async (tx) => {
    // Save version before updating
    const [current] = await tx
      .select()
      .from(prompts)
      .where(eq(prompts.id, id))
      .limit(1);
    if (current) {
      await tx.insert(promptVersions).values({
        promptId: current.id,
        title: current.title,
        content: current.content,
        userPrompt: current.userPrompt,
      });
    }

    const [updated] = await tx
      .update(prompts)
      .set({
        ...(title !== undefined && { title }),
        ...(content !== undefined && { content }),
        ...(userPrompt !== undefined && { userPrompt }),
        ...(position !== undefined && { position }),
        ...(isAssembly !== undefined && { isAssembly }),
        ...(isCritique !== undefined && { isCritique }),
        ...(isCorrector !== undefined && { isCorrector }),
      })
      .where(eq(prompts.id, id))
      .returning();

    if (!updated) return undefined;

    // Sync placeholders inside the same transaction
    const allPrompts = await tx
      .select({ content: prompts.content, userPrompt: prompts.userPrompt })
      .from(prompts)
      .where(eq(prompts.chapterId, updated.chapterId));
    await syncChapterPlaceholders(
      updated.chapterId,
      allPrompts.flatMap((p) => [p.content, p.userPrompt].filter(Boolean) as string[]),
      undefined,
      tx,
    );

    return updated;
  });

  if (!prompt) return NextResponse.json({ error: "not found" }, { status: 404 });

  logAudit({
    userId: admin.user.id,
    action: "prompt.update",
    resourceType: "prompt",
    resourceId: prompt.id,
    metadata: { title: prompt.title, isAssembly: prompt.isAssembly, isCritique: prompt.isCritique },
  });

  return NextResponse.json(prompt);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = csrfCheck(_req);
  if (csrfError) return csrfError;

  const admin = await requireAdmin();
  if (!admin.authorized) return admin.response;

  const { id } = await params;

  // Admin can delete any prompt — no ownership check needed

  // Capture chapter before deleting
  const [existing] = await db
    .select({ chapterId: prompts.chapterId })
    .from(prompts)
    .where(eq(prompts.id, id))
    .limit(1);

  await db.delete(prompts).where(eq(prompts.id, id));

  // Sync placeholders
  if (existing) {
    const allPrompts = await db
      .select({ content: prompts.content, userPrompt: prompts.userPrompt })
      .from(prompts)
      .where(eq(prompts.chapterId, existing.chapterId));
    await syncChapterPlaceholders(
      existing.chapterId,
      allPrompts.flatMap((p) => [p.content, p.userPrompt].filter(Boolean) as string[]),
    );
  }

  logAudit({
    userId: admin.user.id,
    action: "prompt.delete",
    resourceType: "prompt",
    resourceId: id,
  });

  return NextResponse.json({ ok: true });
}
