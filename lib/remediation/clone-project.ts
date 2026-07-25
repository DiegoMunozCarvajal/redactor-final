import { db } from "@/lib/db";
import {
  projects,
  chapters,
  sources,
  sourceChunks,
  editorialBriefs,
  chapterEditorialContracts,
  editorialBriefSources,
  prompts,
} from "@/lib/db/schema";
import { bookTemplates } from "@/lib/db/schema/book-templates";
import { templatePipelineRuns } from "@/lib/db/schema/template-pipeline";
import { eq, and } from "drizzle-orm";
import {
  beginClone,
  completeMaintenanceOperation,
} from "./operations";
import { isTemplateEligible } from "@/lib/template-pipeline/eligibility";
import {
  copyTemplatePromptsToChapter,
  copyTemplatePlaceholdersBatch,
} from "@/lib/db/queries/copy-template-prompts";
import { remapEditorialBundle } from "@/lib/editorial-brief/hash";
import { sha256Canonical } from "@/lib/template-pipeline/hash";
import type { CloneInput } from "./contracts";
import { OperationStateError } from "./contracts";
import type {
  EditorialBundle,
  EditorialBriefContent,
  ChapterEditorialContract,
} from "@/lib/editorial-brief/schema";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClonePlan {
  legacyProjectId: string;
  legacyProjectName: string;
  legacyUserId: string;
  legacyTemplateId: string;
  cleanTemplateId: string;
  cleanTemplateName: string;
  chapterCount: number;
  sourceCount: number;
  hasApprovedBrief: boolean;
  dryRun: boolean;
  warnings: string[];
  chapterMappings: Array<{
    cleanChapterId: string;
    position: number;
    title: string;
  }>;
  sourceMappings: Array<{
    legacySourceId: string;
    newSourceId: string;
  }>;
}

export interface CloneResult {
  newProjectId: string;
  operationId: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class CloneValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloneValidationError";
  }
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

/**
 * Plan a project clone: validate inputs and return a clone plan without
 * performing any writes.
 *
 * Throws CloneValidationError on validation failure.
 */
export async function planProjectClone(
  input: CloneInput & { dryRun: boolean },
): Promise<ClonePlan> {
  const warnings: string[] = [];

  // 1. Load legacy project
  const [legacyProject] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, input.legacyProjectId));

  if (!legacyProject) {
    throw new CloneValidationError(
      `Legacy project not found: ${input.legacyProjectId}`,
    );
  }

  // 2. Load legacy template
  if (!legacyProject.bookTemplateId) {
    throw new CloneValidationError(
      `Legacy project has no template: ${input.legacyProjectId}`,
    );
  }

  const [legacyTemplate] = await db
    .select()
    .from(bookTemplates)
    .where(eq(bookTemplates.id, legacyProject.bookTemplateId));

  if (!legacyTemplate) {
    throw new CloneValidationError(
      `Legacy project template not found: ${legacyProject.bookTemplateId}`,
    );
  }

  // 3. Load clean template
  const [cleanTemplate] = await db
    .select()
    .from(bookTemplates)
    .where(eq(bookTemplates.id, input.cleanTemplateId));

  if (!cleanTemplate) {
    throw new CloneValidationError(
      `Clean template not found: ${input.cleanTemplateId}`,
    );
  }

  // 4. Validate clean template eligibility
  let cleanPipelineRun;
  if (cleanTemplate.activePipelineRunId) {
    [cleanPipelineRun] = await db
      .select()
      .from(templatePipelineRuns)
      .where(eq(templatePipelineRuns.id, cleanTemplate.activePipelineRunId));
  }

  const eligible = isTemplateEligible({
    templateStatus: cleanTemplate.status,
    activeRunId: cleanPipelineRun?.id ?? null,
    runStatus: cleanPipelineRun?.status ?? null,
    pipelineVersion: cleanPipelineRun?.pipelineVersion ?? null,
    originalityPolicyVersion:
      cleanPipelineRun?.originalityPolicyVersion ?? null,
  });

  if (!eligible) {
    throw new CloneValidationError(
      `Clean template is not eligible: ${input.cleanTemplateId}`,
    );
  }

  // 5. Validate chapter counts match between legacy template and clean template
  const legacyChapters = await db
    .select({ id: chapters.id, position: chapters.position, title: chapters.title })
    .from(chapters)
    .where(eq(chapters.bookTemplateId, legacyTemplate.id))
    .orderBy(chapters.position);

  const cleanChapters = await db
    .select({ id: chapters.id, position: chapters.position, title: chapters.title })
    .from(chapters)
    .where(eq(chapters.bookTemplateId, cleanTemplate.id))
    .orderBy(chapters.position);

  if (legacyChapters.length !== cleanChapters.length) {
    throw new CloneValidationError(
      `Chapter count mismatch: legacy has ${legacyChapters.length}, clean has ${cleanChapters.length}`,
    );
  }

  // Verify positions align
  for (let i = 0; i < legacyChapters.length; i++) {
    if (legacyChapters[i].position !== cleanChapters[i].position) {
      throw new CloneValidationError(
        `Chapter position mismatch at index ${i}: legacy position ${legacyChapters[i].position} vs clean position ${cleanChapters[i].position}`,
      );
    }
  }

  // 6. Load legacy sources
  const legacySources = await db
    .select({ id: sources.id })
    .from(sources)
    .where(eq(sources.projectId, input.legacyProjectId));

  // 7. Check for approved editorial brief
  const [approvedBrief] = await db
    .select({ id: editorialBriefs.id, status: editorialBriefs.status })
    .from(editorialBriefs)
    .where(
      and(
        eq(editorialBriefs.projectId, input.legacyProjectId),
        eq(editorialBriefs.status, "approved"),
      ),
    )
    .limit(1);

  // 8. Check for project-specific prompts that won't be carried over
  const projectPrompts = await db
    .select({ id: prompts.id })
    .from(prompts)
    .where(
      and(eq(prompts.projectId, input.legacyProjectId)),
    )
    .limit(1);

  if (projectPrompts.length > 0) {
    warnings.push(
      "Legacy project has project-specific prompts that will not be copied",
    );
  }

  return {
    legacyProjectId: input.legacyProjectId,
    legacyProjectName: legacyProject.name,
    legacyUserId: legacyProject.userId,
    legacyTemplateId: legacyTemplate.id,
    cleanTemplateId: input.cleanTemplateId,
    cleanTemplateName: cleanTemplate.name,
    chapterCount: cleanChapters.length,
    sourceCount: legacySources.length,
    hasApprovedBrief: !!approvedBrief,
    dryRun: input.dryRun,
    warnings,
    chapterMappings: cleanChapters.map((ch) => ({
      cleanChapterId: ch.id,
      position: ch.position,
      title: ch.title,
    })),
    sourceMappings: legacySources.map((s) => ({
      legacySourceId: s.id,
      newSourceId: randomUUID(),
    })),
  };
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

