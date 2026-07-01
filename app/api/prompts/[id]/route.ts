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
      userPrompt: current.userPrompt,
    });
  }

  const [prompt] = await db
    .update(prompts)
    .set({ title, content, userPrompt, position, isAssembly, isCritique, isCorrector })
    .where(eq(prompts.id, id))
    .returning();

  if (!prompt) return NextResponse.json({ error: "not found" }, { status: 404 });

  logAudit({
    userId: admin.user.id,
    action: "prompt.update",
    resourceType: "prompt",
    resourceId: prompt.id,
    metadata: { title: prompt.title, isAssembly: prompt.isAssembly, isCritique: prompt.isCritique },
  });

  // Sync placeholders for the prompt's chapter
  if (prompt) {
    const allPrompts = await db
      .select({ content: prompts.content, userPrompt: prompts.userPrompt })
      .from(prompts)
      .where(eq(prompts.chapterId, prompt.chapterId));
    await syncChapterPlaceholders(
      prompt.chapterId,
      allPrompts.flatMap((p) => [p.content, p.userPrompt].filter(Boolean) as string[]),
    );
  }

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
