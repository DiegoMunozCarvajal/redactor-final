import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq } from "drizzle-orm";
import { generatePromptContent } from "@/lib/generate";
import { checkProjectRateLimit, withProjectLock } from "@/lib/api/rate-limit";
import { csrfCheck } from "@/lib/api/csrf";

const titleResponseSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().optional(),
});

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfError = csrfCheck(_req);
  if (csrfError) return csrfError;

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

  // Serialize rate limit check and generation under advisory lock
  // to close the TOCTOU window between rate check and dispatch.
  const lockResult = await withProjectLock(projectId, async () => {
    const rateCheck = await checkProjectRateLimit(projectId);
    if (!rateCheck.allowed) {
      return { rateLimited: true as const, retryAfter: rateCheck.retryAfter };
    }

    const result = await generatePromptContent({
      prompt: {
        content:
          'Genera un título y subtítulo atractivo para un libro sobre [TEMA]. Responde en formato JSON: { "title": "...", "subtitle": "..." }',
      },
      topic: project.topic,
    });

    let title = "";
    let subtitle = "";
    try {
      const parsed = titleResponseSchema.parse(JSON.parse(result.text));
      title = parsed.title;
      subtitle = parsed.subtitle ?? "";
    } catch (err) {
      console.error(
        "[generate-title] Failed to parse title JSON:",
        err instanceof Error ? err.message : "Unknown error",
      );
      return { error: "Failed to parse title from model response", status: 500 };
    }

    await db
      .update(projects)
      .set({ title, subtitle: subtitle || null })
      .where(eq(projects.id, projectId));

    return { title, subtitle };
  });

  if (!lockResult.locked) {
    return NextResponse.json(
      { error: "project is locked" },
      { status: 409 },
    );
  }

  if ("rateLimited" in lockResult.result && lockResult.result.rateLimited) {
    return NextResponse.json(
      { error: "rate limited", retryAfter: lockResult.result.retryAfter },
      { status: 429 },
    );
  }

  if ("error" in lockResult.result) {
    return NextResponse.json(
      { error: lockResult.result.error },
      { status: lockResult.result.status },
    );
  }

  return NextResponse.json(lockResult.result);
}
