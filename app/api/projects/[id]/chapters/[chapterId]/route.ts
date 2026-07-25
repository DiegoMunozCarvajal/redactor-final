import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  projects,
  chapters,
  chapterGenerations,
  chapterEditorialContracts,
  fragments,
  prompts,
} from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, asc, desc, and, sql, inArray, isNotNull, ne } from "drizzle-orm";
import type { ProjectSafety } from "@/components/projects/project-safety-banner";
import { csrfCheck } from "@/lib/api/csrf";
import { z } from "zod";
import { loadEditorialBundle } from "@/lib/editorial-brief/context";

function chapterHasEditorialHistoryResponse() {
  return NextResponse.json(
    {
      error: "chapter has editorial history",
      code: "chapter_has_editorial_history",
    },
    { status: 409 },
  );
}

function isEditorialHistoryForeignKeyError(error: unknown): boolean {
  let current = error;

  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof current !== "object" || current === null) return false;

    const candidate = current as Record<string, unknown>;
    const constraint = candidate.constraint_name ?? candidate.constraint;
    if (
      candidate.code === "23503" &&
      typeof constraint === "string" &&
      constraint.startsWith("chapter_editorial_contracts_chapter_id")
    ) {
      return true;
    }

    current = candidate.cause;
  }

  return false;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; chapterId: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId, chapterId } = await params;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const [chapter] = await db
    .select()
    .from(chapters)
    .where(and(eq(chapters.id, chapterId), eq(chapters.projectId, projectId)))
    .limit(1);
  if (!chapter) {
    return NextResponse.json({ error: "chapter not found" }, { status: 404 });
  }

  // Compute display number: 1-based rank among project chapters sorted by position
  const [rankResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(chapters)
    .where(
      and(
        eq(chapters.projectId, projectId),
        sql`${chapters.position} < ${chapter.position}`,
      ),
    );
  const chapterNumber = (rankResult?.count ?? 0) + 1;

  // All generations for this chapter+project, newest first
  const genList = await db
    .select()
    .from(chapterGenerations)
    .where(
      and(
        eq(chapterGenerations.projectId, projectId),
        eq(chapterGenerations.chapterId, chapterId),
      ),
    )
    .orderBy(desc(chapterGenerations.createdAt));

  // Load fragments for all generations in a single query (was N+1)
  const genIds = genList.map((g) => g.id);
  let allFragments: Array<{
    id: string;
    chapterGenerationId: string;
    projectPromptId: string | null;
    position: number;
    content: string | null;
    modelUsed: string | null;
    tokensUsed: number | null;
    isAssembly: boolean | null;
    createdAt: Date;
  }> = [];
  if (genIds.length > 0) {
    allFragments = await db
      .select({
        id: fragments.id,
        chapterGenerationId: fragments.chapterGenerationId,
        projectPromptId: fragments.projectPromptId,
        position: fragments.position,
        content: fragments.content,
        modelUsed: fragments.modelUsed,
        tokensUsed: fragments.tokensUsed,
        isAssembly: prompts.isAssembly,
        createdAt: fragments.createdAt,
      })
      .from(fragments)
      .leftJoin(prompts, eq(fragments.projectPromptId, prompts.id))
      .where(inArray(fragments.chapterGenerationId, genIds))
      .orderBy(asc(fragments.position));
  }

  // Group by generationId
  const fragsByGenId = new Map<string, typeof allFragments>();
  for (const f of allFragments) {
    const list = fragsByGenId.get(f.chapterGenerationId) ?? [];
    list.push(f);
    fragsByGenId.set(f.chapterGenerationId, list);
  }

  const generationsWithFragments = genList.map((gen) => ({
    ...gen,
    fragments: fragsByGenId.get(gen.id) ?? [],
  }));

  // Load active editorial brief summary for staleness checks
  const activeBundle = await loadEditorialBundle({ projectId }).catch(
    () => null,
  );
  const activeBrief = activeBundle
    ? { id: activeBundle.id, version: activeBundle.version, hash: activeBundle.hash }
    : null;

  // ---- Project safety classification ----
  let safetyState: "source_free" | "clean_v2" | "legacy_read_only" = "legacy_read_only";

  const [supersedingProject] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.supersedesProjectId, projectId))
    .limit(1);

  if (!supersedingProject) {
    const [genWithAuth] = await db
      .select({ generationMetadata: chapterGenerations.generationMetadata })
      .from(chapterGenerations)
      .where(
        and(
          eq(chapterGenerations.projectId, projectId),
          sql`${chapterGenerations.generationMetadata}->'templateAuthorization' IS NOT NULL`,
        ),
      )
      .orderBy(desc(chapterGenerations.createdAt))
      .limit(1);

    if (genWithAuth?.generationMetadata) {
      const auth = genWithAuth.generationMetadata.templateAuthorization;
      if (auth?.scope === "template" && auth?.pipelineRunId) {
        safetyState = "clean_v2";
      } else if (auth?.scope === "source-free") {
        safetyState = "source_free";
      }
    }
  }

  const projectSafety: ProjectSafety = { state: safetyState };

  return NextResponse.json({
    projectName: project.title ?? project.name,
    projectTopic: project.topic,
    chapter: {
      id: chapter.id,
      position: chapter.position,
      title: chapter.title,
      chapterNumber,
    },
    generations: generationsWithFragments,
    activeBrief,
    projectSafety,
  });
}

