import { db } from "@/lib/db";
import { bookTemplates, chapters, templatePipelineRuns } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { beginRegeneration } from "./operations";
import { COMPILER_HASH } from "@/lib/template-pipeline/compiler";
import { SAFE_PIPELINE_VERSION, ORIGINALITY_POLICY_VERSION } from "@/lib/template-pipeline/contracts";
import { sha256Text } from "@/lib/template-pipeline/hash";
import { generateTemplate } from "@/trigger/generate-template";
import { resolvePromptRevision } from "@/lib/prompts/repository";
import type { RegenerationInput } from "./contracts";
import { readdir, readFile } from "fs/promises";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlanRegenerationInput {
  operationId: string;
  legacyTemplateId: string;
  rhetoricTraceRevisionId: string;
  sourceProfilerRevisionId: string;
  sourceDir?: string;
  allowExecutionSource?: boolean;
  dryRun: boolean;
}

export interface RegenerationPlan {
  legacyTemplateId: string;
  legacyTemplateName: string;
  chapterCount: number;
  sourceHashes: string[];
  compilerHash: string;
  policyVersion: string;
  pipelineVersion: string;
  dryRun: boolean;
  warnings: string[];
  chapters: Array<{
    chapterId: string;
    title: string;
    contentMd: string;
    position: number;
  }>;
}

export interface RegenerationResult {
  templateId: string;
  pipelineRunId: string;
  operationId: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class TemplateValidationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TemplateValidationError";
  }
}

// ---------------------------------------------------------------------------
// Revision validation
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function validateRevisions(
  rhetoricTraceRevisionId: string,
  sourceProfilerRevisionId: string,
): Promise<void> {
  if (!UUID_RE.test(rhetoricTraceRevisionId)) {
    throw new TemplateValidationError(
      `Invalid rhetoric trace revision ID: ${rhetoricTraceRevisionId}`,
    );
  }
  if (!UUID_RE.test(sourceProfilerRevisionId)) {
    throw new TemplateValidationError(
      `Invalid source profiler revision ID: ${sourceProfilerRevisionId}`,
    );
  }

  // Verify revisions exist in the repository
  try {
    await resolvePromptRevision({
      kind: "rhetoric-trace",
      runRevisionId: rhetoricTraceRevisionId,
    });
  } catch (err) {
    throw new TemplateValidationError(
      `Rhetoric trace revision not found: ${rhetoricTraceRevisionId}`,
      { cause: err },
    );
  }

  try {
    await resolvePromptRevision({
      kind: "source-risk-profiler",
      runRevisionId: sourceProfilerRevisionId,
    });
  } catch (err) {
    throw new TemplateValidationError(
      `Source profiler revision not found: ${sourceProfilerRevisionId}`,
      { cause: err },
    );
  }
}

// ---------------------------------------------------------------------------
// Source file reading
// ---------------------------------------------------------------------------

interface SourceFileEntry {
  content: string;
  hash: string;
}

