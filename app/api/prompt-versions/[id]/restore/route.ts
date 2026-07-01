import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { prompts, projects, promptVersions } from "@/lib/db/schema";
import { eq, and, isNull, isNotNull } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { requireAdmin } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";
import { syncChapterPlaceholders } from "@/lib/placeholders";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const { id } = await params;

  const [version] = await db
    .select()
    .from(promptVersions)
    .where(eq(promptVersions.id, id))
    .limit(1);

  if (!version) return NextResponse.json({ error: "not found" }, { status: 404 });

  // promptVersions.promptId references prompts.id (template or project-scoped).
  // Template prompts (projectId IS NULL) require admin; project prompts (projectId IS NOT NULL) require project ownership.
  const [templatePrompt] = await db
    .select({
      id: prompts.id,
      title: prompts.title,
      content: prompts.content,
      userPrompt: prompts.userPrompt,
      chapterId: prompts.chapterId,
    })
    .from(prompts)
    .where(and(eq(prompts.id, version.promptId), isNull(prompts.projectId)))
    .limit(1);

  if (templatePrompt) {
    const admin = await requireAdmin();
    if (!admin.authorized) return admin.response;

    // Restore prompt in a transaction and sync placeholders.
    // Restoring may add/remove {placeholder} tokens; stale chapterPlaceholders
    // cause missing or orphaned tokens on the next template usage.
    const restored = await db.transaction(async (tx) => {
      await tx.insert(promptVersions).values({
        promptId: templatePrompt.id,
        title: templatePrompt.title,
        content: templatePrompt.content,
        userPrompt: templatePrompt.userPrompt,
      });

      const [r] = await tx
        .update(prompts)
        .set({ title: version.title, content: version.content, userPrompt: version.userPrompt })
        .where(and(eq(prompts.id, version.promptId), isNull(prompts.projectId)))
        .returning();

      if (!r) throw { status: 404, message: "prompt not found" };

      // Sync placeholders for the template chapter
      const allPrompts = await tx
        .select({ content: prompts.content, userPrompt: prompts.userPrompt })
        .from(prompts)
        .where(eq(prompts.chapterId, r.chapterId));

      const contents = allPrompts.flatMap(
        (p) => [p.content, p.userPrompt].filter(Boolean) as string[],
      );

      await syncChapterPlaceholders(r.chapterId, contents, null, tx);

      return r;
    });

    return NextResponse.json(restored);
  }

  // Try project-scoped prompt — verify project ownership
  const [projectPrompt] = await db
    .select({
      id: prompts.id,
      title: prompts.title,
      content: prompts.content,
      userPrompt: prompts.userPrompt,
      chapterId: prompts.chapterId,
      projectId: prompts.projectId,
    })
    .from(prompts)
    .where(and(eq(prompts.id, version.promptId), isNotNull(prompts.projectId)))
    .limit(1);

  if (projectPrompt) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const [project] = await db
      .select({ userId: projects.userId, topic: projects.topic })
      .from(projects)
      .where(eq(projects.id, projectPrompt.projectId!))
      .limit(1);
    if (!project || project.userId !== user.id) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    // Restore prompt + sync chapter placeholders in a transaction.
    // Restoring may add/remove {placeholder} tokens in prompt content;
    // stale chapterPlaceholders cause missing or orphaned tokens on next generation.
    const restored = await db.transaction(async (tx) => {
      // Save current state as a new version before overwriting
      await tx.insert(promptVersions).values({
        promptId: projectPrompt.id,
        title: projectPrompt.title,
        content: projectPrompt.content,
        userPrompt: projectPrompt.userPrompt,
      });

      const [r] = await tx
        .update(prompts)
        .set({ title: version.title, content: version.content, userPrompt: version.userPrompt })
        .where(and(eq(prompts.id, version.promptId), isNotNull(prompts.projectId)))
        .returning();

      if (!r) throw { status: 404, message: "prompt not found" };

      // Sync placeholders: collect prompt contents after restore and reconcile
      const allPrompts = await tx
        .select({ content: prompts.content, userPrompt: prompts.userPrompt })
        .from(prompts)
        .where(eq(prompts.chapterId, r.chapterId));

      const contents = allPrompts.flatMap(
        (p) => [p.content, p.userPrompt].filter(Boolean) as string[],
      );

      await syncChapterPlaceholders(
        r.chapterId,
        contents,
        project.topic,
        tx,
      );

      return r;
    });

    return NextResponse.json(restored);
  }

  return NextResponse.json({ error: "prompt not found" }, { status: 404 });
}
