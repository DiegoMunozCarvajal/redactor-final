import { executeVersionedPrompt } from '@/lib/prompts/executor';
import type { ReasoningEffort } from '@/lib/ai/completion';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CorrectionInput {
  projectId: string;
  chapterId: string;
  chapterGenerationId?: string;
  model: string;
  effort?: ReasoningEffort;
  revisionId?: string;
  editorialContext: string;
  chapterContent: string;
  critiqueContent: string;
  signal?: AbortSignal;
}

export interface CorrectionResult {
  text: string;
  executionId: string;
  revisionId: string;
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

export async function runCorrection(
  input: CorrectionInput,
): Promise<CorrectionResult> {
  const { result, executionId, revision } = await executeVersionedPrompt({
    stage: 'correction',
    kind: 'corrector',
    revisionId: input.revisionId,
    projectId: input.projectId,
    chapterId: input.chapterId,
    chapterGenerationId: input.chapterGenerationId,
    markerValues: {
      '{{EDITORIAL_CONTEXT}}': input.editorialContext,
      '{{CONTENIDO_CAPITULO}}': input.chapterContent,
      '{{CONTENIDO_CRITICA}}': input.critiqueContent,
    },
    model: input.model,
    effort: input.effort,
    signal: input.signal,
  });

  return {
    text: result.data as string,
    executionId,
    revisionId: revision.id,
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
