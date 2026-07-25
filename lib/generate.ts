import type { ReasoningEffort } from "@/lib/ai/completion";
import { DEFAULT_GENERATION_MODEL, getProviderForModel } from "@/lib/ai/providers";
import { executeChapterPrompt } from "@/lib/prompts/chapter-executor";
import {
  sanitizeValue,
  applyPlaceholders,
  stripPlaceholderWrappers,
  escapeXmlText,
  escapeXmlAttr,
} from "@/lib/prompts/placeholder-transform";
import type { ZodType } from "zod";

// Re-export placeholder utilities for backward compatibility
export { sanitizeValue, applyPlaceholders, stripPlaceholderWrappers, escapeXmlText, escapeXmlAttr };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PromptLike {
  content: string;
  userPrompt?: string | null;
}

export interface GeneratePromptParams {
  prompt: PromptLike;
  placeholders: Record<string, string>;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  effort?: ReasoningEffort;
  projectTopic?: string | null;
  projectId?: string;
  editorialContext?: string | null;
  schema?: ZodType;
  signal?: AbortSignal;
  chapterId?: string;
  chapterGenerationId?: string;
  chapterPromptRevisionId?: string;
}

export interface GenerateResult {
  text: string;
  model: string;
  provider: string;
  durationMs?: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    costUsd?: number;
    cacheCreationTokens?: number;
    cacheReadTokens?: number;
  };
  executionId?: string;
  promptRevisions?: Record<string, string>;
}

/** Assembly algorithm type — kept for backward compat in the assemble route. */
export type AssemblyAlgorithm = "merge-sort" | "sequential" | "halves";

// ---------------------------------------------------------------------------
// Fragment content generation
// ---------------------------------------------------------------------------

export async function generatePromptContent(
  params: GeneratePromptParams,
): Promise<GenerateResult> {
  const {
    prompt: _prompt,
    placeholders,
    model = DEFAULT_GENERATION_MODEL,
    projectTopic,
    projectId,
    editorialContext,
    signal,
    chapterId,
    chapterGenerationId,
    chapterPromptRevisionId,
    effort,
  } = params;

  if (chapterPromptRevisionId && chapterId && chapterGenerationId && projectId) {
    const result = await executeChapterPrompt({
      projectId,
      chapterId,
      chapterGenerationId,
      chapterPromptRevisionId,
      editorialContext: editorialContext ?? null,
      placeholders,
      projectTopic: projectTopic ?? null,
      model,
      ...(effort !== undefined ? { effort } : {}),
      ...(signal !== undefined ? { signal } : {}),
    });

    return {
      text: result.text,
      model,
      provider: getProviderForModel(model),
      durationMs: result.durationMs,
      usage: {
        inputTokens: result.usage.promptTokens,
        outputTokens: result.usage.completionTokens,
        costUsd: result.usage.costUsd,
        cacheCreationTokens: result.usage.cacheCreationTokens,
        cacheReadTokens: result.usage.cacheReadTokens,
      },
      executionId: result.executionId,
      promptRevisions: result.promptRevisions,
    };
  }

  throw new Error(
    "generatePromptContent: chapterPromptRevisionId, chapterId, " +
    "chapterGenerationId, and projectId are required. " +
    "All callers must pass currentRevisionId from the prompt row.",
  );
}
