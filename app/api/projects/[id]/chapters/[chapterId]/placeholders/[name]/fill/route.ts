import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  projects,
  prompts,
  chapterPlaceholders,
  chapters,
  chapterGenerations,
  placeholderVersions,
} from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, and, asc, lt, sql } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { checkProjectRateLimit, withProjectLock, cleanupStaleGenerations } from "@/lib/api/rate-limit";
import { sanitizeError } from "@/lib/sanitize-error";
import { type ReasoningEffort } from "@/lib/ai/completion";
import { fillOnePlaceholder, type FillOriginalityContext } from "@/lib/ai/placeholder-fill";
import { resolvePlaceholdersDirect } from "@/lib/placeholders";
import { buildPlaceholderFillMetadata, type PlaceholderFillMetadata } from "@/lib/placeholder-fill-metadata";
import { hashPromptContents, PlaceholderDependencyError } from "@/lib/placeholder-utils";
import { loadEditorialBundle } from "@/lib/editorial-brief/context";
import { llmPromptExecutions } from "@/lib/db/schema/prompt-registry";
import { assertTemplateGenerationAllowed } from "@/lib/template-pipeline/authorization";
import { generationBlockedResponse } from "@/lib/template-pipeline/http";
import { templateLineage, sourceFreeLineage } from "@/lib/originality/lineage";
import type { OriginalityLineage } from "@/lib/originality/lineage";
import { OriginalityContaminationError, OriginalityDetectorUnavailableError } from "@/lib/originality/contracts";
import type { GenerationAuthorization } from "@/lib/template-pipeline/contracts";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; chapterId: string; name: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId, chapterId, name } = await params;

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

  const promptRows = await db
    .select({ content: prompts.content, userPrompt: prompts.userPrompt, sourceContext: prompts.sourceContext })
    .from(prompts)
    .where(and(eq(prompts.chapterId, chapterId), eq(prompts.projectId, projectId)))
    .orderBy(asc(prompts.position));
  const promptContents = promptRows.map((p) => [p.content, p.userPrompt].filter(Boolean).join("\n"));

  // Compute prompts hash for stale detection — includes userPrompt changes
  const promptsHash = hashPromptContents(promptContents);

  const existingRows = await db
    .select()
    .from(chapterPlaceholders)
    .where(eq(chapterPlaceholders.chapterId, chapterId));

  // Build existing definitions map (exclude the one being filled)
  const existingDefinitions: Record<string, string> = {};
  for (const row of existingRows) {
    if (row.definition && row.name !== name) {
      existingDefinitions[row.name] = row.definition;
    }
  }

  // Verify requested placeholder name exists before any lock or LLM call
  const [placeholderRow] = existingRows.filter((r) => r.name === name);
  if (!placeholderRow) {
    return NextResponse.json({ error: "placeholder not found" }, { status: 404 });
  }

  // Load editorial brief for evidence-driven RAG overrides.
  // If no approved brief exists, briefBundle is null (legacy behavior).
  const briefBundle = await loadEditorialBundle({ projectId });
  const effectiveTopic = briefBundle?.content.centralTopic ?? project.topic ?? null;

  // Check if this placeholder can be resolved directly (no LLM)
  const { resolved } = resolvePlaceholdersDirect([name], effectiveTopic);

  if (resolved[name]) {
    // Look up placeholder row ID
    const [phRow] = await db
      .select({ id: chapterPlaceholders.id })
      .from(chapterPlaceholders)
      .where(and(eq(chapterPlaceholders.chapterId, chapterId), eq(chapterPlaceholders.name, name)))
      .limit(1);

    if (phRow) {
      const fillMeta = buildPlaceholderFillMetadata({
        provider: "direct",
        model,
        promptsHash,
        definitionOrigin: "system",
        ...(briefBundle
          ? {
              editorialBriefId: briefBundle.id,
              editorialBriefVersion: briefBundle.version,
              editorialBriefHash: briefBundle.hash,
            }
          : {}),
      });

      const [version] = await db
        .insert(placeholderVersions)
        .values({
          placeholderId: phRow.id,
          definition: resolved[name],
          fillMetadata: fillMeta,
        })
        .returning({ id: placeholderVersions.id });

      await db
        .update(chapterPlaceholders)
        .set({
          definition: resolved[name],
          fillMetadata: fillMeta,
          activeVersionId: version.id,
          definitionOrigin: "system",
        })
        .where(and(eq(chapterPlaceholders.chapterId, chapterId), eq(chapterPlaceholders.name, name)));
    }

    return NextResponse.json({ name, definition: resolved[name], sources: [] });
  }

  // LLM path: rate-limit via generation row inside advisory lock.
  // Same pattern as batch fill route — prevents unbounded concurrent LLM calls.
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
    // Clean up stale fill generations before rate check (inside lock for TOCTOU safety).
    // Single fills go directly to "generating" — no Trigger.dev dispatch.
    await cleanupStaleGenerations(projectId, "fill", {
      chapterId,
      statuses: ["generating"],
    });

    const rateCheck = await checkProjectRateLimit(projectId);
    if (!rateCheck.allowed) {
      return { rateLimited: true as const, retryAfter: rateCheck.retryAfter };
    }

    const [gen] = await db
      .insert(chapterGenerations)
      .values({
        projectId,
        chapterId,
        status: "generating",
        generationMetadata: { type: "fill", name, templateAuthorization: authorization },
      })
      .returning();

    return { rateLimited: false as const, gen };
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
      { status: 429, headers: { "Retry-After": String(lockResult.result.retryAfter) } },
    );
  }

  const fillGen = lockResult.result.gen;

  // Clean up stale "started" executions from prior crashed fills.
  // Shared logic with the bulk fill endpoint.
  const STALE_EXECUTION_THRESHOLD_MS = 30 * 60 * 1000;
  await db
    .update(llmPromptExecutions)
    .set({
      status: "failed",
      error: "process terminated before completion",
      completedAt: sql`NOW()`,
    })
    .where(
      and(
        eq(llmPromptExecutions.status, "started"),
        eq(llmPromptExecutions.chapterId, chapterId),
        lt(
          llmPromptExecutions.createdAt,
          new Date(Date.now() - STALE_EXECUTION_THRESHOLD_MS),
        ),
      ),
    );

  const phDef = {
    name,
    dependencyNames: placeholderRow.dependencyNames,
    function: placeholderRow.function ?? null,
    notes: placeholderRow.notes ?? null,
  };

  // Build current lineage from authorization for originality gate context
  const authLineage: OriginalityLineage = authorization.scope === "source-free"
    ? sourceFreeLineage({ promptRevisions: {} })
    : templateLineage({
        pipelineRunId: authorization.pipelineRunId,
        pipelineVersion: "template-pipeline-v2",
        compilerVersion: "template-compiler-v1",
        compilerHash: "",
        recipeCatalogHash: "",
        templateArtifactHash: placeholderRow.templateArtifactHash ?? "",
        sourceProfileVersion: "source-profile-v1",
        sourceProfileSetHash: authorization.sourceProfileSetHash,
        originalityPolicyVersion: authorization.originalityPolicyVersion,
        promptRevisions: {},
      });

  // Map all placeholder rows for dependency-based context selection
  const allPlaceholderRows = existingRows.map((r) => ({
    name: r.name,
    definition: r.definition,
    dependencyNames: r.dependencyNames,
    fillMetadata: r.fillMetadata as {
      status?: string;
      originalityAssessmentId?: string;
      originalityLineage?: OriginalityLineage;
      definitionOrigin?: string;
    } | null ?? null,
  }));

  const originalityContext: FillOriginalityContext = {
    authorization,
    currentLineage: authLineage,
    templateArtifactHash: placeholderRow.templateArtifactHash ?? undefined,
    chapterId,
    chapterGenerationId: fillGen.id,
  };

  // LLM call outside the lock
  let result;
  try {
    result = await fillOnePlaceholder({
      placeholder: phDef,
      projectTopic: effectiveTopic,
      projectId,
      existingDefinitions,
      model: model ?? undefined,
      effort,
      chapterId,
      chapterGenerationId: fillGen.id,
      signal: req.signal,
      editorialBundle: briefBundle,
      originalityContext,
      allPlaceholderRows,
    });
  } catch (err) {
    // Originality gate errors
    if (err instanceof OriginalityContaminationError) {
      // Generation already quarantined by the gate
      return NextResponse.json(
        { error: "Content does not meet originality requirements" },
        { status: 422 },
      );
    }
    if (err instanceof OriginalityDetectorUnavailableError) {
      return NextResponse.json(
        { error: "Originality detection service unavailable" },
        { status: 503 },
      );
    }
    if (err instanceof PlaceholderDependencyError) {
      return NextResponse.json(
        { error: `Unresolved placeholder dependencies: ${err.missingNames.join(", ")}` },
        { status: 422 },
      );
    }
    const message = sanitizeError(err);
    await db
      .update(chapterGenerations)
      .set({ status: "failed", error: message, completedAt: new Date() })
      .where(eq(chapterGenerations.id, fillGen.id));
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // Insufficient evidence: LLM explicitly declared it cannot produce a valid
  // definition. Persist blocked metadata but NOT definition — placeholder
  // remains unfilled until user provides more evidence or changes notes.
  if (result.status === "insufficient_evidence") {
    await db
      .update(chapterPlaceholders)
      .set({
        fillMetadata: buildPlaceholderFillMetadata({
          provider: result.provider,
          sources: result.sources,
          ragChunks: result.ragChunks,
          model,
          promptsHash,
          status: "insufficient_evidence",
          insufficientReason: result.insufficientReason,
          ...(briefBundle
            ? {
                editorialBriefId: briefBundle.id,
                editorialBriefVersion: briefBundle.version,
                editorialBriefHash: briefBundle.hash,
              }
            : {}),
          ...(result.evidenceQuery ? { evidenceQuery: result.evidenceQuery } : {}),
          ...(result.evidenceSourceIds ? { evidenceSourceIds: result.evidenceSourceIds } : {}),
        }),
      })
      .where(
        and(
          eq(chapterPlaceholders.chapterId, chapterId),
          eq(chapterPlaceholders.name, name),
        ),
      );

    await db
      .update(chapterGenerations)
      .set({
        status: "failed",
        error: `insufficient evidence: ${result.insufficientReason ?? "no data available"}`,
        completedAt: new Date(),
      })
      .where(eq(chapterGenerations.id, fillGen.id));

    return NextResponse.json({
      name,
      definition: "",
      status: "insufficient_evidence" as const,
      insufficientReason: result.insufficientReason,
      sources: result.sources,
      ragChunks: result.ragChunks,
      provider: result.provider,
    });
  }

  // Guard: completed status but empty definition shouldn't happen with new
  // discriminated union, but guard defensively.
  if (!result.definition) {
    await db
      .update(chapterGenerations)
      .set({ status: "failed", error: "definition generation returned empty — both attempts failed", completedAt: new Date() })
      .where(eq(chapterGenerations.id, fillGen.id));
    return NextResponse.json(
      { error: "definition generation failed — try again" },
      { status: 502 },
    );
  }

  // Gate already persisted definition + version + activeVersionId.
  // Re-read to get the metadata the gate wrote, then add promptsHash.
  const [updatedRow] = await db
    .select({ fillMetadata: chapterPlaceholders.fillMetadata })
    .from(chapterPlaceholders)
    .where(and(eq(chapterPlaceholders.chapterId, chapterId), eq(chapterPlaceholders.name, name)))
    .limit(1);

  if (updatedRow) {
    const existingMeta = (updatedRow.fillMetadata ?? {}) as PlaceholderFillMetadata;
    const updatedMeta: PlaceholderFillMetadata = {
      ...existingMeta,
      promptsHash,
      ...(briefBundle
        ? {
            editorialBriefId: briefBundle.id,
            editorialBriefVersion: briefBundle.version,
            editorialBriefHash: briefBundle.hash,
          }
        : {}),
    };

    await db
      .update(chapterPlaceholders)
      .set({ fillMetadata: updatedMeta })
      .where(and(eq(chapterPlaceholders.chapterId, chapterId), eq(chapterPlaceholders.name, name)));
  }

  await db
    .update(chapterGenerations)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(chapterGenerations.id, fillGen.id));

  return NextResponse.json({
    name,
    definition: result.definition,
    status: "completed" as const,
    sources: result.sources,
    ragChunks: result.ragChunks,
    provider: result.provider,
  });
}

