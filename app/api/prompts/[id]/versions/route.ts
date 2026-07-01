import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { promptVersions, projectPrompts, projects, prompts } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
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

  // promptVersions.promptId can reference either prompts.id (template) or
  // projectPrompts.id (project). Try template first, then project.
  const [templatePrompt] = await db
    .select({ id: prompts.id })
    .from(prompts)
    .where(eq(prompts.id, id))
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
      .orderBy(desc(promptVersions.createdAt));

    return NextResponse.json(versions);
  }

  // Try project-scoped prompt — verify ownership
  const [owned] = await db
    .select({ id: projectPrompts.id })
    .from(projectPrompts)
    .innerJoin(projects, eq(projectPrompts.projectId, projects.id))
    .where(and(eq(projectPrompts.id, id), eq(projects.userId, user.id)))
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
    .orderBy(desc(promptVersions.createdAt));

  return NextResponse.json(versions);
}
