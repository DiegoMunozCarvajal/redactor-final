import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, prompts, promptVersions, fragments } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, and } from "drizzle-orm";
import { syncChapterPlaceholders } from "@/lib/placeholders";
import { csrfCheck } from "@/lib/api/csrf";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; promptId: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId, promptId } = await params;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const [existing] = await db
    .select()
    .from(prompts)
    .where(
      and(
        eq(prompts.id, promptId),
        eq(prompts.projectId, projectId),
      ),
    )
    .limit(1);
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const { title, content, userPrompt, position, isAssembly, isCritique, isCorrector } = body;

  // Validate role flags are mutually exclusive (compute next state, not just payload)
  const nextAssembly = isAssembly ?? existing.isAssembly;
  const nextCritique = isCritique ?? existing.isCritique;
  const nextCorrector = isCorrector ?? existing.isCorrector;
  const roleCount = [nextAssembly, nextCritique, nextCorrector].filter(Boolean).length;
  if (roleCount > 1) {
    return NextResponse.json(
      { error: "at most one of isAssembly, isCritique, isCorrector can be true" },
      { status: 400 },
    );
  }

  if (content !== undefined && (typeof content !== "string" || content.length > 20000)) {
    return NextResponse.json({ error: "content too long" }, { status: 400 });
  }

  // Version insert, prompt update, and placeholder sync in one transaction
  // so partial failure doesn't leave phantom versions or stale placeholders.
  const updated = await db.transaction(async (tx) => {
    // Save version before updating assembly or critique prompt
    if (isAssembly || isCritique || isCorrector || existing.isAssembly || existing.isCritique || existing.isCorrector) {
      await tx.insert(promptVersions).values({
        promptId: existing.id,
        title: existing.title,
        content: existing.content,
        userPrompt: existing.userPrompt,
      });
    }

    const [u] = await tx
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
      .where(eq(prompts.id, promptId))
      .returning();

    // Sync placeholders inside the same transaction
    if (u) {
      const allPrompts = await tx
        .select({ content: prompts.content, userPrompt: prompts.userPrompt })
        .from(prompts)
        .where(eq(prompts.chapterId, u.chapterId));
      await syncChapterPlaceholders(
        u.chapterId,
        allPrompts.flatMap((p) => [p.content, p.userPrompt].filter(Boolean) as string[]),
        project.topic,
        tx,
      );
    }

    return u;
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; promptId: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId, promptId } = await params;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const [existing] = await db
    .select()
    .from(prompts)
    .where(
      and(
        eq(prompts.id, promptId),
        eq(prompts.projectId, projectId),
      ),
    )
    .limit(1);
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await db.delete(fragments).where(eq(fragments.projectPromptId, promptId));
  await db.delete(prompts).where(eq(prompts.id, promptId));

  // Sync placeholders
  const remainingPrompts = await db
    .select({ content: prompts.content, userPrompt: prompts.userPrompt })
    .from(prompts)
    .where(eq(prompts.chapterId, existing.chapterId));
  await syncChapterPlaceholders(
    existing.chapterId,
    remainingPrompts.flatMap((p) => [p.content, p.userPrompt].filter(Boolean) as string[]),
    project.topic,
  );

  return NextResponse.json({ ok: true });
}
