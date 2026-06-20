import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, projectPrompts, promptVersions, fragments } from "@/lib/db/schema";
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
    .from(projectPrompts)
    .where(
      and(
        eq(projectPrompts.id, promptId),
        eq(projectPrompts.projectId, projectId),
      ),
    )
    .limit(1);
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const { title, content, userPrompt, position, isAssembly, isCritique, isCorrector } = body;

  if (content !== undefined && (typeof content !== "string" || content.length > 20000)) {
    return NextResponse.json({ error: "content too long" }, { status: 400 });
  }

  // Save version before updating assembly or critique prompt
  if (isAssembly || isCritique || isCorrector || existing.isAssembly || existing.isCritique || existing.isCorrector) {
    await db.insert(promptVersions).values({
      promptId: existing.id,
      title: existing.title,
      content: existing.content,
      userPrompt: existing.userPrompt,
    });
  }

  const [updated] = await db
    .update(projectPrompts)
    .set({
      ...(title !== undefined && { title }),
      ...(content !== undefined && { content }),
      ...(userPrompt !== undefined && { userPrompt }),
      ...(position !== undefined && { position }),
      ...(isAssembly !== undefined && { isAssembly }),
      ...(isCritique !== undefined && { isCritique }),
      ...(isCorrector !== undefined && { isCorrector }),
    })
    .where(eq(projectPrompts.id, promptId))
    .returning();

  // Sync placeholders
  if (updated) {
    const allPrompts = await db
      .select({ content: projectPrompts.content, userPrompt: projectPrompts.userPrompt })
      .from(projectPrompts)
      .where(eq(projectPrompts.chapterId, updated.chapterId));
    await syncChapterPlaceholders(
      updated.chapterId,
      allPrompts.flatMap((p) => [p.content, p.userPrompt].filter(Boolean) as string[]),
      project.topic,
    );
  }

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
    .from(projectPrompts)
    .where(
      and(
        eq(projectPrompts.id, promptId),
        eq(projectPrompts.projectId, projectId),
      ),
    )
    .limit(1);
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await db.delete(fragments).where(eq(fragments.projectPromptId, promptId));
  await db.delete(projectPrompts).where(eq(projectPrompts.id, promptId));

  // Sync placeholders
  const remainingPrompts = await db
    .select({ content: projectPrompts.content, userPrompt: projectPrompts.userPrompt })
    .from(projectPrompts)
    .where(eq(projectPrompts.chapterId, existing.chapterId));
  await syncChapterPlaceholders(
    existing.chapterId,
    remainingPrompts.flatMap((p) => [p.content, p.userPrompt].filter(Boolean) as string[]),
    project.topic,
  );

  return NextResponse.json({ ok: true });
}
