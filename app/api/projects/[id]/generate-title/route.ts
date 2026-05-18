import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq } from "drizzle-orm";
import { generatePromptContent } from "@/lib/generate";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId } = await params;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const result = await generatePromptContent({
    prompt: {
      content:
        'Genera un título y subtítulo atractivo para un libro sobre [TEMA]. Responde en formato JSON: { "title": "...", "subtitle": "..." }',
      styleRules:
        "Español claro. Título memorable, subtítulo descriptivo.",
      knowledgeAreas: null,
      suggestedLength: null,
    },
    topic: project.topic,
  });

  let title = "";
  let subtitle = "";
  try {
    const parsed = JSON.parse(result.text);
    title = parsed.title;
    subtitle = parsed.subtitle;
  } catch {
    return NextResponse.json(
      { error: "Failed to parse title from model response" },
      { status: 500 },
    );
  }

  await db
    .update(projects)
    .set({ title, subtitle: subtitle || null })
    .where(eq(projects.id, projectId));

  return NextResponse.json({ title, subtitle });
}
