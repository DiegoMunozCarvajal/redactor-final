import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { projects, chapters, chapterGenerations, fragments, prompts } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, and, inArray } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { checkProjectRateLimit, withProjectLock, cleanupStaleGenerations } from "@/lib/api/rate-limit";
import { ensureTriggerConfigured } from "@/lib/trigger/setup";
import { generateChapter } from "@/trigger/generate-chapter";
import { getChapterPlaceholders, getMissingPlaceholderNames } from "@/lib/placeholders";
import { sanitizeError } from "@/lib/sanitize-error";
import { logAudit } from "@/lib/audit";
import { DEFAULT_GENERATION_MODEL, getModelDefinition } from "@/lib/ai/providers";
import { loadEditorialBundle, snapshotFromBundle, metadataFromSnapshot, snapshotFromGenerationMetadata } from "@/lib/editorial-brief/context";
import { resolvePromptRevision } from "@/lib/prompts/repository";

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
  if (!project || project.userId !== user.id)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  const [chapter] = await db
    .select()
    .from(chapters)
    .where(and(eq(chapters.id, chapterId), eq(chapters.projectId, projectId)))
    .limit(1);
  if (!chapter)
    return NextResponse.json({ error: "chapter not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const fragmentIds: string[] = body.fragmentIds ?? [];
  const model = body.model as string | undefined;
  const effort = body.effort as "off" | "max" | "xhigh" | undefined;
  const plannerRevisionIdRaw = body.plannerRevisionId as string | undefined;
  const assemblyRevisionIdRaw = body.assemblyRevisionId as string | undefined;

  // Validate revision IDs with Zod UUID + resolvePromptRevision (kind check)
  // BEFORE creating the generation — invalid IDs fail synchronously.
  let plannerRevisionId: string | undefined;
  let assemblyRevisionId: string | undefined;

  const uuidSchema = z.string().uuid();
  if (plannerRevisionIdRaw !== undefined) {
    const parsed = uuidSchema.safeParse(plannerRevisionIdRaw);
    if (!parsed.success) {
      return NextResponse.json({ error: "plannerRevisionId must be a valid UUID" }, { status: 400 });
    }
    await resolvePromptRevision({ kind: "assembly-planner", runRevisionId: parsed.data });
    plannerRevisionId = parsed.data;
  }
  if (assemblyRevisionIdRaw !== undefined) {
    const parsed = uuidSchema.safeParse(assemblyRevisionIdRaw);
    if (!parsed.success) {
      return NextResponse.json({ error: "assemblyRevisionId must be a valid UUID" }, { status: 400 });
    }
    await resolvePromptRevision({ kind: "assembly", runRevisionId: parsed.data });
    assemblyRevisionId = parsed.data;
  }

  // Reject legacy fields — Plan 2 resolves everything via revision IDs
  if (body.assemblyAlgorithm !== undefined) {
    return NextResponse.json(
      { error: "assemblyAlgorithm is deprecated. Use plannerRevisionId and assemblyRevisionId instead." },
      { status: 400 },
    );
  }
  if (body.assemblyPromptId !== undefined) {
    return NextResponse.json(
      { error: "assemblyPromptId is deprecated. Use assemblyRevisionId instead." },
      { status: 400 },
    );
  }

  if (!Array.isArray(fragmentIds) || fragmentIds.length === 0) {
    return NextResponse.json({ error: "fragmentIds required" }, { status: 400 });
  }

  const MAX_FRAGMENTS = 100;
  if (fragmentIds.length > MAX_FRAGMENTS) {
    return NextResponse.json(
      { error: `too many fragments, max ${MAX_FRAGMENTS}` },
      { status: 400 },
    );
  }

  // Validate token budget against model output limits
  const assemblyModel = model ?? DEFAULT_GENERATION_MODEL;
  const modelDef = getModelDefinition(assemblyModel);
  const estimatedTokens = fragmentIds.length * 2048;
  if (modelDef?.maxOutputTokens && estimatedTokens > modelDef.maxOutputTokens) {
    return NextResponse.json(
      {
        error: `${fragmentIds.length} fragments would require ~${estimatedTokens.toLocaleString()} output tokens, but ${assemblyModel} supports max ${modelDef.maxOutputTokens.toLocaleString()}. Remove some fragments.`,
      },
      { status: 400 },
    );
  }

  // Pre-flight: verify fragments exist and belong to this project's chapter
  const selectedFragments = await db
    .select({ id: fragments.id })
    .from(fragments)
    .innerJoin(chapterGenerations, eq(fragments.chapterGenerationId, chapterGenerations.id))
    .where(
      and(
        inArray(fragments.id, fragmentIds),
        eq(chapterGenerations.chapterId, chapterId),
      ),
    );

  if (selectedFragments.length !== fragmentIds.length) {
    return NextResponse.json(
      { error: "some fragments not found" },
      { status: 400 },
    );
  }

  // Pre-flight: resolve editorial brief snapshot for assembly consistency.
  // Load fragment parents' generation metadata to check for mixed brief versions.
  const fragmentParents = await db
    .select({
      id: chapterGenerations.id,
      generationMetadata: chapterGenerations.generationMetadata,
    })
    .from(chapterGenerations)
    .innerJoin(fragments, eq(fragments.chapterGenerationId, chapterGenerations.id))
    .where(inArray(fragments.id, fragmentIds));

  const fragmentSnapshots = fragmentParents.map((p) =>
    snapshotFromGenerationMetadata(
      (p.generationMetadata as Record<string, unknown> | null) ?? {},
    ),
  );

  // Reject mixed legacy/versioned fragments — all parents must agree.
  const hasVersioned = fragmentSnapshots.some((s) => s !== null);
  const hasLegacy = fragmentSnapshots.some((s) => s === null);
  if (hasVersioned && hasLegacy) {
    return NextResponse.json(
      {
        error:
          "Cannot assemble: some fragments were generated with an editorial brief and others without one. Regenerate all fragments under the same approved brief.",
      },
      { status: 409 },
    );
  }

  const validSnapshots = fragmentSnapshots.filter(
    (s): s is NonNullable<typeof s> => s !== null,
  );

  // Check for mixed brief hashes — reject if fragments reference different versions.
  if (validSnapshots.length > 0) {
    const hashes = new Set(validSnapshots.map((s) => s.editorialBriefHash));
    if (hashes.size > 1) {
      return NextResponse.json(
        {
          error:
            "Fragments were generated with different editorial brief versions. Regenerate them under the same approved brief.",
        },
        { status: 409 },
      );
    }
  }

  // Resolve the snapshot for this assembly:
  // - All versioned fragments share the same hash → use that snapshot
  // - All legacy fragments (no snapshots) → capture current approved brief (or null)
  const assemblySnapshot =
    validSnapshots.length > 0
      ? validSnapshots[0]
      : await loadEditorialBundle({ projectId }).then((b) =>
          b ? snapshotFromBundle(b) : null,
        );

  // Pre-flight: validate placeholders for the chapter's embedded prompts
  const placeholders = await getChapterPlaceholders(chapterId, project.topic);

  // Collect all content prompt texts for placeholder validation
  const chapterPrompts = await db
    .select({ content: prompts.content, userPrompt: prompts.userPrompt })
    .from(prompts)
    .where(
      and(
        eq(prompts.chapterId, chapterId),
        eq(prompts.projectId, projectId),
      ),
    );

  const allPromptTexts = chapterPrompts.flatMap((p) =>
    [p.content, p.userPrompt].filter((s): s is string => typeof s === "string" && s.length > 0),
  );

  const missingPlaceholders = getMissingPlaceholderNames(allPromptTexts, placeholders);
  if (missingPlaceholders.length > 0) {
    const missing = missingPlaceholders.join(", ");
    return NextResponse.json(
      {
        error: `Cannot assemble "${chapter.title}": missing placeholder definitions: {${missing.replace(/, /g, "}, {")}}. Fill them first.`,
      },
      { status: 400 },
    );
  }

  // Serialize rate limit check + generation row insert under advisory lock.
  // Trigger.dev dispatch happens OUTSIDE the lock — never hold advisory lock
  // during external API calls (Trigger.dev is an HTTP API).
  const lockResult = await withProjectLock(projectId, async () => {
    // Clean up stale assembly rows before rate check.
    await cleanupStaleGenerations(projectId, "assembly", {
      chapterId,
      statuses: ["pending", "generating", "planning", "assembling"],
    });

    // Rate check BEFORE creating our own row — otherwise it self-counts
    // and always trips MAX_GENERATIONS_PER_WINDOW = 1.
    const rateCheck = await checkProjectRateLimit(projectId);
    if (!rateCheck.allowed) {
      return { rateLimited: true as const, retryAfter: rateCheck.retryAfter };
    }

    const meta = {
      type: "assembly" as const,
      model: model ?? null,
      effort: effort ?? null,
      algorithm: "planned-editorial-v1" as const,
      fragmentIds,
      ...(assemblySnapshot ? metadataFromSnapshot(assemblySnapshot) : {}),
    };
    const [row] = await db
      .insert(chapterGenerations)
      .values({
        projectId,
        chapterId,
        status: "pending" as const,
        generationMetadata: meta as typeof chapterGenerations.$inferSelect["generationMetadata"],
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
        fragmentIds,
        ...(model ? { model } : {}),
        ...(effort !== undefined ? { effort } : {}),
        ...(plannerRevisionId ? { plannerRevisionId } : {}),
        ...(assemblyRevisionId ? { assemblyRevisionId } : {}),
        ...(assemblySnapshot
          ? {
              editorialBriefId: assemblySnapshot.editorialBriefId,
              editorialBriefVersion: assemblySnapshot.editorialBriefVersion,
              editorialBriefHash: assemblySnapshot.editorialBriefHash,
            }
          : {}),
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
    action: "chapter.assemble",
    resourceType: "chapter_generation",
    resourceId: gen.id,
    metadata: { projectId, chapterId, fragmentIds, algorithm: "planned-editorial-v1" },
  });

  return NextResponse.json(gen);
}
