import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { prompts } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/admin";
import { eq, asc, sql } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { logAudit } from "@/lib/audit";
import { syncChapterPlaceholders } from "@/lib/placeholders";
import { writeCurrentChapterPromptRevision } from "@/lib/prompts/chapter-revisions";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin.authorized) return admin.response;

  const { id } = await params;
  const result = await db
    .select()
    .from(prompts)
    .where(eq(prompts.chapterId, id))
    .orderBy(asc(prompts.position));
  return NextResponse.json(result);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const admin = await requireAdmin();
  if (!admin.authorized) return admin.response;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { title, content, userPrompt, position, isAssembly, isCritique, isCorrector } = body;

  if (!title || !content) {
    return NextResponse.json({ error: "title and content are required" }, { status: 400 });
  }
  if (typeof title !== "string" || title.length > 500) {
    return NextResponse.json({ error: "title must be a string under 500 characters" }, { status: 400 });
  }
  if (typeof content !== "string" || content.length > 20000) {
    return NextResponse.json({ error: "content too long" }, { status: 400 });
  }
  for (const flag of [["isAssembly", isAssembly], ["isCritique", isCritique], ["isCorrector", isCorrector]] as const) {
    if (flag[1] !== undefined && typeof flag[1] !== "boolean") {
      return NextResponse.json({ error: `${flag[0]} must be a boolean` }, { status: 400 });
    }
  }

  // Insert prompt + revision atomically in one transaction.
  // Without this, a crash between insert and revision leaves
  // currentRevisionId null and generation fails.
  const prompt = await db.transaction(async (tx) => {
    const existing = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(prompts)
      .where(eq(prompts.chapterId, id));

    const pos = position ?? (existing[0]?.count ?? 0);

    const [p] = await tx
      .insert(prompts)
      .values({
        chapterId: id,
        title,
        content,
        userPrompt,
        position: pos,
        isAssembly: isAssembly ?? false,
        isCritique: isCritique ?? false,
        isCorrector: isCorrector ?? false,
      })
      .returning();

    await writeCurrentChapterPromptRevision(p.id, admin.user.id, tx);
    return p;
  });

  await logAudit({
    userId: admin.user.id,
    action: "prompt.create",
    resourceType: "prompt",
    resourceId: prompt.id,
    metadata: { title: prompt.title, isAssembly: prompt.isAssembly, isCritique: prompt.isCritique, chapterId: id },
  });

  // Sync placeholders for this chapter
  const allPrompts = await db
    .select({ content: prompts.content, userPrompt: prompts.userPrompt })
    .from(prompts)
    .where(eq(prompts.chapterId, id));
  await syncChapterPlaceholders(
    id,
    allPrompts.flatMap((p) => [p.content, p.userPrompt].filter(Boolean) as string[]),
  );

  return NextResponse.json(prompt);
}
