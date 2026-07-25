import { task, type Context } from "@trigger.dev/sdk";
import { db } from "@/lib/db";
import {
  chapterGenerations,
  fragments,
  projects,
  chapters,
  prompts,
} from "@/lib/db/schema";
import { eq, asc, and, inArray } from "drizzle-orm";
import { createHash } from "crypto";
import { generatePromptContent } from "@/lib/generate";
import { getChapterPlaceholders, extractPlaceholders } from "@/lib/placeholders";
import { STALE_TIMEOUT_MS } from "@/lib/api/rate-limit";
import { sanitizeError } from "@/lib/sanitize-error";
import { runSettledWithConcurrency } from "@/lib/promise-pool";
import { loadEditorialBundle, snapshotFromGenerationMetadata, renderEditorialData } from "@/lib/editorial-brief/context";
import { runAssemblyPlanner } from "@/lib/assembly/planner";
import { runAssemblyAssembler } from "@/lib/assembly/assembler";
import { assemblyPlanV1Schema, validateAssemblyPlan } from "@/lib/assembly/plan-schema";
import { resolvePromptRevision } from "@/lib/prompts/repository";
import { DEFAULT_GENERATION_MODEL } from "@/lib/ai/providers";
import { assertTemplateGenerationAllowed } from "@/lib/template-pipeline/authorization";
import { runOriginalityGate } from "@/lib/originality/gate";
import {
  OriginalityContaminationError,
  OriginalityDetectorUnavailableError,
} from "@/lib/originality/contracts";
import { sha256Text } from "@/lib/template-pipeline/hash";