async function readSourceFiles(sourceDir: string): Promise<SourceFileEntry[]> {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((name) => name.endsWith(".md"))
    .sort(); // lexicographic sort

  if (files.length === 0) {
    throw new TemplateValidationError(`No .md files found in ${sourceDir}`);
  }

  const results: SourceFileEntry[] = [];
  for (const file of files) {
    const content = await readFile(path.join(sourceDir, file), "utf-8");
    const hash = sha256Text(content);
    results.push({ content, hash });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

/**
 * Plan a template regeneration: validate inputs, compute source hashes, and
 * return a plan without performing any writes.
 *
 * Throws TemplateValidationError on validation failure.
 */
export async function planTemplateRegeneration(
  input: PlanRegenerationInput,
): Promise<RegenerationPlan> {
  // 1. Validate source mode
  const hasSourceDir = typeof input.sourceDir === "string" && input.sourceDir.length > 0;
  const hasAllowExecutionSource = input.allowExecutionSource === true;

  if (!hasSourceDir && !hasAllowExecutionSource) {
    throw new TemplateValidationError(
      "Either sourceDir or allowExecutionSource must be provided",
    );
  }
  if (hasSourceDir && hasAllowExecutionSource) {
    throw new TemplateValidationError(
      "Cannot provide both sourceDir and allowExecutionSource",
    );
  }

  // 2. Validate revisions exist
  await validateRevisions(input.rhetoricTraceRevisionId, input.sourceProfilerRevisionId);

  // 3. Load legacy template
  const [tpl] = await db
    .select()
    .from(bookTemplates)
    .where(eq(bookTemplates.id, input.legacyTemplateId));

  if (!tpl) {
    throw new TemplateValidationError(
      `Legacy template not found: ${input.legacyTemplateId}`,
    );
  }

  // 4. Load chapters
  const templateChapters = await db
    .select({ id: chapters.id, position: chapters.position, title: chapters.title })
    .from(chapters)
    .where(eq(chapters.bookTemplateId, input.legacyTemplateId))
    .orderBy(chapters.position);

  const chapterCount = templateChapters.length;

  if (chapterCount === 0) {
    throw new TemplateValidationError(
      `Legacy template has no chapters: ${input.legacyTemplateId}`,
    );
  }

  // 5. Compute sourceHashes and chapter content
  let sourceHashes: string[];
  let chapterContents: string[];

  if (hasSourceDir) {
    const sourceFiles = await readSourceFiles(input.sourceDir!);

    if (sourceFiles.length !== chapterCount) {
      throw new TemplateValidationError(
        `Source file count (${sourceFiles.length}) does not match chapter count (${chapterCount})`,
      );
    }

    sourceHashes = sourceFiles.map((f) => f.hash);
    chapterContents = sourceFiles.map((f) => f.content);
  } else {
    // allowExecutionSource: derive hashes from chapter metadata
    sourceHashes = templateChapters.map((ch) =>
      sha256Text(`${ch.id}:${ch.title}`),
    );
    chapterContents = templateChapters.map(() => "");
  }

  // 6. Build chapter payloads
  const chaptersPayload = templateChapters.map((ch, i) => ({
    chapterId: ch.id,
    title: ch.title,
    contentMd: chapterContents[i],
    position: ch.position,
  }));

  return {
    legacyTemplateId: input.legacyTemplateId,
    legacyTemplateName: tpl.name,
    chapterCount,
    sourceHashes,
    compilerHash: COMPILER_HASH,
    policyVersion: ORIGINALITY_POLICY_VERSION,
    pipelineVersion: SAFE_PIPELINE_VERSION,
    dryRun: input.dryRun,
    warnings: [],
    chapters: chaptersPayload,
  };
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

/**
 * Execute a template regeneration: validate, acquire the maintenance
 * operation, and create the new template + trigger the pipeline if new.
 *
 * - dryRun: returns empty result (no writes)
 * - operation completed: returns existing result template ID
 * - operation running: returns partial info
 * - operation new: creates template, chapters, pipeline run, enqueues trigger
 */
export async function executeTemplateRegeneration(
  input: PlanRegenerationInput,
): Promise<RegenerationResult> {
  // 1. Validate plan first (computes source hashes from source dir)
  const plan = await planTemplateRegeneration(input);

  // 2. If dryRun, return empty result (no writes)
  if (plan.dryRun) {
    return {
      templateId: "",
      pipelineRunId: "",
      operationId: input.operationId,
    };
  }

  // 3. Build RegenerationInput for beginRegeneration
  const regenInput: RegenerationInput = {
    operationId: input.operationId,
    legacyTemplateId: input.legacyTemplateId,
    sourceHashes: plan.sourceHashes,
    rhetoricTraceRevisionId: input.rhetoricTraceRevisionId,
    sourceProfilerRevisionId: input.sourceProfilerRevisionId,
    compilerHash: COMPILER_HASH,
    policyVersion: ORIGINALITY_POLICY_VERSION,
  };

  // 4. Acquire operation
  const operation = await beginRegeneration(regenInput);

  // 5. Handle completed / running states
  if (operation.state === "completed") {
    const tid = operation.operation.resultTemplateId;
    if (!tid) {
      throw new TemplateValidationError(
        `Operation ${input.operationId} completed with no result template`,
      );
    }
    return {
      templateId: tid,
      pipelineRunId: "",
      operationId: input.operationId,
    };
  }

  if (operation.state === "running") {
    const tid = operation.operation.resultTemplateId;
    if (tid) {
      return {
        templateId: tid,
        pipelineRunId: "",
        operationId: input.operationId,
      };
    }
    // Running but no result yet
    return {
      templateId: "",
      pipelineRunId: "",
      operationId: input.operationId,
    };
  }

  // 6. state === "new" — create template and enqueue trigger
  const { newTemplateId, pipelineRunId } = await db.transaction(async (tx) => {
    // a. Create new template
    const [newTemplate] = await tx
      .insert(bookTemplates)
      .values({
        name: `${plan.legacyTemplateName} (clean v2)`,
        status: "generating",
      })
      .returning();

    // b. Create chapters for new template (same positions and titles)
    const createdChapters: Array<{ id: string }> = [];
    for (const ch of plan.chapters) {
      const [dbCh] = await tx
        .insert(chapters)
        .values({
          bookTemplateId: newTemplate.id,
          position: ch.position,
          title: ch.title,
        })
        .returning();
      createdChapters.push(dbCh);
    }

    // c. Create pipeline run with operation tracking in report
    const [run] = await tx
      .insert(templatePipelineRuns)
      .values({
        bookTemplateId: newTemplate.id,
        status: "running",
        pipelineVersion: SAFE_PIPELINE_VERSION,
        rhetoricTraceRevisionId: input.rhetoricTraceRevisionId,
        originalityPolicyVersion: ORIGINALITY_POLICY_VERSION,
        report: {
          operationId: input.operationId,
          legacyTemplateId: input.legacyTemplateId,
        },
      })
      .returning();

    return {
      newTemplateId: newTemplate.id,
      pipelineRunId: run.id,
      createdChapterIds: createdChapters.map((c) => c.id),
    };
  });

  // 7. Enqueue generate-template task (outside transaction)
  const chapterPayloads = plan.chapters.map((ch) => ({
    chapterId: ch.chapterId,
    title: ch.title,
    contentMd: ch.contentMd,
    position: ch.position,
  }));

  await generateTemplate.trigger({
    templateId: newTemplateId,
    pipelineRunId,
    rhetoricTraceRevisionId: input.rhetoricTraceRevisionId,
    sourceProfilerRevisionId: input.sourceProfilerRevisionId,
    chapters: chapterPayloads,
  });

  return {
    templateId: newTemplateId,
    pipelineRunId,
    operationId: input.operationId,
  };
}
