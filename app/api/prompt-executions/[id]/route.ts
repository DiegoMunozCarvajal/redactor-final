import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  llmPromptExecutions,
  promptRevisions,
  promptDefinitions,
} from "@/lib/db/schema/prompt-registry";
import { projects } from "@/lib/db/schema/projects";
import { eq } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;

  const [execution] = await db
    .select()
    .from(llmPromptExecutions)
    .where(eq(llmPromptExecutions.id, id))
    .limit(1);

  if (!execution) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Admin can view any execution
  const isAdmin = user.app_metadata?.role === "admin";

  if (!isAdmin) {
    // Verify owner
    if (execution.projectId) {
      const [project] = await db
        .select({ userId: projects.userId })
        .from(projects)
        .where(eq(projects.id, execution.projectId))
        .limit(1);

      if (!project || project.userId !== user.id) {
        return NextResponse.json({ error: "not found" }, { status: 404 });
      }
    } else {
      // No project context — admin only
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
  }

  // Attach revision display data
  let revision = null;
  if (execution.promptRevisionId) {
    const [rev] = await db
      .select({
        id: promptRevisions.id,
        versionLabel: promptRevisions.versionLabel,
        definitionName: promptDefinitions.name,
      })
      .from(promptRevisions)
      .innerJoin(promptDefinitions, eq(promptRevisions.promptDefinitionId, promptDefinitions.id))
      .where(eq(promptRevisions.id, execution.promptRevisionId))
      .limit(1);
    revision = rev ?? null;
  }

  return NextResponse.json({
    ...execution,
    revision,
  });
}
