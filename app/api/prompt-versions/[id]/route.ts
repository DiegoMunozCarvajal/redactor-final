import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { promptVersions, prompts, projects } from "@/lib/db/schema";
import { eq, and, isNull, isNotNull } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/admin";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const [version] = await db
    .select({ id: promptVersions.id, title: promptVersions.title, content: promptVersions.content, createdAt: promptVersions.createdAt, promptId: promptVersions.promptId })
    .from(promptVersions)
    .where(eq(promptVersions.id, id))
    .limit(1);

  if (!version) return NextResponse.json({ error: "not found" }, { status: 404 });

  // promptVersions.promptId references either prompts.id (template) or projectPrompts.id (project).
  // Template versions: any authenticated user. Project versions: owner only.
  const [projectPrompt] = await db
    .select({ projectId: prompts.projectId })
    .from(prompts)
    .where(and(eq(prompts.id, version.promptId), isNotNull(prompts.projectId)))
    .limit(1);

  if (projectPrompt) {
    const [project] = await db
      .select({ userId: projects.userId })
      .from(projects)
      .where(eq(projects.id, projectPrompt.projectId!))
      .limit(1);
    if (!project || project.userId !== user.id) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
  } else {
    // Not a project prompt — check if it's a template prompt
    const [templatePrompt] = await db
      .select({ id: prompts.id })
      .from(prompts)
      .where(and(eq(prompts.id, version.promptId), isNull(prompts.projectId)))
      .limit(1);
    if (!templatePrompt) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    // Template prompts require admin per project policy (CLAUDE.md)
    const admin = await requireAdmin();
    if (!admin.authorized) return admin.response;
  }

  const { promptId: _, ...rest } = version;
  return NextResponse.json(rest);
}