/**
 * PATCH /projects/[id]/chapters/[chapterId]/placeholders/[name]/fill
 *
 * Actions:
 *   { action: "confirmManual" } — Confirm a manual placeholder definition.
 *   Records current lineage and timestamp. Does NOT call an LLM provider.
 *   Rejects if the current definitionOrigin is "legacy" (must save a manual
 *   definition first, e.g. via the editor).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; chapterId: string; name: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId, chapterId, name } = await params;

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
  const { action } = body;

  if (action !== "confirmManual") {
    return NextResponse.json({ error: "unsupported action" }, { status: 400 });
  }

  // Load the placeholder row
  const [placeholderRow] = await db
    .select()
    .from(chapterPlaceholders)
    .where(
      and(
        eq(chapterPlaceholders.chapterId, chapterId),
        eq(chapterPlaceholders.name, name),
      ),
    )
    .limit(1);

  if (!placeholderRow) {
    return NextResponse.json({ error: "placeholder not found" }, { status: 404 });
  }

  // Reject if definition is legacy (no manual definition saved yet)
  const currentOrigin = placeholderRow.definitionOrigin ?? "legacy";
  if (currentOrigin === "legacy" || !placeholderRow.definition) {
    return NextResponse.json(
      { error: "Save a manual definition before confirming it. Legacy AI definitions cannot be confirmed without review." },
      { status: 400 },
    );
  }

  // Build current lineage from authorization for recording
  let authorization: GenerationAuthorization;
  try {
    authorization = await assertTemplateGenerationAllowed(projectId);
  } catch (error) {
    const blocked = generationBlockedResponse(error);
    if (blocked) return blocked;
    throw error;
  }

  const authLineage: OriginalityLineage = authorization.scope === "source-free"
    ? sourceFreeLineage({ promptRevisions: {} })
    : templateLineage({
        pipelineRunId: authorization.pipelineRunId,
        pipelineVersion: "template-pipeline-v2",
        compilerVersion: "template-compiler-v1",
        compilerHash: "",
        recipeCatalogHash: "",
        templateArtifactHash: placeholderRow.templateArtifactHash ?? "",
        sourceProfileVersion: "source-profile-v1",
        sourceProfileSetHash: authorization.sourceProfileSetHash,
        originalityPolicyVersion: authorization.originalityPolicyVersion,
        promptRevisions: {},
      });

  // Check if a version row already exists for the current definition
  const existingVersions = await db
    .select({ id: placeholderVersions.id })
    .from(placeholderVersions)
    .where(eq(placeholderVersions.placeholderId, placeholderRow.id))
    .orderBy(placeholderVersions.createdAt)
    .limit(1);

  let activeVersionId: string | null = existingVersions[0]?.id ?? null;

  // If no version exists for this definition, create one
  if (!activeVersionId && placeholderRow.definition) {
    const [version] = await db
      .insert(placeholderVersions)
      .values({
        placeholderId: placeholderRow.id,
        definition: placeholderRow.definition,
        fillMetadata: {
          ...((placeholderRow.fillMetadata as PlaceholderFillMetadata) ?? { sources: [] }),
          filledAt: new Date().toISOString(),
          definitionOrigin: "manual",
          manualConfirmedAt: new Date().toISOString(),
          originalityLineage: authLineage,
        },
      })
      .returning({ id: placeholderVersions.id });

    activeVersionId = version.id;
  }

  await db
    .update(chapterPlaceholders)
    .set({
      fillMetadata: {
        ...((placeholderRow.fillMetadata as PlaceholderFillMetadata) ?? { sources: [] }),
        filledAt: new Date().toISOString(),
        definitionOrigin: "manual",
        manualConfirmedAt: new Date().toISOString(),
        originalityLineage: authLineage,
      },
      definitionOrigin: "manual",
      ...(activeVersionId ? { activeVersionId } : {}),
    })
    .where(
      and(
        eq(chapterPlaceholders.chapterId, chapterId),
        eq(chapterPlaceholders.name, name),
      ),
    );

  return NextResponse.json({
    name,
    definitionOrigin: "manual",
    manualConfirmedAt: new Date().toISOString(),
  });
}
