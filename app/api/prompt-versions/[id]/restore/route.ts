import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { prompts, projects, promptVersions } from "@/lib/db/schema";
import { eq, and, isNull, isNotNull, max } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { requireAdmin } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";
import { syncChapterPlaceholders } from "@/lib/placeholders";
import { writeCurrentChapterPromptRevision } from "@/lib/prompts/chapter-revisions";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { id } = await params;

  // Parse request body for optional allowLegacyRestore flag
  const body = await req.json().catch(() => ({}));
  const allowLegacyRestore = body?.allowLegacyRestore === true;

  const [version] = await db
    .select()
    .from(promptVersions)
    .where(eq(promptVersions.id, id))
    .limit(1);

  if (!version) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Reject legacy incomplete snapshots unless caller explicitly opts in
  if (version.snapshot?.legacyIncomplete && !allowLegacyRestore) {
    return NextResponse.json(
      {
        error:
          "This version has incomplete data and cannot be fully restored. " +
          "Set allowLegacyRestore: true to force restore with available fields.",
      },
      { status: 400 },
    );
  }

  const snapshot = version.snapshot;

  // Try template prompt path first (projectId IS NULL)
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

    const result = await db.transaction(async (tx) => {
      // 1. Capture pre-restore state as a version
      await writeCurrentChapterPromptRevision(templatePrompt.id, admin.user.id, tx);

      // 2. Compute next revision number for the new restore version
      const [maxResult] = await tx
        .select({ maxRevision: max(promptVersions.revisionNumber) })
        .from(promptVersions)
        .where(eq(promptVersions.promptId, templatePrompt.id))
        .limit(1);
      const nextRevision = (maxResult?.maxRevision ?? 0) + 1;

      // 3. Restore all snapshot fields to the prompt row
      const [r] = await tx
        .update(prompts)
        .set({
          title: snapshot.title,
          content: snapshot.content,
          userPrompt: snapshot.userPrompt ?? null,
          position: snapshot.position ?? 0,
          isAssembly: snapshot.isAssembly ?? false,
          isCritique: snapshot.isCritique ?? false,
          isCorrector: snapshot.isCorrector ?? false,
          function: snapshot.function ?? null,
          notes: snapshot.notes ?? null,
          sourceContext: snapshot.sourceContext ?? null,
        })
        .where(eq(prompts.id, templatePrompt.id))
        .returning();

      if (!r) throw new Error("prompt not found");

      // 4. Create a NEW current revision with the restored snapshot
      const [restoreVersion] = await tx
        .insert(promptVersions)
        .values({
          promptId: templatePrompt.id,
          revisionNumber: nextRevision,
          title: snapshot.title,
          content: snapshot.content,
          userPrompt: snapshot.userPrompt ?? null,
          snapshot,
          createdBy: admin.user.id,
        })
        .returning();

      // 5. Set currentRevisionId to the new restore version
      await tx
        .update(prompts)
        .set({ currentRevisionId: restoreVersion.id })
        .where(eq(prompts.id, templatePrompt.id));

      // 6. Sync placeholders for the template chapter
      const allPrompts = await tx
        .select({ content: prompts.content, userPrompt: prompts.userPrompt })
        .from(prompts)
        .where(eq(prompts.chapterId, r.chapterId));
      const contents = allPrompts.flatMap(
        (p) => [p.content, p.userPrompt].filter(Boolean) as string[],
      );
      await syncChapterPlaceholders(r.chapterId, contents, null, tx);

      return { restored: r, newRevisionId: restoreVersion.id };
    });

    return NextResponse.json({
      ...result.restored,
      currentRevisionId: result.newRevisionId,
    });
  }

  // Try project-scoped prompt (projectId IS NOT NULL)
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
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const [project] = await db
      .select({ userId: projects.userId, topic: projects.topic })
      .from(projects)
      .where(eq(projects.id, projectPrompt.projectId!))
      .limit(1);
    if (!project || project.userId !== user.id) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const result = await db.transaction(async (tx) => {
      // 1. Capture pre-restore state as a version
      await writeCurrentChapterPromptRevision(projectPrompt.id, user.id, tx);

      // 2. Compute next revision number
      const [maxResult] = await tx
        .select({ maxRevision: max(promptVersions.revisionNumber) })
        .from(promptVersions)
        .where(eq(promptVersions.promptId, projectPrompt.id))
        .limit(1);
      const nextRevision = (maxResult?.maxRevision ?? 0) + 1;

      // 3. Restore all snapshot fields
      const [r] = await tx
        .update(prompts)
        .set({
          title: snapshot.title,
          content: snapshot.content,
          userPrompt: snapshot.userPrompt ?? null,
          position: snapshot.position ?? 0,
          isAssembly: snapshot.isAssembly ?? false,
          isCritique: snapshot.isCritique ?? false,
          isCorrector: snapshot.isCorrector ?? false,
          function: snapshot.function ?? null,
          notes: snapshot.notes ?? null,
          sourceContext: snapshot.sourceContext ?? null,
        })
        .where(eq(prompts.id, projectPrompt.id))
        .returning();

      if (!r) throw new Error("prompt not found");

      // 4. Create a new current revision with restored snapshot
      const [restoreVersion] = await tx
        .insert(promptVersions)
        .values({
          promptId: projectPrompt.id,
          revisionNumber: nextRevision,
          title: snapshot.title,
          content: snapshot.content,
          userPrompt: snapshot.userPrompt ?? null,
          snapshot,
          createdBy: user.id,
        })
        .returning();

      // 5. Set currentRevisionId to the new version
      await tx
        .update(prompts)
        .set({ currentRevisionId: restoreVersion.id })
        .where(eq(prompts.id, projectPrompt.id));

      // 6. Sync placeholders with project topic
      const allPrompts = await tx
        .select({ content: prompts.content, userPrompt: prompts.userPrompt })
        .from(prompts)
        .where(eq(prompts.chapterId, r.chapterId));
      const contents = allPrompts.flatMap(
        (p) => [p.content, p.userPrompt].filter(Boolean) as string[],
      );
      await syncChapterPlaceholders(r.chapterId, contents, project.topic, tx);

      return { restored: r, newRevisionId: restoreVersion.id };
    });

    return NextResponse.json({
      ...result.restored,
      currentRevisionId: result.newRevisionId,
    });
  }

  return NextResponse.json({ error: "prompt not found" }, { status: 404 });
}
