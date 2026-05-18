import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, chapters, prompts, projectPrompts } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, asc, desc } from "drizzle-orm";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const result = await db
    .select()
    .from(projects)
    .where(eq(projects.userId, user.id))
    .orderBy(desc(projects.createdAt));
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, topic, bookTemplateId } = body;

  if (!name || !topic || !bookTemplateId) {
    return NextResponse.json(
      { error: "name, topic, and bookTemplateId are required" },
      { status: 400 },
    );
  }

  const [project] = await db
    .insert(projects)
    .values({ userId: user.id, name, topic, bookTemplateId })
    .returning();

  // Copy template prompts to project_prompts
  const templateChapters = await db
    .select()
    .from(chapters)
    .where(eq(chapters.bookTemplateId, bookTemplateId))
    .orderBy(asc(chapters.position));

  for (const chapter of templateChapters) {
    const templatePrompts = await db
      .select()
      .from(prompts)
      .where(eq(prompts.chapterId, chapter.id))
      .orderBy(asc(prompts.position));

    if (templatePrompts.length > 0) {
      await db.insert(projectPrompts).values(
        templatePrompts.map((p) => ({
          projectId: project.id,
          chapterId: chapter.id,
          position: p.position,
          type: p.type,
          title: p.title,
          content: p.content,
          styleRules: p.styleRules,
          knowledgeAreas: p.knowledgeAreas,
          suggestedLength: p.suggestedLength,
        })),
      );
    }
  }

  return NextResponse.json(project);
}
