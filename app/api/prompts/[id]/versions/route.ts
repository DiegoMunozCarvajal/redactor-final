import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { promptVersions, projects, prompts } from "@/lib/db/schema";
import { eq, and, desc, isNotNull, isNull, max } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/admin";
import { writeCurrentChapterPromptRevision, assertExclusiveRoles } from "@/lib/prompts/chapter-revisions";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;

  // promptVersions.promptId can reference either prompts.id (template) or
  // project-scoped prompts.id. Try template first, then project.
  const [templatePrompt] = await db
    .select({ id: prompts.id })
    .from(prompts)
    .where(and(eq(prompts.id, id), isNull(prompts.projectId)))
    .limit(1);

  if (templatePrompt) {
    // Template prompt — admin only
    const admin = await requireAdmin();
    if (!admin.authorized) return admin.response;

    const versions = await db
      .select({
        id: promptVersions.id,
        title: promptVersions.title,
        createdAt: promptVersions.createdAt,
      })
      .from(promptVersions)
      .where(eq(promptVersions.promptId, id))
      .orderBy(desc(promptVersions.createdAt))
      .limit(50);

    return NextResponse.json(versions);
  }

  // Try project-scoped prompt — verify ownership
  const [owned] = await db
    .select({ id: prompts.id })
    .from(prompts)
    .innerJoin(projects, eq(prompts.projectId, projects.id))
    .where(and(eq(prompts.id, id), isNotNull(prompts.projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });

  const versions = await db
    .select({
      id: promptVersions.id,
      title: promptVersions.title,
      createdAt: promptVersions.createdAt,
    })
    .from(promptVersions)
    .where(eq(promptVersions.promptId, id))
    .orderBy(desc(promptVersions.createdAt))
    .limit(50);

  return NextResponse.json(versions);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;

  // Determine if this is a template or project prompt
  const [templatePrompt] = await db
    .select({ id: prompts.id })
    .from(prompts)
    .where(and(eq(prompts.id, id), isNull(prompts.projectId)))
    .limit(1);

  if (templatePrompt) {
    const admin = await requireAdmin();
    if (!admin.authorized) return admin.response;

    const body = await req.json().catch(() => ({}));

    // Validate and build snapshot from body fields
    const snapshot = {
      title: body.title,
      content: body.content,
      userPrompt: body.userPrompt ?? null,
      position: body.position ?? null,
      isAssembly: body.isAssembly ?? false,
      isCritique: body.isCritique ?? false,
      isCorrector: body.isCorrector ?? false,
      function: body.function ?? null,
      notes: body.notes ?? null,
      sourceContext: body.sourceContext ?? null,
      legacyIncomplete: false,
    };

    assertExclusiveRoles(snapshot);

    const [maxResult] = await db
      .select({ maxRevision: max(promptVersions.revisionNumber) })
      .from(promptVersions)
      .where(eq(promptVersions.promptId, id))
      .limit(1);
    const nextRevision = (maxResult?.maxRevision ?? 0) + 1;

    const [version] = await db
      .insert(promptVersions)
      .values({
        promptId: id,
        revisionNumber: nextRevision,
        title: snapshot.title,
        content: snapshot.content,
        userPrompt: snapshot.userPrompt,
        snapshot,
        createdBy: admin.user.id,
      })
      .returning();

    return NextResponse.json(version, { status: 201 });
  }

  // Project-scoped prompt
  const [owned] = await db
    .select({ id: prompts.id })
    .from(prompts)
    .innerJoin(projects, eq(prompts.projectId, projects.id))
    .where(and(eq(prompts.id, id), isNotNull(prompts.projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));

  const snapshot = {
    title: body.title,
    content: body.content,
    userPrompt: body.userPrompt ?? null,
    position: body.position ?? null,
    isAssembly: body.isAssembly ?? false,
    isCritique: body.isCritique ?? false,
    isCorrector: body.isCorrector ?? false,
    function: body.function ?? null,
    notes: body.notes ?? null,
    sourceContext: body.sourceContext ?? null,
    legacyIncomplete: false,
  };

  assertExclusiveRoles(snapshot);

  const [maxResult] = await db
    .select({ maxRevision: max(promptVersions.revisionNumber) })
    .from(promptVersions)
    .where(eq(promptVersions.promptId, id))
    .limit(1);
  const nextRevision = (maxResult?.maxRevision ?? 0) + 1;

  const [version] = await db
    .insert(promptVersions)
    .values({
      promptId: id,
      revisionNumber: nextRevision,
      title: snapshot.title,
      content: snapshot.content,
      userPrompt: snapshot.userPrompt,
      snapshot,
      createdBy: user.id,
    })
    .returning();

  return NextResponse.json(version, { status: 201 });
}