export const generateChapter = task({
  id: "generate-chapter",
  maxDuration: 1800, // 30 minutes — chapter generation can make multiple LLM calls
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 5_000,
    maxTimeoutInMs: 60_000,
  },
  run: async (payload: {
      generationId: string;
      projectId: string;
      fragmentIds?: string[];
      editorialBriefId?: string;
      editorialBriefVersion?: number;
      editorialBriefHash?: string;
      model?: string;
      effort?: "off" | "max" | "xhigh";
      plannerRevisionId?: string;
      assemblyRevisionId?: string;
    }, { ctx }: { ctx: Context }) => {
    const {
      generationId,
      projectId,
      fragmentIds,
      model,
      effort,
      plannerRevisionId,
      assemblyRevisionId,
    } = payload;

    // Re-authorize at execution time — closes the queue-delay race where a
    // template could become quarantined after the API enqueued the task.
    const currentAuthorization = await assertTemplateGenerationAllowed(
      payload.projectId,
    );

    // Load generation
    const [gen] = await db
      .select()
      .from(chapterGenerations)
      .where(eq(chapterGenerations.id, generationId))
      .limit(1);
    if (!gen) throw new Error(`ChapterGeneration ${generationId} not found`);

    // Idempotency guard — skip if already in a terminal state.
    const terminalStatuses = ["completed", "awaiting_assembly"];
    if (terminalStatuses.includes(gen.status)) {
      return;
    }

    // Handle "failed" status on retry — if we still have attempts remaining,
    // reset to pending so the task can retry. On final attempt, skip.
    if (gen.status === "failed") {
      const maxAttempts = ctx.run.maxAttempts ?? 3;
      if (ctx.attempt.number >= maxAttempts) {
        return;
      }
      await db
        .update(chapterGenerations)
        .set({ status: "pending" })
        .where(eq(chapterGenerations.id, generationId));
      gen.status = "pending";
    }

    // If stale (worker likely died), recover. If fresh, guard against retry race.
    if (
      gen.status === "generating" ||
      gen.status === "planning" ||
      gen.status === "assembling"
    ) {
      const staleCutoff = new Date(Date.now() - STALE_TIMEOUT_MS);
      if (gen.createdAt && new Date(gen.createdAt) > staleCutoff) {
        return;
      }
      // Stale — previous attempt died; reset to pending and recover below
      await db
        .update(chapterGenerations)
        .set({ status: "pending" })
        .where(eq(chapterGenerations.id, generationId));
      gen.status = "pending";
    }

    // Guard against unrecognized status values
    if (gen.status !== "pending") {
      const msg =
        `Unrecognized generation status "${gen.status}" for ${generationId} — ` +
        `expected one of: pending, generating, planning, assembling, completed, failed, awaiting_assembly`;
      await db
        .update(chapterGenerations)
        .set({ status: "failed", error: msg })
        .where(eq(chapterGenerations.id, generationId));
      throw new Error(msg);
    }

    // Transition pending → generating atomically
    const [updated] = await db
      .update(chapterGenerations)
      .set({ status: "generating" })
      .where(
        and(
          eq(chapterGenerations.id, generationId),
          eq(chapterGenerations.status, "pending"),
        ),
      )
      .returning({ id: chapterGenerations.id, assemblyPlan: chapterGenerations.assemblyPlan });
    if (!updated) {
      return;
    }

    // Capture any persisted plan from a previous attempt (retry recovery)
    const persistedPlan = updated.assemblyPlan as Record<string, unknown> | null;

    // Load project
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project) throw new Error(`Project ${projectId} not found`);

    // Load chapter for position info
    const [chapter] = await db
      .select()
      .from(chapters)
      .where(eq(chapters.id, gen.chapterId))
      .limit(1);
    if (!chapter) throw new Error(`Chapter ${gen.chapterId} not found`);

    // Resolve editorial brief snapshot from generation metadata
    const genSnapshot = snapshotFromGenerationMetadata(
      (gen.generationMetadata as Record<string, unknown> | null) ?? {},
    );

    let editorialBundle: Awaited<ReturnType<typeof loadEditorialBundle>> = null;
    if (genSnapshot) {
      try {
        editorialBundle = await loadEditorialBundle({
          projectId,
          briefId: genSnapshot.editorialBriefId,
          expectedHash: genSnapshot.editorialBriefHash,
        });
      } catch (err) {
        await db
          .update(chapterGenerations)
          .set({
            status: "failed",
            error: `Editorial brief hash mismatch: ${sanitizeError(err)}`,
          })
          .where(eq(chapterGenerations.id, generationId));
        throw err;
      }
    }

    // Require effective topic: brief.centralTopic or legacy project.topic.
    // A legacy brief without centralTopic is insufficient — check the value, not the object.
    const effectiveTopic = editorialBundle?.content.centralTopic ?? project.topic ?? null;
    if (!effectiveTopic) {
      const msg =
        "No hay tema definido. Crea un brief editorial con tema central o establece un tema legacy para generar.";
      await db
        .update(chapterGenerations)
        .set({ status: "failed", error: msg })
        .where(eq(chapterGenerations.id, generationId));
      throw new Error(msg);
    }

    // Load project prompts for this chapter
    const promptList = await db
      .select()
      .from(prompts)
      .where(
        and(
          eq(prompts.projectId, projectId),
          eq(prompts.chapterId, gen.chapterId),
        ),
      )
      .orderBy(asc(prompts.position));

    const contentPrompts = promptList.filter(
      (p) => !p.isAssembly && !p.isCritique && !p.isCorrector,
    );

    const fragmentContents: { id: string; title: string; content: string }[] = [];

    try {
      if (fragmentIds && fragmentIds.length > 0) {
        // Inflate fragments from DB — manual re-assembly path.
        // Do NOT filter by generationId: fragments come from prior generations
        // (the API route already verified project/chapter ownership).
        const existing = await db
          .select({
            id: fragments.id,
            title: prompts.title,
            content: fragments.content,
          })
          .from(fragments)
          .leftJoin(prompts, eq(fragments.projectPromptId, prompts.id))
          .where(inArray(fragments.id, fragmentIds))
          .orderBy(asc(fragments.position));

        for (const f of existing) {
          fragmentContents.push({
            id: f.id,
            title: f.title ?? "Fragment",
            content: f.content ?? "",
          });
        }
      } else {
        // Check for existing fragments from a previous attempt (retry recovery).
        // If fragments exist, inflate them instead of regenerating.
        const existingFragments = await db
          .select({
            id: fragments.id,
            projectPromptId: fragments.projectPromptId,
            title: prompts.title,
            content: fragments.content,
          })
          .from(fragments)
          .leftJoin(prompts, eq(fragments.projectPromptId, prompts.id))
          .where(eq(fragments.chapterGenerationId, generationId))
          .orderBy(asc(fragments.position));

        if (existingFragments.length > 0) {
          // Retry recovery: compare sets of projectPromptId to detect partial
          // sets, duplicates, and nulls. Count alone can be fooled by duplicates
          // if no unique constraint on (generationId, projectPromptId).
          const expectedIds = new Set(contentPrompts.map((p) => p.id));
          const actualProjectPromptIds = existingFragments.map((f) => f.projectPromptId);
          const hasNull = actualProjectPromptIds.some((id) => id === null);
          const actualIds = new Set(actualProjectPromptIds.filter(Boolean) as string[]);
          const complete = !hasNull &&
            existingFragments.length === expectedIds.size &&
            actualIds.size === expectedIds.size &&
            [...expectedIds].every((id) => actualIds.has(id));

          if (!complete) {
            await db
              .delete(fragments)
              .where(eq(fragments.chapterGenerationId, generationId));
          } else {
            for (const f of existingFragments) {
              fragmentContents.push({
                id: f.id,
                title: f.title ?? "Fragment",
                content: f.content ?? "",
              });
            }
          }
        }
        if (fragmentContents.length === 0) {
          // Load placeholders — effectiveTopic already computed at guard above
          const placeholders = await getChapterPlaceholders(gen.chapterId, effectiveTopic);

          // Mandatory placeholder validation
          const contentPromptStrings = contentPrompts.flatMap((p) =>
            [p.content, p.userPrompt].filter((s): s is string => typeof s === "string" && s.length > 0),
          );
          const requiredTokens = extractPlaceholders(contentPromptStrings);
          const missingPlaceholders = requiredTokens.filter(
            (name) => !(name in placeholders),
          );

          if (missingPlaceholders.length > 0) {
            const missing = missingPlaceholders.join(", ");
            const msg = `Cannot generate: the following placeholders have no definitions: {${missing.replace(/, /g, "}, {")}}. Fill them first via the placeholder filling UI before generating fragments.`;
            await db
              .update(chapterGenerations)
              .set({ status: "failed", error: msg })
              .where(eq(chapterGenerations.id, generationId));
            throw new Error(msg);
          }

          // ── Phase 1: Generate content fragments ──────────────────────────
          const PARALLEL_FRAGMENTS = 3;
          const results = await runSettledWithConcurrency(
            contentPrompts,
            PARALLEL_FRAGMENTS,
            async (prompt) => {
              const result = await generatePromptContent({
                prompt,
                placeholders,
                projectTopic: effectiveTopic,
                projectId,
                chapterId: gen.chapterId,
                chapterGenerationId: generationId,
                chapterPromptRevisionId: prompt.currentRevisionId ?? undefined,
                editorialContext: editorialBundle
                  ? renderEditorialData(editorialBundle, { chapterId: gen.chapterId })
                  : null,
                ...(model ? { model } : {}),
                ...(effort !== undefined ? { effort } : {}),
              });

              const [inserted] = await db
                .insert(fragments)
                .values({
                  chapterGenerationId: generationId,
                  projectPromptId: prompt.id,
                  promptRevisionId: prompt.currentRevisionId,
                  executionId: result.executionId ?? null,
                  position: prompt.position,
                  content: result.text,
                  modelUsed: result.model,
                  tokensUsed:
                    (result.usage?.inputTokens ?? 0) +
                    (result.usage?.outputTokens ?? 0),
                  metadata: {
                    provider: result.provider,
                    ...(result.usage?.costUsd != null ? { costUsd: result.usage.costUsd } : {}),
                    ...(result.usage?.cacheCreationTokens ? { cacheCreationTokens: result.usage.cacheCreationTokens } : {}),
                    ...(result.usage?.cacheReadTokens ? { cacheReadTokens: result.usage.cacheReadTokens } : {}),
                    ...(result.durationMs ? { durationMs: result.durationMs } : {}),
                  },
                })
                .returning({ id: fragments.id });

              return {
                id: inserted.id,
                title: prompt.title,
                content: result.text,
              };
            },
          );

        // Preserve original order
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          if (r.status === "fulfilled") {
            fragmentContents.push(r.value);
          } else {
            throw r.reason;
          }
          }
        }
      }

      if (fragmentContents.length === 0) {
        await db
          .update(chapterGenerations)
          .set({
            status: "awaiting_assembly",
            completedAt: new Date(),
          })
          .where(eq(chapterGenerations.id, generationId));
        return;
      }

      // ── Phase 2: Planning ────────────────────────────────────────────
      // Skip planning if a valid plan was persisted from a previous attempt
      // (retry recovery — fragments survive, plan survives, assembly retries).
      let plan: Record<string, unknown> | null = persistedPlan;
      let plannerExecutionId: string | null = null;

      // Build editorial data context (data-only, no instructions)
      const editorialData = editorialBundle
        ? renderEditorialData(editorialBundle, { chapterId: gen.chapterId })
        : null;

      // Derive mustCover and current fragment IDs for plan validation.
      // These must be available before the plan check so semantic validation
      // can verify the persisted plan against the CURRENT generation state.
      let mustCover: string[] = [];
      if (editorialBundle) {
        const contract = editorialBundle.contracts.find(
          (c) => c.chapterId === gen.chapterId,
        );
        if (contract) {
          mustCover = contract.mustCover;
        }
      }
      const currentFragmentIds = fragmentContents.map((f) => f.id);

      // Validate persisted plan if present. Use semantic validation
      // (validateAssemblyPlan) not just structural (safeParse) — fragments
      // may have been regenerated with new IDs, making the old plan stale.
      if (plan) {
        const parsed = assemblyPlanV1Schema.safeParse(plan);
        if (parsed.success) {
          try {
            validateAssemblyPlan(parsed.data, { fragmentIds: currentFragmentIds, mustCover });
            // Plan is valid against current state — reuse it
            const existingMeta = (gen.planningMetadata as Record<string, unknown> | null) ?? {};
            plannerExecutionId = (existingMeta.plannerExecutionId as string) ?? null;
          } catch {
            // Semantic validation failed (stale IDs, missing mustCover) — re-plan.
            // Keep plannerPromptRevisionId — revision still valid, only plan output stale.
            plan = null;
            await db
              .update(chapterGenerations)
              .set({ assemblyPlan: null, planningMetadata: null })
              .where(eq(chapterGenerations.id, generationId));
          }
        } else {
          // Structural validation failed — re-plan. Keep revision.
          plan = null;
          await db
            .update(chapterGenerations)
            .set({ assemblyPlan: null, planningMetadata: null })
            .where(eq(chapterGenerations.id, generationId));
        }
      }

      if (!plan) {
        // Transition generating → planning
        await db
          .update(chapterGenerations)
          .set({ status: "planning" })
          .where(eq(chapterGenerations.id, generationId));

        // Resolve planner revision: persisted (retry) > payload > resolve default.
        // Always persist before LLM call — retry reuses same revision even if
        // defaults change between attempts.
        const effectivePlannerRevisionId = gen.plannerPromptRevisionId ?? plannerRevisionId ??
          (await resolvePromptRevision({ kind: "assembly-planner", projectId })).id;
        await db
          .update(chapterGenerations)
          .set({ plannerPromptRevisionId: effectivePlannerRevisionId })
          .where(eq(chapterGenerations.id, generationId));

        const plannerResult = await runAssemblyPlanner({
          projectId,
          model: model ?? DEFAULT_GENERATION_MODEL,
          editorialContext: editorialData ?? "",
          fragments: fragmentContents.map((f) => ({
            id: f.id,
            title: f.title,
            content: f.content,
          })),
          validationContext: {
            fragmentIds: fragmentContents.map((f) => f.id),
            mustCover,
          },
          effort,
          chapterId: gen.chapterId,
          chapterGenerationId: generationId,
          revisionId: effectivePlannerRevisionId,
          dataLineage: {
            '{{EDITORIAL_CONTEXT}}': genSnapshot ? {
              entityIds: [genSnapshot.editorialBriefId],
              versionIds: [`${genSnapshot.editorialBriefVersion}`],
              sourceHashes: [genSnapshot.editorialBriefHash],
            } : {},
            '{{SECCIONES_GENERADAS}}': {
              entityIds: fragmentContents.map((f) => f.id),
            },
          },
        });

        plan = plannerResult.plan as unknown as Record<string, unknown>;
        plannerExecutionId = plannerResult.executionId;

        // Store the assembly plan and planning metadata
        await db
          .update(chapterGenerations)
          .set({
            assemblyPlan: plan,
            planningMetadata: {
              model: plannerResult.model,
              tokensUsed: plannerResult.usage.totalTokens,
              costUsd: plannerResult.usage.costUsd,
              durationMs: plannerResult.durationMs,
              plannerExecutionId: plannerResult.executionId,
              pipeline: "planned-editorial-v1",
            },
          })
          .where(eq(chapterGenerations.id, generationId));
      }

      // ── Phase 3: Assembly (with originality gate) ────────────────────
      // Transition planning → assembling
      await db
        .update(chapterGenerations)
        .set({ status: "assembling" })
        .where(eq(chapterGenerations.id, generationId));

      // plan is guaranteed non-null here — either from planner or persisted
      const assemblyPlan = plan!;

      // Resolve assembly revision: persisted (retry) > payload > resolve default.
      // Same pattern as planner — persist before LLM so retries are deterministic.
      const effectiveAssemblyRevisionId = gen.assemblyPromptRevisionId ?? assemblyRevisionId ??
        (await resolvePromptRevision({ kind: "assembly", projectId })).id;
      await db
        .update(chapterGenerations)
        .set({ assemblyPromptRevisionId: effectiveAssemblyRevisionId })
        .where(eq(chapterGenerations.id, generationId));

      // Compute artifact hash from fragments for lineage tracking
      const assemblyArtifactHash = sha256Text(
        JSON.stringify(fragmentContents.map((f) => ({
          id: f.id,
          content: f.content,
        }))),
      );

      try {
        await runOriginalityGate({
          context: {
            projectId,
            chapterId: gen.chapterId,
            chapterGenerationId: generationId,
            stage: "assembly",
            fieldPath: "assembly.content",
            authorization: currentAuthorization,
            templateArtifactHash: assemblyArtifactHash,
          },
          generate: async () => {
            const assemblerResult = await runAssemblyAssembler({
              projectId,
              model: model ?? DEFAULT_GENERATION_MODEL,
              editorialContext: editorialData ?? "",
              plan: assemblyPlan as unknown as import("@/lib/assembly/plan-schema").AssemblyPlanV1,
              fragments: fragmentContents.map((f) => ({
                id: f.id,
                title: f.title,
                content: f.content,
              })),
              effort,
              chapterId: gen.chapterId,
              chapterGenerationId: generationId,
              revisionId: effectiveAssemblyRevisionId,
              dataLineage: {
                '{{EDITORIAL_CONTEXT}}': genSnapshot ? {
                  entityIds: [genSnapshot.editorialBriefId],
                  versionIds: [`${genSnapshot.editorialBriefVersion}`],
                  sourceHashes: [genSnapshot.editorialBriefHash],
                } : {},
                '{{SECCIONES_GENERADAS}}': {
                  entityIds: fragmentContents.map((f) => f.id),
                },
                '{{ASSEMBLY_PLAN}}': {
                  sourceHashes: [createHash("sha256").update(JSON.stringify(assemblyPlan)).digest("hex")],
                },
              },
            });

            return {
              value: assemblerResult,
              text: assemblerResult.chapterText,
              executionId: assemblerResult.executionId,
              promptRevisions: {
                "assembly-planner": (plannerRevisionId ?? gen.plannerPromptRevisionId ?? "") as string,
                "assembly": assemblerResult.revisionId,
              },
            };
          },
          persistAccepted: async (tx, candidate, assessmentId, lineage) => {
            const a = candidate.value;
            await tx
              .update(chapterGenerations)
              .set({
                status: "completed",
                assembledContent: a.chapterText,
                assemblyMetadata: {
                  algorithm: "planned-editorial-v1",
                  model: a.model,
                  fragmentCount: fragmentContents.length,
                  plannerExecutionId: plannerExecutionId ?? undefined,
                  assemblyExecutionId: a.executionId,
                  pipeline: "planned-editorial-v1",
                  originalityLineage: lineage,
                  originalityAssessmentId: assessmentId,
                },
                assemblyPromptRevisionId: a.revisionId,
                completedAt: new Date(),
              })
              .where(eq(chapterGenerations.id, generationId));
            return { entityType: "chapter_generation", entityId: generationId };
          },
        });
      } catch (gateErr) {
        if (gateErr instanceof OriginalityContaminationError) {
          return; // Already quarantined by gate
        }
        if (gateErr instanceof OriginalityDetectorUnavailableError) {
          await db
            .update(chapterGenerations)
            .set({ status: "failed", error: sanitizeError(gateErr) })
            .where(eq(chapterGenerations.id, generationId));
          return;
        }
        throw gateErr; // Let outer catch handle other errors
      }

    } catch (err) {
      const message = sanitizeError(err);
      const maxAttempts = ctx.run.maxAttempts ?? 3;
      const isLastAttempt = ctx.attempt.number >= maxAttempts;

      // Never delete fragments — they survive for retry recovery.
      // The persisted fragments and assemblyPlan enable the next attempt
      // to skip re-generation and re-planning.

      // Mark terminal only on last attempt; reset to pending for retry
      await db
        .update(chapterGenerations)
        .set({ status: isLastAttempt ? "failed" : "pending", error: message })
        .where(eq(chapterGenerations.id, generationId));
      throw err;
    }
  },
});