/**
 * Execute a project clone: validate, acquire the maintenance operation, and
 * copy all user inputs onto the clean template.
 *
 * - dryRun: returns empty result (no writes)
 * - operation completed: returns existing new project ID
 * - operation running: throws (indicates concurrent clone in progress)
 * - operation new: creates cloned project, copies inputs
 */
export async function executeProjectClone(
  input: CloneInput & { dryRun: boolean },
): Promise<CloneResult> {
  // 1. Validate plan first
  const plan = await planProjectClone(input);

  // 2. If dryRun, return empty result (no writes)
  if (plan.dryRun) {
    return { newProjectId: "", operationId: input.operationId };
  }

  // 3. Acquire operation
  const operation = await beginClone(input);

  if (operation.state === "completed") {
    const pid = operation.operation.resultProjectId;
    if (!pid) {
      throw new CloneValidationError(
        `Operation ${input.operationId} completed with no result project`,
      );
    }
    return { newProjectId: pid, operationId: input.operationId };
  }

  if (operation.state === "running") {
    throw new OperationStateError(
      `Clone operation ${input.operationId} is already running`,
    );
  }

  // 4. Execute clone inside transaction
  const newProjectId = await db.transaction(async (tx) => {
    // Build chapter ID map: clean chapter id -> new project chapter id
    const chapterIdMap = new Map<string, string>();

    // a. Create new project (copy userId and topic from legacy)
    const [newProject] = await tx
      .insert(projects)
      .values({
        userId: plan.legacyUserId,
        name: `${plan.legacyProjectName} (clean)`,
        topic: null,
        bookTemplateId: input.cleanTemplateId,
        supersedesProjectId: input.legacyProjectId,
      })
      .returning();

    // b. Create new chapters from clean template
    for (const cm of plan.chapterMappings) {
      const [newCh] = await tx
        .insert(chapters)
        .values({
          projectId: newProject.id,
          position: cm.position,
          title: cm.title,
        })
        .returning();

      chapterIdMap.set(cm.cleanChapterId, newCh.id);
    }

    // c. Copy template prompts for each chapter
    for (const cm of plan.chapterMappings) {
      const newChId = chapterIdMap.get(cm.cleanChapterId);
      if (newChId) {
        await copyTemplatePromptsToChapter(
          tx,
          cm.cleanChapterId,
          newProject.id,
          newChId,
          plan.legacyUserId,
        );
      }
    }

    // d. Copy placeholders
    await copyTemplatePlaceholdersBatch(tx, chapterIdMap);

    // e. Load and copy legacy sources with new IDs
    const legacySourceRows = await tx
      .select()
      .from(sources)
      .where(eq(sources.projectId, input.legacyProjectId));

    const sourceIdMap = new Map<string, string>();
    for (const src of legacySourceRows) {
      const newId = randomUUID();
      sourceIdMap.set(src.id, newId);

      await tx.insert(sources).values({
        id: newId,
        projectId: newProject.id,
        fileName: src.fileName,
        fileType: src.fileType,
        sourceKind: src.sourceKind,
        extractedText: src.extractedText,
        citation: src.citation,
        processed: src.processed,
        chunkCount: src.chunkCount,
      });
    }

    // f. Load and copy source chunks
    for (const [legacySrcId, newSrcId] of sourceIdMap) {
      const chunks = await tx
        .select()
        .from(sourceChunks)
        .where(eq(sourceChunks.sourceId, legacySrcId));

      for (const chunk of chunks) {
        await tx.insert(sourceChunks).values({
          sourceId: newSrcId,
          projectId: newProject.id,
          chunkIndex: chunk.chunkIndex,
          content: chunk.content,
          tokenCount: chunk.tokenCount,
          embedding: chunk.embedding,
        });
      }
    }

    // g. Copy approved editorial brief if one exists
    if (plan.hasApprovedBrief) {
      const [approvedBrief] = await tx
        .select()
        .from(editorialBriefs)
        .where(
          and(
            eq(editorialBriefs.projectId, input.legacyProjectId),
            eq(editorialBriefs.status, "approved"),
          ),
        )
        .limit(1);

      if (approvedBrief) {
        const briefContracts = await tx
          .select()
          .from(chapterEditorialContracts)
          .where(
            eq(
              chapterEditorialContracts.editorialBriefId,
              approvedBrief.id,
            ),
          );

        const briefSources = await tx
          .select()
          .from(editorialBriefSources)
          .where(
            eq(editorialBriefSources.editorialBriefId, approvedBrief.id),
          );

        // Build legacy bundle from DB data
        const legacyBundle: EditorialBundle = {
          id: approvedBrief.id,
          version: approvedBrief.version,
          content: approvedBrief.content as EditorialBriefContent,
          contracts: briefContracts.map(
            (c) => c.content as unknown as ChapterEditorialContract,
          ),
          evidenceSourceIds: briefSources.map((bs) => bs.sourceId),
          hash: approvedBrief.contentHash,
        };

        // Remap chapter and source IDs, recompute hashes
        const remapped = remapEditorialBundle({
          bundle: legacyBundle,
          chapterIdMap,
          sourceIdMap,
        });

        // Insert remapped brief as approved
        const [newBrief] = await tx
          .insert(editorialBriefs)
          .values({
            projectId: newProject.id,
            version: 1,
            status: "approved",
            content: remapped.content as Record<string, unknown>,
            contentHash: remapped.hash,
            approvedAt: approvedBrief.approvedAt ?? new Date(),
          })
          .returning();

        // Insert remapped contracts
        for (const contract of remapped.contracts) {
          await tx.insert(chapterEditorialContracts).values({
            editorialBriefId: newBrief.id,
            chapterId: contract.chapterId,
            content: contract as unknown as Record<string, unknown>,
            contentHash: sha256Canonical(contract),
          });
        }

        // Insert remapped brief sources
        // Build reverse map: new source ID -> legacy source ID
        const reverseSourceMap = new Map<string, string>();
        for (const [legacyId, newId] of sourceIdMap) {
          reverseSourceMap.set(newId, legacyId);
        }

        for (const newSourceId of remapped.evidenceSourceIds) {
          const legacySourceId = reverseSourceMap.get(newSourceId);
          const origBs = legacySourceId
            ? briefSources.find((bs) => bs.sourceId === legacySourceId)
            : undefined;

          await tx.insert(editorialBriefSources).values({
            editorialBriefId: newBrief.id,
            sourceId: newSourceId,
            useForExtraction: origBs?.useForExtraction ?? true,
            useForEvidence: origBs?.useForEvidence ?? true,
          });
        }
      }
    }

    return newProject.id;
  });

  // 5. Complete operation outside transaction
  await completeMaintenanceOperation({
    operationId: input.operationId,
    resultProjectId: newProjectId,
    report: {
      counts: {
        chapters: plan.chapterCount,
        sources: plan.sourceCount,
        hasApprovedBrief: plan.hasApprovedBrief ? 1 : 0,
      },
    },
  });

  return { newProjectId, operationId: input.operationId };
}
