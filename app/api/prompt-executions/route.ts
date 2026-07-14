import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  llmPromptExecutions,
  promptRevisions,
  promptDefinitions,
} from "@/lib/db/schema/prompt-registry";
import { projects } from "@/lib/db/schema/projects";
import { eq, desc, and } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/admin";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const chapterGenerationId = searchParams.get("chapterGenerationId");
  const bookTemplateId = searchParams.get("bookTemplateId");
  const stage = searchParams.get("stage");

  // Require exactly one scope filter
  const scopes = [projectId, chapterGenerationId, bookTemplateId].filter(Boolean);
  if (scopes.length !== 1) {
    return NextResponse.json(
      { error: "exactly one scope filter required: projectId, chapterGenerationId, or bookTemplateId" },
      { status: 400 },
    );
  }

  // Verify ownership
  if (projectId) {
    const [project] = await db
      .select({ userId: projects.userId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project || project.userId !== user.id) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
  } else if (chapterGenerationId) {
    // Verify chapter generation belongs to user's project
    const { chapterGenerations } = await import("@/lib/db/schema/chapter-generations");
    const [gen] = await db
      .select({ projectId: chapterGenerations.projectId })
      .from(chapterGenerations)
      .where(eq(chapterGenerations.id, chapterGenerationId))
      .limit(1);

    if (!gen) return NextResponse.json({ error: "not found" }, { status: 404 });

    const [project] = await db
      .select({ userId: projects.userId })
      .from(projects)
      .where(eq(projects.id, gen.projectId))
      .limit(1);

    if (!project || project.userId !== user.id) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
  } else {
    // bookTemplateId: admin only
    const admin = await requireAdmin();
    if (!admin.authorized) return admin.response;
  }

  // Build query
  let where = undefined;
  if (projectId) where = eq(llmPromptExecutions.projectId, projectId);
  else if (chapterGenerationId) where = eq(llmPromptExecutions.chapterGenerationId, chapterGenerationId);
  else if (bookTemplateId) where = eq(llmPromptExecutions.bookTemplateId, bookTemplateId);

  const conditions = stage ? and(where!, eq(llmPromptExecutions.stage, stage)) : where!;

  const executions = await db
    .select({
      id: llmPromptExecutions.id,
      stage: llmPromptExecutions.stage,
      status: llmPromptExecutions.status,
      model: llmPromptExecutions.model,
      provider: llmPromptExecutions.provider,
      createdAt: llmPromptExecutions.createdAt,
      completedAt: llmPromptExecutions.completedAt,
      versionLabel: promptRevisions.versionLabel,
      promptName: promptDefinitions.name,
    })
    .from(llmPromptExecutions)
    .leftJoin(promptRevisions, eq(llmPromptExecutions.promptRevisionId, promptRevisions.id))
    .leftJoin(promptDefinitions, eq(promptRevisions.promptDefinitionId, promptDefinitions.id))
    .where(conditions)
    .orderBy(desc(llmPromptExecutions.createdAt))
    .limit(100);

  return NextResponse.json(executions);
}
