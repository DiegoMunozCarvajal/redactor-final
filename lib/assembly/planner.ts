import { executeVersionedPrompt } from '@/lib/prompts/executor';
import { assemblyPlanV1Schema, validateAssemblyPlan, type AssemblyPlanV1, type AssemblyPlanValidationContext } from './plan-schema';
import { serializeAssemblyFragments, serializeOutputSchema, type AssemblyFragmentInput } from './serialize';
import type { ReasoningEffort } from '@/lib/ai/completion';

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
}

export interface PlannerResult {
  plan: AssemblyPlanV1;
  executionId: string;
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
  const serializedFragments = serializeAssemblyFragments(input.fragments);
  const outputSchema = serializeOutputSchema(assemblyPlanV1Schema);

  const { result, executionId } = await executeVersionedPrompt({
    stage: 'planning',
    kind: 'assembly-planner',
    projectId: input.projectId,
    revisionId: input.revisionId,
    markerValues: {
      '{{EDITORIAL_CONTEXT}}': input.editorialContext,
      '{{SECCIONES_GENERADAS}}': serializedFragments,
      '{{OUTPUT_SCHEMA}}': outputSchema,
    },
    model: input.model,
    effort: input.effort,
    schema: assemblyPlanV1Schema,
  });

  // Semantic validation — structural validation already done by Zod
  const plan = validateAssemblyPlan(result.data, input.validationContext);

  return {
    plan,
    executionId,
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
