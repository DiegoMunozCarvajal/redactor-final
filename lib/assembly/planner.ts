import { executeVersionedPrompt } from '@/lib/prompts/executor';
import { assemblyPlanV1Schema, validateAssemblyPlan, type AssemblyPlanV1, type AssemblyPlanValidationContext } from './plan-schema';
import { serializeAssemblyFragments, serializeOutputSchema, type AssemblyFragmentInput } from './serialize';
import type { ReasoningEffort } from '@/lib/ai/completion';

const PLANNER_TIMEOUT_MS = 480_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlannerInput {
  projectId: string;
  model: string;
  editorialContext: string;
  fragments: AssemblyFragmentInput[];
  validationContext: AssemblyPlanValidationContext;
  revisionId?: string;
  effort?: ReasoningEffort;
  chapterId?: string;
  chapterGenerationId?: string;
  dataLineage?: Record<string, { entityIds?: string[]; versionIds?: string[]; sourceHashes?: string[] }>;
}

export interface PlannerResult {
  plan: AssemblyPlanV1;
  executionId: string;
  revisionId: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
  };
  durationMs: number;
}

interface AliasedFragments {
  fragments: AssemblyFragmentInput[];
  aliasToCanonicalId: Map<string, string>;
}

function aliasFragments(fragments: AssemblyFragmentInput[]): AliasedFragments {
  const aliasToCanonicalId = new Map<string, string>();
  const aliased = fragments.map((fragment, index) => {
    const alias = `F${index + 1}`;
    aliasToCanonicalId.set(alias, fragment.id);
    return { ...fragment, id: alias };
  });

  return { fragments: aliased, aliasToCanonicalId };
}

function canonicalizePlanFragmentIds(
  plan: AssemblyPlanV1,
  aliasToCanonicalId: Map<string, string>,
): AssemblyPlanV1 {
  const canonicalId = (alias: string): string => {
    const id = aliasToCanonicalId.get(alias);
    if (!id) throw new Error(`Unknown fragment alias "${alias}" referenced in plan`);
    return id;
  };

  return {
    ...plan,
    opening: {
      ...plan.opening,
      sourceFragmentIds: plan.opening.sourceFragmentIds.map(canonicalId),
    },
    sections: plan.sections.map((section) => ({
      ...section,
      sourceTreatments: section.sourceTreatments.map((treatment) => ({
        ...treatment,
        fragmentId: canonicalId(treatment.fragmentId),
      })),
    })),
    mustCover: plan.mustCover.map((item) => ({
      ...item,
      sourceFragmentIds: item.sourceFragmentIds.map(canonicalId),
    })),
    redundancies: plan.redundancies.map((item) => ({
      ...item,
      sourceFragmentIds: item.sourceFragmentIds.map(canonicalId),
    })),
    illustrations: plan.illustrations.map((item) => ({
      ...item,
      sourceFragmentIds: item.sourceFragmentIds.map(canonicalId),
    })),
    closing: {
      ...plan.closing,
      sourceFragmentIds: plan.closing.sourceFragmentIds.map(canonicalId),
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the assembly-planner prompt against editorial context and fragments.
 *
 * Uses `executeVersionedPrompt` to resolve, compose, log, and call the LLM.
 * Validates the returned plan semantically before returning it.
 */
export async function runAssemblyPlanner(
  input: PlannerInput,
): Promise<PlannerResult> {
  const aliasedFragments = aliasFragments(input.fragments);
  const serializedFragments = serializeAssemblyFragments(aliasedFragments.fragments);
  const outputSchema = serializeOutputSchema(assemblyPlanV1Schema);

  const { result, executionId, revision } = await executeVersionedPrompt({
    stage: 'planning',
    kind: 'assembly-planner',
    projectId: input.projectId,
    revisionId: input.revisionId,
    chapterId: input.chapterId,
    chapterGenerationId: input.chapterGenerationId,
    dataLineage: input.dataLineage,
    markerValues: {
      '{{EDITORIAL_CONTEXT}}': input.editorialContext,
      '{{SECCIONES_GENERADAS}}': serializedFragments,
      '{{OUTPUT_SCHEMA}}': outputSchema,
    },
    model: input.model,
    effort: input.effort,
    timeoutMs: PLANNER_TIMEOUT_MS,
    schema: assemblyPlanV1Schema,
    technicalPolicies: ["schema-validation", "semantic-plan-validation"],
  });

  // Validate model-facing aliases first, then restore canonical DB IDs and
  // validate again against the current generation state before persistence.
  const aliasedPlan = validateAssemblyPlan(result.data, {
    fragmentIds: aliasedFragments.fragments.map((fragment) => fragment.id),
    mustCover: input.validationContext.mustCover,
  });
  const plan = canonicalizePlanFragmentIds(
    aliasedPlan,
    aliasedFragments.aliasToCanonicalId,
  );
  validateAssemblyPlan(plan, input.validationContext);

  return {
    plan,
    executionId,
    revisionId: revision.id,
    model: input.model,
    usage: {
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      totalTokens: result.usage.totalTokens,
      costUsd: result.usage.costUsd,
      cacheCreationTokens: result.usage.cacheCreationTokens,
      cacheReadTokens: result.usage.cacheReadTokens,
    },
    durationMs: result.durationMs,
  };
}
