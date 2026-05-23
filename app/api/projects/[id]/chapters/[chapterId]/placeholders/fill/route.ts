import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  projects,
  chapterBriefs,
  projectPrompts,
  chapterPlaceholders,
  chapters,
} from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, and, asc } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { type ReasoningEffort } from "@/lib/ai/completion";
import { researchPlaceholders, fillPlaceholders } from "@/lib/ai/placeholder-fill";
import { resolvePlaceholdersDirect } from "@/lib/placeholders";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; chapterId: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId, chapterId } = await params;

  // Verify project ownership
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Verify chapter belongs to project
  const [chapter] = await db
    .select()
    .from(chapters)
    .where(and(eq(chapters.id, chapterId), eq(chapters.projectId, projectId)))
    .limit(1);
  if (!chapter) {
    return NextResponse.json({ error: "chapter not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const model = (body.model as string) || undefined;
  const effort = body.effort as ReasoningEffort | undefined;
  const temperatureRaw = body.temperature;
  if (temperatureRaw !== undefined && (typeof temperatureRaw !== "number" || temperatureRaw < 0 || temperatureRaw > 1)) {
    return NextResponse.json({ error: "temperature must be a number between 0 and 1" }, { status: 400 });
  }
  const temperature = temperatureRaw as number | undefined;

  // Load context
  const [brief] = await db
    .select()
    .from(chapterBriefs)
    .where(eq(chapterBriefs.chapterId, chapterId));
  const placeholderRows = await db
    .select()
    .from(chapterPlaceholders)
    .where(eq(chapterPlaceholders.chapterId, chapterId))
    .orderBy(asc(chapterPlaceholders.name));
  const promptRows = await db
    .select({ content: projectPrompts.content })
    .from(projectPrompts)
    .where(eq(projectPrompts.chapterId, chapterId))
    .orderBy(asc(projectPrompts.position));

  const placeholderNames = placeholderRows.map((p) => p.name);
  const chapterBrief = brief?.content ?? "";
  const projectDescription = project.description ?? "";
  const promptContents = promptRows.map((p) => p.content);

  if (placeholderNames.length === 0) {
    return NextResponse.json({ error: "no placeholders to fill" }, { status: 400 });
  }

  // Phase 0: Resolve placeholders directly from project data (no LLM)
  const { resolved, unresolved } = resolvePlaceholdersDirect(
    placeholderNames,
    project.topic ?? null,
    chapterBrief,
  );

  // Persist direct resolutions
  for (const [name, definition] of Object.entries(resolved)) {
    await db
      .update(chapterPlaceholders)
      .set({ definition })
      .where(
        and(
          eq(chapterPlaceholders.chapterId, chapterId),
          eq(chapterPlaceholders.name, name),
        ),
      );
  }

  // Phase 1: Research only unresolved placeholders
  const searchResults =
    unresolved.length > 0
      ? await researchPlaceholders(unresolved, chapterBrief, projectDescription)
      : {};

  // Phase 2: Generate + stream via SSE (only unresolved)
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Emit directly resolved placeholders first
      for (const [name, definition] of Object.entries(resolved)) {
        const event = { type: "placeholder" as const, name, definition, sources: [] };
        controller.enqueue(encoder.encode(`event: placeholder\ndata: ${JSON.stringify(event)}\n\n`));
      }

      if (unresolved.length === 0) {
        controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ type: "done" })}\n\n`));
        controller.close();
        return;
      }

      try {
        for await (const event of fillPlaceholders(
          unresolved,
          chapterBrief,
          projectDescription,
          promptContents,
          searchResults,
          model,
          undefined,
          effort,
          temperature,
        )) {
          const data = JSON.stringify(event);
          controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${data}\n\n`));

          // Persist definition to DB on placeholder event
          if (event.type === "placeholder" && event.name && event.definition) {
            await db
              .update(chapterPlaceholders)
              .set({ definition: event.definition })
              .where(
                and(
                  eq(chapterPlaceholders.chapterId, chapterId),
                  eq(chapterPlaceholders.name, event.name),
                ),
              );
          }
        }
      } catch (err) {
        const errorEvent = { type: "error", error: (err as Error).message };
        controller.enqueue(
          encoder.encode(`event: error\ndata: ${JSON.stringify(errorEvent)}\n\n`),
        );
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