export async function PATCH(
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

  const { id: projectId, chapterId } = await params;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));

  const patchSchema = z.object({
    title: z.string().min(1).max(500).optional(),
    position: z.number().int().min(0).optional(),
  });

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { title, position } = parsed.data;

  if (position !== undefined) {
    const [conflict] = await db
      .select({ id: chapters.id })
      .from(chapters)
      .where(
        and(
          eq(chapters.projectId, projectId),
          eq(chapters.position, position),
          ne(chapters.id, chapterId),
        ),
      )
      .limit(1);
    if (conflict) {
      return NextResponse.json(
        { error: `position ${position} already taken by another chapter` },
        { status: 409 },
      );
    }
  }

  const [chapter] = await db
    .update(chapters)
    .set({
      ...(title !== undefined && { title }),
      ...(position !== undefined && { position }),
    })
    .where(and(eq(chapters.id, chapterId), eq(chapters.projectId, projectId)))
    .returning();

  if (!chapter)
    return NextResponse.json({ error: "chapter not found" }, { status: 404 });

  return NextResponse.json(chapter);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; chapterId: string }> },
) {
  const csrfError = csrfCheck(_req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId, chapterId } = await params;

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
    .select({ id: chapters.id })
    .from(chapters)
    .where(and(eq(chapters.id, chapterId), eq(chapters.projectId, projectId)))
    .limit(1);
  if (!chapter) return NextResponse.json({ error: "chapter not found" }, { status: 404 });

  // Keep approved and archived editorial history immutable. Check inside the
  // delete transaction before removing any dependent generation data.
  // Lock the project row first to serialize with brief creation/approval.
  let result: "chapter_has_editorial_history" | "deleted";
  try {
    result = await db.transaction(async (tx) => {
      // Lock the project row — serializes with concurrent brief operations
      await tx
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, projectId))
        .for("update");

      const [editorialContract] = await tx
        .select({ id: chapterEditorialContracts.id })
        .from(chapterEditorialContracts)
        .where(eq(chapterEditorialContracts.chapterId, chapterId))
        .for("update");

      if (editorialContract) return "chapter_has_editorial_history" as const;

      await tx.delete(chapterGenerations).where(eq(chapterGenerations.chapterId, chapterId));
      await tx.delete(prompts).where(and(eq(prompts.chapterId, chapterId), isNotNull(prompts.projectId)));
      await tx.delete(chapters).where(and(eq(chapters.id, chapterId), eq(chapters.projectId, projectId)));
      return "deleted" as const;
    });
  } catch (error) {
    // Close the read/delete race: a contract inserted after the preflight
    // check is still reported as the same domain conflict, not as a 500.
    if (isEditorialHistoryForeignKeyError(error)) {
      return chapterHasEditorialHistoryResponse();
    }
    throw error;
  }

  if (result === "chapter_has_editorial_history") {
    return chapterHasEditorialHistoryResponse();
  }

  return NextResponse.json({ ok: true });
}
