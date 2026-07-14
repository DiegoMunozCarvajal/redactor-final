import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, prompts, promptVersions } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, and, desc, max } from "drizzle-orm";
import { assertExclusiveRoles } from "@/lib/prompts/chapter-revisions";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; promptId: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId, promptId } = await params;

  // Verify project ownership
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.userId !== user.id)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  // Verify prompt belongs to this project before listing versions.
  // promptVersions.promptId has no FK — an arbitrary UUID could leak metadata.
  const [prompt] = await db
    .select({ id: prompts.id })
    .from(prompts)
    .where(and(eq(prompts.id, promptId), eq(prompts.projectId, projectId)))
    .limit(1);
  if (!prompt)
    return NextResponse.json({ error: "prompt not found" }, { status: 404 });

  const versions = await db
    .select({
      id: promptVersions.id,
      title: promptVersions.title,
      createdAt: promptVersions.createdAt,
    })
    .from(promptVersions)
    .where(eq(promptVersions.promptId, promptId))
    .orderBy(desc(promptVersions.createdAt))
    .limit(50);

  return NextResponse.json(versions);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; promptId: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId, promptId } = await params;

  // Verify project ownership
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.userId !== user.id)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  // Verify prompt belongs to this project
  const [prompt] = await db
    .select({ id: prompts.id })
    .from(prompts)
    .where(and(eq(prompts.id, promptId), eq(prompts.projectId, projectId)))
    .limit(1);
  if (!prompt)
    return NextResponse.json({ error: "prompt not found" }, { status: 404 });

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
    .where(eq(promptVersions.promptId, promptId))
    .limit(1);
  const nextRevision = (maxResult?.maxRevision ?? 0) + 1;

  const [version] = await db
    .insert(promptVersions)
    .values({
      promptId,
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
