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
import { generatePromptContent } from "@/lib/generate";
import { getChapterPlaceholders, extractPlaceholders } from "@/lib/placeholders";
import { STALE_TIMEOUT_MS } from "@/lib/api/rate-limit";
import { sanitizeError } from "@/lib/sanitize-error";
import { runSettledWithConcurrency } from "@/lib/promise-pool";
import { loadEditorialBundle, snapshotFromGenerationMetadata, renderEditorialData } from "@/lib/editorial-brief/context";
import { runAssemblyPlanner } from "@/lib/assembly/planner";
import { runAssemblyAssembler } from "@/lib/assembly/assembler";
import { DEFAULT_GENERATION_MODEL } from "@/lib/ai/providers";

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
            title: prompts.title,
            content: fragments.content,
          })
          .from(fragments)
          .leftJoin(prompts, eq(fragments.projectPromptId, prompts.id))
          .where(eq(fragments.chapterGenerationId, generationId))
          .orderBy(asc(fragments.position));

        if (existingFragments.length > 0) {
          for (const f of existingFragments) {
            fragmentContents.push({
              id: f.id,
              title: f.title ?? "Fragment",
              content: f.content ?? "",
            });
          }
        } else {
          // Load placeholders
          const placeholders = await getChapterPlaceholders(gen.chapterId, project.topic);

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
                projectTopic: project.topic,
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

      if (!plan) {
        // Transition generating → planning
        await db
          .update(chapterGenerations)
          .set({ status: "planning" })
          .where(eq(chapterGenerations.id, generationId));

        // Derive mustCover from chapter contract
        let mustCover: string[] = [];
        if (editorialBundle) {
          const contract = editorialBundle.contracts.find(
            (c) => c.chapterId === gen.chapterId,
          );
          if (contract) {
            mustCover = contract.mustCover;
          }
        }

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
          ...(plannerRevisionId ? { revisionId: plannerRevisionId } : {}),
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
            ...(plannerRevisionId ? { plannerPromptRevisionId: plannerRevisionId } : {}),
          })
          .where(eq(chapterGenerations.id, generationId));
      } else {
        // Extract plannerExecutionId from existing planning metadata
        const existingMeta = (gen.planningMetadata as Record<string, unknown> | null) ?? {};
        plannerExecutionId = (existingMeta.plannerExecutionId as string) ?? null;
      }

      // ── Phase 3: Assembly ────────────────────────────────────────────
      // Transition planning → assembling
      await db
        .update(chapterGenerations)
        .set({ status: "assembling" })
        .where(eq(chapterGenerations.id, generationId));

      // plan is guaranteed non-null here — either from planner or persisted
      const assemblyPlan = plan!;

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
        ...(assemblyRevisionId ? { revisionId: assemblyRevisionId } : {}),
      });

      // Store assembled content
      await db
        .update(chapterGenerations)
        .set({
          status: "completed",
          assembledContent: assemblerResult.chapterText,
          assemblyMetadata: {
            algorithm: "planned-editorial-v1",
            model: assemblerResult.model,
            fragmentCount: fragmentContents.length,
            plannerExecutionId: plannerExecutionId,
            assemblyExecutionId: assemblerResult.executionId,
            pipeline: "planned-editorial-v1",
          },
          ...(assemblyRevisionId ? { assemblyPromptRevisionId: assemblyRevisionId } : {}),
          completedAt: new Date(),
        })
        .where(eq(chapterGenerations.id, generationId));

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
