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
  chapterId?: string;
  chapterGenerationId?: string;
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
// Originality guard
// ---------------------------------------------------------------------------

const MIN_ORIGINALITY_RATIO = 0.6; // output must be ≤60% similar to any single fragment

/**
 * Reject output that is too similar to any single fragment.
 * Catches LLM failures where the "assembler" just echoes the longest fragment
 * instead of synthesizing across all inputs.
 */
function assertOriginalEnough(
  chapterText: string,
  fragments: AssemblyFragmentInput[],
  stage: string,
): void {
  if (fragments.length <= 1) return; // single fragment → assembly is that fragment

  const normalizedOutput = chapterText.toLowerCase().replace(/\s+/g, ' ');
  let maxOverlap = 0;

  for (const frag of fragments) {
    const normalizedFrag = frag.content.toLowerCase().replace(/\s+/g, ' ');
    const overlap = longestCommonSubsequenceRatio(normalizedOutput, normalizedFrag);
    if (overlap > maxOverlap) maxOverlap = overlap;
  }

  if (maxOverlap > MIN_ORIGINALITY_RATIO) {
    throw new Error(
      `[${stage}] Output too similar to a single fragment (${(maxOverlap * 100).toFixed(0)}% overlap, max ${(MIN_ORIGINALITY_RATIO * 100).toFixed(0)}%). The assembly prompt may be ignoring other fragments.`,
    );
  }
}

/** Ratio of longest common subsequence length to the shorter string's length. */
function longestCommonSubsequenceRatio(a: string, b: string): number {
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  if (shorter.length === 0) return 0;

  // Use the shorter string as reference for a meaningful ratio
  let prev = new Array(shorter.length + 1).fill(0);
  for (let i = 1; i <= longer.length; i++) {
    const curr = new Array(shorter.length + 1).fill(0);
    for (let j = 1; j <= shorter.length; j++) {
      if (longer[i - 1] === shorter[j - 1]) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1]);
      }
    }
    prev = curr;
  }
  return prev[shorter.length] / shorter.length;
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
    chapterId: input.chapterId,
    chapterGenerationId: input.chapterGenerationId,
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

  assertOriginalEnough(chapterText, input.fragments, 'assembly');

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
