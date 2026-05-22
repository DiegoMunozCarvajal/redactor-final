import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { generateCompletion, type ReasoningEffort } from "@/lib/ai/completion";

const DESCRIPTION_PROMPT = `You are a book editor. Based on the book's name, write a concise 2-4 sentence description of what the book is about. The description should be specific, informative, and written in Spanish. Output ONLY the description text, no JSON wrapper, no labels.`;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const model = (body.model as string) || undefined;
  const effort = body.effort as ReasoningEffort | undefined;

  if (!project.name) {
    return NextResponse.json({ error: "project has no name" }, { status: 400 });
  }

  const bookName = project.title ?? project.name;
  const userPrompt = `Book name: ${bookName}\n\nWrite a concise 2-4 sentence description of this book in Spanish.`;

  try {
    const result = await generateCompletion({
      model: model || "deepseek-v4-flash",
      systemPrompt: DESCRIPTION_PROMPT,
      userPrompt,
      ...(effort ? { effort } : {}),
    });

    const description = (result.data as string).trim();

    await db
      .update(projects)
      .set({ description })
      .where(eq(projects.id, id));

    return NextResponse.json({ description });
  } catch (err) {
    console.error("[description/generate] Failed:", err);
    return NextResponse.json(
      { error: "Generation failed" },
      { status: 502 },
    );
  }
}
