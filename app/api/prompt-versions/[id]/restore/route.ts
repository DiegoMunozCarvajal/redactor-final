import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { prompts, projectPrompts, projects, promptVersions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { requireAdmin } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";

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

  // promptVersions.promptId can reference either prompts.id (template) or
  // projectPrompts.id (project-scoped). Try template first, then project.
  // Template prompts require admin; project prompts require project ownership.
  const [templatePrompt] = await db
    .select()
    .from(prompts)
    .where(eq(prompts.id, version.promptId))
    .limit(1);

  if (templatePrompt) {
    // Template prompt restore — admin only
    const admin = await requireAdmin();
    if (!admin.authorized) return admin.response;

    await db.insert(promptVersions).values({
      promptId: templatePrompt.id,
      title: templatePrompt.title,
      content: templatePrompt.content,
      userPrompt: templatePrompt.userPrompt,
    });

    const [restored] = await db
      .update(prompts)
      .set({ title: version.title, content: version.content, userPrompt: version.userPrompt })
      .where(eq(prompts.id, version.promptId))
      .returning();

    if (!restored) return NextResponse.json({ error: "prompt not found" }, { status: 404 });
    return NextResponse.json(restored);
  }

  // Try project-scoped prompt — verify project ownership
  const [projectPrompt] = await db
    .select({
      id: projectPrompts.id,
      title: projectPrompts.title,
      content: projectPrompts.content,
      userPrompt: projectPrompts.userPrompt,
      projectId: projectPrompts.projectId,
    })
    .from(projectPrompts)
    .where(eq(projectPrompts.id, version.promptId))
    .limit(1);

  if (projectPrompt) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const [project] = await db
      .select({ userId: projects.userId })
      .from(projects)
      .where(eq(projects.id, projectPrompt.projectId))
      .limit(1);
    if (!project || project.userId !== user.id) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    await db.insert(promptVersions).values({
      promptId: projectPrompt.id,
      title: projectPrompt.title,
      content: projectPrompt.content,
      userPrompt: projectPrompt.userPrompt,
    });

    const [restored] = await db
      .update(projectPrompts)
      .set({ title: version.title, content: version.content, userPrompt: version.userPrompt })
      .where(eq(projectPrompts.id, version.promptId))
      .returning();

    if (!restored) return NextResponse.json({ error: "prompt not found" }, { status: 404 });
    return NextResponse.json(restored);
  }

  return NextResponse.json({ error: "prompt not found" }, { status: 404 });
}
