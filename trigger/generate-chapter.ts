import { task } from "@trigger.dev/sdk";
import { db } from "@/lib/db";
import {
  chapterGenerations,
  projectPrompts,
  fragments,
  projects,
  chapters,
  assemblyPrompts,
} from "@/lib/db/schema";
import { eq, asc, and, inArray } from "drizzle-orm";
import { generatePromptContent, generateChapterAssemblyHierarchical, generateChapterAssemblySequential, generateChapterAssemblyHalves, type PromptLike, type AssemblyAlgorithm } from "@/lib/generate";
import { getChapterPlaceholders, extractPlaceholders, syncChapterPlaceholders } from "@/lib/placeholders";
import { STALE_TIMEOUT_MS } from "@/lib/api/rate-limit";
import { sanitizeError } from "@/lib/sanitize-error";

export const generateChapter = task({
  id: "generate-chapter",
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 5_000,
    maxTimeoutInMs: 60_000,
  },
  run: async (payload: {
      generationId: string;
      projectId: string;
      model?: string;
      effort?: "off" | "max" | "xhigh";
      skipAssembly?: boolean;
      assemblyAlgorithm?: AssemblyAlgorithm;
      fragmentIds?: string[];
      assemblyPromptId?: string;
    }) => {
    const { generationId, projectId, model, effort, skipAssembly, assemblyAlgorithm, fragmentIds, assemblyPromptId: payloadAssemblyPromptId } = payload;

    // Load generation
    const [gen] = await db
      .select()
      .from(chapterGenerations)
      .where(eq(chapterGenerations.id, generationId))
      .limit(1);
    if (!gen) throw new Error(`ChapterGeneration ${generationId} not found`);

    // Idempotency guard — skip if already in a terminal state
    const terminalStatuses = ["completed", "failed", "awaiting_assembly"];
    if (terminalStatuses.includes(gen.status)) {
      return;
    }
    // If stale (worker likely died), recover. If fresh, guard against retry race.
    if (gen.status === "generating" || gen.status === "assembling") {
      const staleCutoff = new Date(Date.now() - STALE_TIMEOUT_MS);
      if (gen.createdAt && new Date(gen.createdAt) > staleCutoff) {
        // Fresh — likely a retry racing with the first attempt
        return;
      }
      // Stale — previous attempt died; reset to pending and recover below
      await db
        .update(chapterGenerations)
        .set({ status: "pending" })
        .where(eq(chapterGenerations.id, generationId));
      gen.status = "pending";
    }

    // The generation_status enum has exactly 6 values. All are handled above.
    // If execution reaches here, the DB enum acquired a new value without a
    // corresponding code update — fail loudly rather than proceeding blindly.
    // Must set failed BEFORE throwing: this code is outside the try/catch below
    // so the catch block won't fire. The idempotency guard above will skip
    // retries once status is set to "failed".
    if (gen.status !== "pending") {
      const msg =
        `Unrecognized generation status "${gen.status}" for ${generationId} — ` +
        `expected one of: pending, generating, assembling, completed, failed, awaiting_assembly`;
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
      // Another process claimed this generation — let it finish
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

    // Load project prompts for this chapter
    const promptList = await db
      .select()
      .from(projectPrompts)
      .where(
        and(
          eq(projectPrompts.projectId, projectId),
          eq(projectPrompts.chapterId, gen.chapterId),
        ),
      )
      .orderBy(asc(projectPrompts.position));

    const contentPrompts = promptList.filter(
      (p) => !p.isAssembly && !p.isCritique,
    );
    const assemblyPromptRow = promptList.find((p) => p.isAssembly);
    let assemblyPrompt: PromptLike | undefined = assemblyPromptRow;
    let assemblyMetadata:
      | {
          promptId?: string;
          promptTitle?: string;
          promptSource?: string;
        }
      | undefined;
    if (assemblyPromptRow) {
      assemblyMetadata = {
        promptId: assemblyPromptRow.id,
        promptTitle: assemblyPromptRow.title,
        promptSource: "chapter",
      };
    }

    // Resolve assembly prompt with priority: payload > project > chapter
    const effectiveAssemblyPromptId = payloadAssemblyPromptId ?? project.assemblyPromptId;
    if (effectiveAssemblyPromptId) {
      const [globalAp] = await db
        .select()
        .from(assemblyPrompts)
        .where(eq(assemblyPrompts.id, effectiveAssemblyPromptId))
        .limit(1);
      if (globalAp) {
        assemblyPrompt = {
          content: globalAp.content,
          userPrompt: globalAp.userPrompt,
        };
        assemblyMetadata = {
          promptId: globalAp.id,
          promptTitle: globalAp.name,
          promptSource: "library",
        };
        // Sync placeholders from assembly prompt to chapterPlaceholders.
        // Uses syncChapterPlaceholders for case-variant dedup, lowercasing,
        // and auto-resolve of tema variants from project.topic.
        const apContents = [globalAp.content, globalAp.userPrompt].filter(
          (s): s is string => typeof s === "string" && s.length > 0,
        );
        if (apContents.length > 0) {
          await syncChapterPlaceholders(gen.chapterId, apContents, project.topic);
        }
      }
    }

    const fragmentContents: { title: string; content: string }[] = [];

    try {
      // Load placeholders
      const placeholders = await getChapterPlaceholders(gen.chapterId, project.topic);

      // Mandatory placeholder validation: all {name} tokens in content AND assembly
      // prompts must have definitions before generating fragments.
      // In assembly-only mode, content prompts are irrelevant — only validate assembly.
      const contentPromptStrings = fragmentIds?.length
        ? []
        : contentPrompts.flatMap((p) =>
            [p.content, p.userPrompt].filter((s): s is string => typeof s === "string" && s.length > 0),
          );
      const assemblyPromptStrings = assemblyPrompt
        ? [assemblyPrompt.content, assemblyPrompt.userPrompt].filter(
            (s): s is string => typeof s === "string" && s.length > 0,
          )
        : [];
      const requiredTokens = extractPlaceholders([
        ...contentPromptStrings,
        ...assemblyPromptStrings,
      ]);
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

      if (fragmentIds && fragmentIds.length > 0) {
        // Assembly-only mode: use pre-selected fragments, skip content generation.
        // Transition generating → assembling immediately.
        await db
          .update(chapterGenerations)
          .set({ status: "assembling" })
          .where(eq(chapterGenerations.id, generationId));

        const selectedFragments = await db
          .select({
            id: fragments.id,
            content: fragments.content,
            position: fragments.position,
            promptTitle: projectPrompts.title,
          })
          .from(fragments)
          .leftJoin(
            projectPrompts,
            eq(fragments.projectPromptId, projectPrompts.id),
          )
          .where(inArray(fragments.id, fragmentIds))
          .orderBy(asc(fragments.position));

        if (selectedFragments.length !== fragmentIds.length) {
          throw new Error(
            `Some fragments not found. Expected ${fragmentIds.length}, found ${selectedFragments.length}.`,
          );
        }

        for (const f of selectedFragments) {
          fragmentContents.push({
            title: (f.promptTitle ?? "Fragment") as string,
            content: f.content ?? "",
          });
        }
      } else {
        // Normal mode: generate content for each content prompt
        for (const prompt of contentPrompts) {
          const result = await generatePromptContent({
            prompt,
            placeholders,
            projectTopic: project.topic,
            projectId,
            ...(model ? { model } : {}),
            ...(effort !== undefined ? { effort } : {}),
          });

          await db
            .insert(fragments)
            .values({
              chapterGenerationId: generationId,
              projectPromptId: prompt.id,
              position: prompt.position,
              content: result.text,
              modelUsed: result.model,
              tokensUsed:
                (result.usage?.inputTokens ?? 0) +
                (result.usage?.outputTokens ?? 0),
              metadata: result.provider
                ? { provider: result.provider }
                : undefined,
            });

          fragmentContents.push({
            title: prompt.title,
            content: result.text,
          });
        }

        // Transition generating → assembling
        await db
          .update(chapterGenerations)
          .set({ status: "assembling" })
          .where(eq(chapterGenerations.id, generationId));
      }

      // Assemble chapter (unless skipped)
      if (assemblyPrompt && fragmentContents.length > 0 && !skipAssembly) {
        const assemble = assemblyAlgorithm === "sequential"
          ? generateChapterAssemblySequential
          : assemblyAlgorithm === "halves"
            ? generateChapterAssemblyHalves
            : generateChapterAssemblyHierarchical;

        const assembled = await assemble(
          assemblyPrompt,
          fragmentContents,
          placeholders,
          model,
          undefined,
          effort,
          undefined,
        );

        await db
          .update(chapterGenerations)
          .set({
            status: "completed",
            assembledContent: assembled.text,
            assemblyMetadata: {
              algorithm: assemblyAlgorithm ?? "merge-sort",
              ...assemblyMetadata,
              model: assembled.model,
              fragmentCount: fragmentContents.length,
            },
            completedAt: new Date(),
          })
          .where(eq(chapterGenerations.id, generationId));
      } else {
        // No assembly prompt configured — mark as awaiting manual assembly
        await db
          .update(chapterGenerations)
          .set({
            status: "awaiting_assembly",
            completedAt: new Date(),
          })
          .where(eq(chapterGenerations.id, generationId));
      }

    } catch (err) {
      const message = sanitizeError(err);
      await db
        .update(chapterGenerations)
        .set({ status: "failed", error: message })
        .where(eq(chapterGenerations.id, generationId));
      throw err;
    }
  },
});
