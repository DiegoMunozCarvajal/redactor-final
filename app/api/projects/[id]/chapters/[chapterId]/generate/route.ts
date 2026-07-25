import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { projects, chapters, chapterGenerations } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, and, sql, lt, inArray } from "drizzle-orm";
import { checkProjectRateLimit, withProjectLock, STALE_TIMEOUT_MS } from "@/lib/api/rate-limit";
import { csrfCheck } from "@/lib/api/csrf";
import { ensureTriggerConfigured } from "@/lib/trigger/setup";
import { generateChapter } from "@/trigger/generate-chapter";
import { sanitizeError } from "@/lib/sanitize-error";
import { logAudit } from "@/lib/audit";
import { loadEditorialBundle, snapshotFromBundle, metadataFromSnapshot } from "@/lib/editorial-brief/context";
import { resolvePromptRevision } from "@/lib/prompts/repository";
import { assertTemplateGenerationAllowed } from "@/lib/template-pipeline/authorization";
import { generationBlockedResponse } from "@/lib/template-pipeline/http";
import type { GenerationAuthorization } from "@/lib/template-pipeline/contracts";

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
    .select({ id: chapters.id })
    .from(chapters)
    .where(and(eq(chapters.id, chapterId), eq(chapters.projectId, projectId)))
    .limit(1);
  if (!chapter) return NextResponse.json({ error: "chapter not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const model = body.model as string | undefined;
  const effortRaw = body.effort as string | undefined;
  const plannerRevisionIdRaw = body.plannerRevisionId as string | undefined;
  const assemblyRevisionIdRaw = body.assemblyRevisionId as string | undefined;

  // Validate revision IDs with Zod UUID + resolvePromptRevision (kind check)
  // BEFORE creating the generation — invalid IDs fail synchronously, not async.
  let plannerRevisionId: string | undefined;
  let assemblyRevisionId: string | undefined;

  const uuidSchema = z.string().uuid();
  if (plannerRevisionIdRaw !== undefined) {
    const parsed = uuidSchema.safeParse(plannerRevisionIdRaw);
    if (!parsed.success) {
      return NextResponse.json({ error: "plannerRevisionId must be a valid UUID" }, { status: 400 });
    }
    try {
      await resolvePromptRevision({ kind: "assembly-planner", runRevisionId: parsed.data });
      plannerRevisionId = parsed.data;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid revision";
      return NextResponse.json({ error: `plannerRevisionId: ${message}` }, { status: 400 });
    }
  }
  if (assemblyRevisionIdRaw !== undefined) {
    const parsed = uuidSchema.safeParse(assemblyRevisionIdRaw);
    if (!parsed.success) {
      return NextResponse.json({ error: "assemblyRevisionId must be a valid UUID" }, { status: 400 });
    }
    try {
      await resolvePromptRevision({ kind: "assembly", runRevisionId: parsed.data });
      assemblyRevisionId = parsed.data;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid revision";
      return NextResponse.json({ error: `assemblyRevisionId: ${message}` }, { status: 400 });
    }
  }

  // Capture editorial bundle snapshot before the advisory lock.
  const bundle = await loadEditorialBundle({ projectId });
  const snapshot = bundle ? snapshotFromBundle(bundle) : null;

  // Require effective topic: brief.centralTopic or legacy project.topic.
  // A legacy brief without centralTopic is insufficient — check the value, not the object.
  const effectiveTopic = bundle?.content.centralTopic ?? project.topic ?? null;
  if (!effectiveTopic) {
    return NextResponse.json(
      {
        error:
          "No hay tema definido. Crea un brief editorial con tema central o establece un tema legacy para generar.",
      },
      { status: 400 },
    );
  }

  const VALID_EFFORT_VALUES = ["off", "xhigh", "max"] as const;
  if (effortRaw !== undefined && !(VALID_EFFORT_VALUES as readonly string[]).includes(effortRaw)) {
    return NextResponse.json(
      { error: `invalid effort "${effortRaw}". Valid: ${VALID_EFFORT_VALUES.join(", ")}` },
      { status: 400 },
    );
  }
  const effort = effortRaw as typeof VALID_EFFORT_VALUES[number] | undefined;

  // Serialize rate limit check + generation row insert under advisory lock.
  // Rate limit must be inside the lock to close the TOCTOU window where two
  // concurrent requests both pass the check before either acquires the lock.
  //
  // Rate check BEFORE insert — otherwise the row we just created self-counts
  // and always trips MAX_GENERATIONS_PER_WINDOW = 1.
  //
  // Trigger.dev dispatch happens OUTSIDE the lock — never hold advisory lock
  // during external API calls (Trigger.dev is an HTTP API).
  // Authorize generation before acquiring project lock.
  // Source-free projects and templates with clean v2 lineage pass;
  // blocked templates throw GenerationBlockedError (mapped to 409 below).
  let authorization: GenerationAuthorization;
  try {
    authorization = await assertTemplateGenerationAllowed(projectId);
  } catch (error) {
    const blocked = generationBlockedResponse(error);
    if (blocked) return blocked;
    throw error;
  }
  const lockResult = await withProjectLock(projectId, async () => {
    // Clean up stale content generation rows (type IS NULL = original generation).
    // Stale pending rows block the rate limiter permanently if Trigger.dev
    // never picked them up.
    const staleCutoff = new Date(Date.now() - STALE_TIMEOUT_MS);
    await db
      .update(chapterGenerations)
      .set({ status: "failed", error: "Stale generation (timed out)" })
      .where(
        and(
          eq(chapterGenerations.projectId, projectId),
          eq(chapterGenerations.chapterId, chapterId),
          inArray(chapterGenerations.status, ["pending", "generating", "planning", "assembling"]),
          sql`${chapterGenerations.generationMetadata}->>'type' IS NULL`,
          lt(chapterGenerations.createdAt, staleCutoff),
        ),
      );

    const rateCheck = await checkProjectRateLimit(projectId);
    if (!rateCheck.allowed) {
      return { rateLimited: true as const, retryAfter: rateCheck.retryAfter };
    }

    const [row] = await db
      .insert(chapterGenerations)
      .values({
        projectId,
        chapterId,
        status: "pending",
        generationMetadata: {
          ...(snapshot ? metadataFromSnapshot(snapshot) : {}),
          templateAuthorization: authorization,
        },
      })
      .returning();

    return { rateLimited: false as const, gen: row };
  });

  if (!lockResult.locked) {
    return NextResponse.json(
      { error: "project is locked" },
      { status: 409 },
    );
  }

  if (lockResult.result.rateLimited) {
    return NextResponse.json(
      { error: "rate limited", retryAfter: lockResult.result.retryAfter },
      { status: 429, headers: { "Retry-After": String(lockResult.result.retryAfter) } },
    );
  }

  const gen = lockResult.result.gen;

  // Trigger.dev dispatch outside the lock
  try {
    ensureTriggerConfigured();
    await generateChapter.trigger(
      {
        generationId: gen.id,
        projectId,
        ...(snapshot
          ? {
              editorialBriefId: snapshot.editorialBriefId,
              editorialBriefVersion: snapshot.editorialBriefVersion,
              editorialBriefHash: snapshot.editorialBriefHash,
            }
          : {}),
        ...(model ? { model } : {}),
        ...(effort !== undefined ? { effort } : {}),
        ...(plannerRevisionId ? { plannerRevisionId } : {}),
        ...(assemblyRevisionId ? { assemblyRevisionId } : {}),
      },
      { idempotencyKey: gen.id },
    );
  } catch (err) {
    const message = sanitizeError(err);
    await db
      .update(chapterGenerations)
      .set({ status: "failed", error: message })
      .where(eq(chapterGenerations.id, gen.id));
    return NextResponse.json({ error: message }, { status: 502 });
  }

  await logAudit({
    userId: user.id,
    action: "chapter.generate",
    resourceType: "chapter_generation",
    resourceId: gen.id,
    metadata: { projectId, chapterId },
  });

  return NextResponse.json(gen);
}
