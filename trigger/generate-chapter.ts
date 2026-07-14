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
import { loadEditorialBundle, snapshotFromGenerationMetadata, renderEditorialScope, renderEditorialData } from "@/lib/editorial-brief/context";
import { runAssemblyPlanner } from "@/lib/assembly/planner";
import { runAssemblyAssembler } from "@/lib/assembly/assembler";

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
      .returning({ id: chapterGenerations.id });
    if (!updated) {
      return;
    }

    // If fragments already exist (partial retry), clean them up before regenerating
    const existingFragments = await db
      .select({ id: fragments.id })
      .from(fragments)
      .where(eq(fragments.chapterGenerationId, generationId));

    if (existingFragments.length > 0) {
      await db.delete(fragments).where(eq(fragments.chapterGenerationId, generationId));
    }

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
            editorialContext: editorialBundle
              ? renderEditorialScope(editorialBundle, { scope: "fragment", chapterId: gen.chapterId })
              : null,
            ...(model ? { model } : {}),
            ...(effort !== undefined ? { effort } : {}),
          });

          await db
            .insert(fragments)
            .values({
              chapterGenerationId: generationId,
              projectPromptId: prompt.id,
              promptRevisionId: prompt.currentRevisionId,
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
            });

          return {
            id: prompt.id,
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
      // Transition generating → planning
      await db
        .update(chapterGenerations)
        .set({ status: "planning" })
        .where(eq(chapterGenerations.id, generationId));

      // Build editorial data context (data-only, no instructions)
      const editorialData = editorialBundle
        ? renderEditorialData(editorialBundle, { chapterId: gen.chapterId })
        : null;

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
        model: model ?? "claude-sonnet-4-20250514",
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
        ...(plannerRevisionId ? { revisionId: plannerRevisionId } : {}),
      });

      // Store the assembly plan and planning metadata
      await db
        .update(chapterGenerations)
        .set({
          assemblyPlan: plannerResult.plan as unknown as Record<string, unknown>,
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

      // ── Phase 3: Assembly ────────────────────────────────────────────
      // Transition planning → assembling
      await db
        .update(chapterGenerations)
        .set({ status: "assembling" })
        .where(eq(chapterGenerations.id, generationId));

      const assemblerResult = await runAssemblyAssembler({
        projectId,
        model: model ?? "claude-sonnet-4-20250514",
        editorialContext: editorialData ?? "",
        plan: plannerResult.plan,
        fragments: fragmentContents.map((f) => ({
          id: f.id,
          title: f.title,
          content: f.content,
        })),
        effort,
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
            plannerExecutionId: plannerResult.executionId,
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

      // Prevent orphaned fragments from partial runs
      await db
        .delete(fragments)
        .where(eq(fragments.chapterGenerationId, generationId))
        .catch(() => {});

      // Mark terminal only on last attempt
      await db
        .update(chapterGenerations)
        .set({ status: isLastAttempt ? "failed" : "pending", error: message })
        .where(eq(chapterGenerations.id, generationId));
      throw err;
    }
  },
});
