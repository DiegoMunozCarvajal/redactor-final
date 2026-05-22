import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  projects,
  chapters,
  projectPrompts,
  chapterBriefs,
  chapterConfigPrompts,
} from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, and, asc } from "drizzle-orm";
import { generateCompletion, type ReasoningEffort } from "@/lib/ai/completion";
import { csrfCheck } from "@/lib/api/csrf";

const DEFAULT_BRIEF_PROMPT = `You are a book editor. Based on the chapter title, the content prompts, and the project description, write a 2-3 sentence brief describing the chapter's scope, target reader, and desired outcome. Be specific and concise. Output ONLY the brief text, no JSON wrapper.`;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; chapterId: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id, chapterId } = await params;

  // Verify project ownership
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Verify chapter belongs to project
  const [chapter] = await db
    .select()
    .from(chapters)
    .where(and(eq(chapters.id, chapterId), eq(chapters.projectId, id)))
    .limit(1);
  if (!chapter)
    return NextResponse.json({ error: "chapter not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const model = (body.model as string) || undefined;
  const effort = body.effort as ReasoningEffort | undefined;

  // Load prompts for context
  const promptList = await db
    .select({ title: projectPrompts.title, content: projectPrompts.content })
    .from(projectPrompts)
    .where(
      and(
        eq(projectPrompts.projectId, id),
        eq(projectPrompts.chapterId, chapterId),
      ),
    )
    .orderBy(asc(projectPrompts.position));

  // Load custom system prompt if exists
  const [config] = await db
    .select()
    .from(chapterConfigPrompts)
    .where(
      and(
        eq(chapterConfigPrompts.chapterId, chapterId),
        eq(chapterConfigPrompts.type, "generate_brief"),
      ),
    );

  const systemPrompt = config?.content || DEFAULT_BRIEF_PROMPT;

  const userPrompt = `## Project
Name: ${(project.title ?? project.name) || "(unnamed)"}
Topic: ${project.topic || "(none)"}
Description: ${project.description || "(none)"}

## Chapter Prompts
${promptList
    .map(
      (p, i) =>
        `### ${p.title}\n${p.content.slice(0, 300)}${p.content.length > 300 ? "..." : ""}`,
    )
    .join("\n\n")}

Write a 2-3 sentence chapter brief.`;

  let briefContent: string;
  try {
    const result = await generateCompletion({
      model: model || "deepseek-v4-flash",
      systemPrompt,
      userPrompt,
      ...(effort ? { effort } : {}),
    });
    briefContent = (result.data as string).trim();
  } catch (err) {
    console.error("[brief/generate] AI call failed:", err);
    return NextResponse.json({ error: "Generation failed" }, { status: 502 });
  }

  const [brief] = await db
    .insert(chapterBriefs)
    .values({ chapterId, content: briefContent })
    .onConflictDoUpdate({
      target: chapterBriefs.chapterId,
      set: { content: briefContent, updatedAt: new Date() },
    })
    .returning();

  return NextResponse.json(brief);
}
