// ---------------------------------------------------------------------------
// Originality Gate — atomic originality guard
//
// 1. Loads and verifies the profile set (throws on detector outage)
// 2. Generates a candidate
// 3. Evaluates originality
//    - Contaminated → save assessment, quarantine generation, throw
//    - Suspect → one retry with generic feedback
//      - Still suspect → save + quarantine + throw
//      - Clean → persist atomically
//    - Clean → persist atomically (assessment + accepted entity in one tx)
// ---------------------------------------------------------------------------

import { db } from "@/lib/db";
import { sha256Text } from "@/lib/template-pipeline/hash";
import { originalityAssessments } from "@/lib/db/schema/originality-assessments";
import { chapterGenerations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { evaluateOriginality } from "./evaluate";
import { loadOriginalityProfileSet } from "./profile-loader";
import { templateLineage, sourceFreeLineage } from "./lineage";
import {
  OriginalityContaminationError,
  OriginalityDetectorUnavailableError,
} from "./contracts";
import type {
  OriginalityDecision,
  OriginalityStage,
  OriginalitySignal,
} from "./contracts";
import type { OriginalityLineage } from "./lineage";
import type { GenerationAuthorization } from "@/lib/template-pipeline/contracts";
import type { LoadedProfileSet } from "./profile-loader";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GeneratedCandidate<T> {
  value: T;
  text: string;
  executionId: string;
  promptRevisions: Record<string, string>;
}

export interface OriginalityGateInput<T> {
  context: {
    projectId: string;
    chapterId?: string;
    chapterGenerationId?: string;
    stage: OriginalityStage;
    fieldPath: string;
    authorization: GenerationAuthorization;
    templateArtifactHash?: string;
    placeholderFunctionHash?: string;
    model?: string;
  };
  generate(input: { feedback?: string }): Promise<GeneratedCandidate<T>>;
  persistAccepted(
    tx: typeof db,
    candidate: GeneratedCandidate<T>,
    assessmentId: string,
    lineage: OriginalityLineage,
  ): Promise<{ entityType: string; entityId: string }>;
}

export interface OriginalityGateResult<T> {
  value: T;
  assessmentId: string;
  lineage: OriginalityLineage;
}

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

const GENERIC_FEEDBACK =
  "Use a materially different illustration, argument, and formulation.";

export async function runOriginalityGate<T>(
  input: OriginalityGateInput<T>,
): Promise<OriginalityGateResult<T>> {
  const { context, generate, persistAccepted } = input;

  // 1. Load and verify profile set
  let profileSet: LoadedProfileSet;
  try {
    profileSet = await loadOriginalityProfileSet(context.authorization);
  } catch (err) {
    if (err instanceof OriginalityDetectorUnavailableError) {
      throw new OriginalityDetectorUnavailableError(
        `Originality check unavailable for project ${context.projectId}: ${err.message}`,
      );
    }
    throw err;
  }

  // 2. Generate first candidate
  const firstCandidate = await generate({});

  // 3. Evaluate
  const firstResult = await evaluateOriginality({
    candidate: firstCandidate.text,
    fieldPath: context.fieldPath,
    profileSet,
    candidateExecutionId: firstCandidate.executionId,
    model: context.model,
  });

  // 4. Record non-clean assessment
  if (firstResult.decision !== "clean") {
    await saveAssessment({
      context,
      profileSet,
      candidate: firstCandidate,
      decision: firstResult.decision,
      signals: firstResult.signals,
      entityType: null,
      entityId: null,
    });
  }

  // 5. Contaminated -> quarantine and throw
  if (firstResult.decision === "contaminated") {
    await quarantineGeneration(context.chapterGenerationId);
    throw new OriginalityContaminationError(
      "contaminated",
      `Generated content flagged as contaminated for project ${context.projectId}`,
    );
  }

  // 6. Suspect -> one retry with generic feedback
  if (firstResult.decision === "suspect") {
    const secondCandidate = await generate({ feedback: GENERIC_FEEDBACK });

    const secondResult = await evaluateOriginality({
      candidate: secondCandidate.text,
      fieldPath: context.fieldPath,
      profileSet,
      candidateExecutionId: secondCandidate.executionId,
      model: context.model,
    });

    // Record non-clean second assessment
    if (secondResult.decision !== "clean") {
      await saveAssessment({
        context,
        profileSet,
        candidate: secondCandidate,
        decision: secondResult.decision,
        signals: secondResult.signals,
        entityType: null,
        entityId: null,
      });

      await quarantineGeneration(context.chapterGenerationId);
      throw new OriginalityContaminationError(
        secondResult.decision,
        `Generated content flagged as ${secondResult.decision} after retry for project ${context.projectId}`,
      );
    }

    // Second attempt clean -> proceed to persist
    return persistClean(input, context, profileSet, secondCandidate);
  }

  // 7. Clean -> persist atomically
  return persistClean(input, context, profileSet, firstCandidate);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function persistClean<T>(
  input: OriginalityGateInput<T>,
  context: OriginalityGateInput<T>["context"],
  profileSet: LoadedProfileSet,
  candidate: GeneratedCandidate<T>,
): Promise<OriginalityGateResult<T>> {
  const lineage = buildLineage(context, candidate.promptRevisions);

  return db.transaction(async (tx) => {
    // Insert clean assessment
    const [assessment] = await tx
      .insert(originalityAssessments)
      .values({
        scope: context.authorization.scope,
        pipelineRunId:
          context.authorization.scope === "template"
            ? context.authorization.pipelineRunId
            : null,
        projectId: context.projectId,
        chapterId: context.chapterId ?? null,
        chapterGenerationId: context.chapterGenerationId ?? null,
        executionId: candidate.executionId,
        stage: context.stage,
        candidateHash: sha256Text(candidate.text),
        sourceProfileSetHash: profileSet.profileSetHash,
        originalityPolicyVersion: context.authorization.originalityPolicyVersion,
        decision: "clean" as OriginalityDecision,
        signals: [],
      })
      .returning();

    // Persist application data
    const { entityType, entityId } = await input.persistAccepted(
      tx,
      candidate,
      assessment.id,
      lineage,
    );

    // Update assessment with accepted entity reference
    await tx
      .update(originalityAssessments)
      .set({
        acceptedEntityType: entityType,
        acceptedEntityId: entityId,
      })
      .where(eq(originalityAssessments.id, assessment.id));

    return {
      value: candidate.value,
      assessmentId: assessment.id,
      lineage,
    };
  });
}

async function saveAssessment(input: {
  context: OriginalityGateInput<unknown>["context"];
  profileSet: LoadedProfileSet;
  candidate: GeneratedCandidate<unknown>;
  decision: OriginalityDecision;
  signals: OriginalitySignal[];
  entityType: string | null;
  entityId: string | null;
}): Promise<void> {
  const {
    context,
    profileSet,
    candidate,
    decision,
    signals,
    entityType,
    entityId,
  } = input;

  await db.insert(originalityAssessments).values({
    scope: context.authorization.scope,
    pipelineRunId:
      context.authorization.scope === "template"
        ? context.authorization.pipelineRunId
        : null,
    projectId: context.projectId,
    chapterId: context.chapterId ?? null,
    chapterGenerationId: context.chapterGenerationId ?? null,
    executionId: candidate.executionId,
    stage: context.stage,
    candidateHash: sha256Text(candidate.text),
    sourceProfileSetHash: profileSet.profileSetHash,
    originalityPolicyVersion: context.authorization.originalityPolicyVersion,
    decision,
    signals: signals.map((s) => ({
      detector: s.detector,
      strength: s.strength,
      riskElementIds: s.riskElementIds,
      score: s.score,
      threshold: s.threshold,
      fieldPath: s.fieldPath,
    })),
    acceptedEntityType: entityType,
    acceptedEntityId: entityId,
  });
}

async function quarantineGeneration(
  chapterGenerationId: string | undefined | null,
): Promise<void> {
  if (!chapterGenerationId) return;
  await db
    .update(chapterGenerations)
    .set({ status: "quarantined" })
    .where(eq(chapterGenerations.id, chapterGenerationId))
    .catch(() => {}); // best-effort - don't mask original error
}

function buildLineage(
  context: OriginalityGateInput<unknown>["context"],
  promptRevisions: Record<string, string>,
): OriginalityLineage {
  if (context.authorization.scope === "source-free") {
    return sourceFreeLineage({ promptRevisions });
  }

  return templateLineage({
    pipelineRunId: context.authorization.pipelineRunId,
    pipelineVersion: "template-pipeline-v2",
    compilerVersion: "template-compiler-v1",
    compilerHash: "",
    recipeCatalogHash: "",
    templateArtifactHash: context.templateArtifactHash ?? "",
    sourceProfileVersion: "source-profile-v1",
    sourceProfileSetHash: context.authorization.sourceProfileSetHash,
    originalityPolicyVersion: context.authorization.originalityPolicyVersion,
    promptRevisions,
    placeholderFunctionHash: context.placeholderFunctionHash,
  });
}
