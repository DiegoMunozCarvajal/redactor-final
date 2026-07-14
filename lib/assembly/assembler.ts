import { executeVersionedPrompt } from '@/lib/prompts/executor';
import { serializeAssemblyFragments, serializeAssemblyPlan, type AssemblyFragmentInput } from './serialize';
import type { AssemblyPlanV1 } from './plan-schema';
import type { ReasoningEffort } from '@/lib/ai/completion';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AssemblerInput {
  projectId: string;
  model: string;
  editorialContext: string;
  plan: AssemblyPlanV1;
  fragments: AssemblyFragmentInput[];
  revisionId?: string;
  effort?: ReasoningEffort;
}

export interface AssemblerResult {
  chapterText: string;
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
 * Run the assembly prompt against editorial context, plan, and fragments.
 *
 * Uses `executeVersionedPrompt` to resolve, compose, log, and call the LLM.
 * Returns the assembled chapter prose as-is (no trimming).
 */
export async function runAssemblyAssembler(
  input: AssemblerInput,
): Promise<AssemblerResult> {
  const serializedFragments = serializeAssemblyFragments(input.fragments);
  const serializedPlan = serializeAssemblyPlan(input.plan);

  const { result, executionId } = await executeVersionedPrompt({
    stage: 'assembling',
    kind: 'assembly',
    projectId: input.projectId,
    revisionId: input.revisionId,
    markerValues: {
      '{{EDITORIAL_CONTEXT}}': input.editorialContext,
      '{{ASSEMBLY_PLAN}}': serializedPlan,
      '{{SECCIONES_GENERADAS}}': serializedFragments,
    },
    model: input.model,
    effort: input.effort,
  });

  const chapterText = (typeof result.data === 'string' ? result.data.trim() : '').trim();
  if (!chapterText) {
    throw new Error('Assembly produced empty output — the assembly prompt may need revision.');
  }

  return {
    chapterText,
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
