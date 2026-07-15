import { executeVersionedPrompt } from '@/lib/prompts/executor';
import { serializeAssemblyFragments, serializeAssemblyPlan, type AssemblyFragmentInput } from './serialize';
import type { AssemblyPlanV1 } from './plan-schema';
import type { ReasoningEffort } from '@/lib/ai/completion';
import { assertOriginalEnough } from '@/lib/ai/originality-check';

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
  dataLineage?: Record<string, { entityIds?: string[]; versionIds?: string[]; sourceHashes?: string[] }>;
}

export interface AssemblerResult {
  chapterText: string;
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

// ---------------------------------------------------------------------------
// Assembly quality guard
// ---------------------------------------------------------------------------

const MAX_FRAGMENT_OVERLAP = 0.85; // output ≤85% word overlap with any single fragment

/**
 * Reject output that is too similar to any single fragment.
 * Uses word-level Jaccard (bounded O(n) per fragment via Set operations)
 * instead of character-level LCS to avoid O(n*m) scaling on full chapters.
 */
function assertNotSingleFragmentEcho(
  chapterText: string,
  fragments: AssemblyFragmentInput[],
): void {
  if (fragments.length <= 1) return;

  const outputWords = new Set(chapterText.toLowerCase().replace(/[^\w\sáéíóúüñ]/g, ' ').split(/\s+/).filter(w => w.length > 1));
  if (outputWords.size === 0) return;

  let maxOverlap = 0;
  for (const frag of fragments) {
    const fragWords = new Set(frag.content.toLowerCase().replace(/[^\w\sáéíóúüñ]/g, ' ').split(/\s+/).filter(w => w.length > 1));
    if (fragWords.size === 0) continue;

    let intersection = 0;
    for (const w of outputWords) {
      if (fragWords.has(w)) intersection++;
    }
    const overlap = intersection / outputWords.size;
    if (overlap > maxOverlap) maxOverlap = overlap;
  }

  if (maxOverlap > MAX_FRAGMENT_OVERLAP) {
    throw new Error(
      `Assembly output too similar to a single fragment (${(maxOverlap * 100).toFixed(0)}% word overlap, max ${(MAX_FRAGMENT_OVERLAP * 100).toFixed(0)}%). The assembly prompt may be ignoring other fragments.`,
    );
  }
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

  const { result, executionId, revision } = await executeVersionedPrompt({
    stage: 'assembling',
    kind: 'assembly',
    projectId: input.projectId,
    revisionId: input.revisionId,
    chapterId: input.chapterId,
    chapterGenerationId: input.chapterGenerationId,
    dataLineage: input.dataLineage,
    markerValues: {
      '{{EDITORIAL_CONTEXT}}': input.editorialContext,
      '{{ASSEMBLY_PLAN}}': serializedPlan,
      '{{SECCIONES_GENERADAS}}': serializedFragments,
    },
    model: input.model,
    effort: input.effort,
    technicalPolicies: ["originality-check", "echo-guard"],
  });

  // Post-generation guards (recorded as technicalPolicies above)

  const chapterText = (typeof result.data === 'string' ? result.data.trim() : '').trim();
  if (!chapterText) {
    throw new Error('Assembly produced empty output — the assembly prompt may need revision.');
  }

  // Copyright contamination guard (blocklist + shingle against protected corpus)
  assertOriginalEnough(chapterText, { stage: 'assembly' });
  // Assembly quality guard (output must not be a single-fragment echo)
  assertNotSingleFragmentEcho(chapterText, input.fragments);

  return {
    chapterText,
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
