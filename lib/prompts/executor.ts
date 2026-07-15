import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { generateCompletion, type ReasoningEffort } from '@/lib/ai/completion';
import { getProviderForModel } from '@/lib/ai/providers';
import { resolvePromptRevision, type ResolvedPromptRevision } from './repository';
import { composePrompt } from './composer';
import { llmPromptExecutions } from '@/lib/db/schema/prompt-registry';
import type { PromptKind } from '@/lib/db/schema/prompt-registry';
import { sanitizeError } from '@/lib/sanitize-error';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecuteVersionedPromptInput<T extends z.ZodTypeAny | undefined = undefined> {
  stage: string;
  kind: PromptKind;
  revisionId?: string;
  projectId?: string;
  bookTemplateId?: string;
  chapterId?: string;
  chapterGenerationId?: string;
  markerValues: Record<string, string>;
  dataLineage?: Record<
    string,
    { entityIds?: string[]; versionIds?: string[]; sourceHashes?: string[] }
  >;
  model: string;
  schema?: T;
  temperature?: number;
  maxTokens?: number;
  effort?: ReasoningEffort;
  technicalPolicies?: string[];
  signal?: AbortSignal;
  /** Per-call timeout in ms. Passed through to generateCompletion. */
  timeoutMs?: number;
}

type CompletionResult<T> = {
  data: T;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
  };
  durationMs: number;
  logId?: string;
};

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function executeVersionedPrompt(
  input: ExecuteVersionedPromptInput<undefined>,
): Promise<{ result: CompletionResult<string>; executionId: string; revision: ResolvedPromptRevision }>;
export async function executeVersionedPrompt<T extends z.ZodTypeAny>(
  input: ExecuteVersionedPromptInput<T>,
): Promise<{ result: CompletionResult<z.infer<T>>; executionId: string; revision: ResolvedPromptRevision }>;
export async function executeVersionedPrompt(
  input: ExecuteVersionedPromptInput,
): Promise<{ result: CompletionResult<unknown>; executionId: string; revision: ResolvedPromptRevision }> {
  // 1. Resolve the prompt revision
  const revision = await resolvePromptRevision({
    kind: input.kind,
    runRevisionId: input.revisionId,
    projectId: input.projectId,
  });

  // 2. Compose the prompt
  const composed = composePrompt(
    {
      systemTemplate: revision.systemTemplate,
      userTemplate: revision.userTemplate,
      requiredMarkers: revision.requiredMarkers,
    },
    input.markerValues,
  );

  // 3. Merge data lineage
  const dataManifest = buildDataManifest(composed.dataManifest, input.dataLineage);

  // 4. Compute provider and payload manifest
  const provider = getProviderForModel(input.model);
  const providerPayloadManifest: Record<string, unknown> = {
    provider,
    model: input.model,
    cacheMode: 'none',
  };
  if (input.schema) {
    providerPayloadManifest.structuredOutput = true;
  }

  // 5. Insert execution with status "started"
  const messages: Array<{ role: 'system' | 'user'; content: string }> = [
    { role: 'system' as const, content: composed.systemMessage },
    { role: 'user' as const, content: composed.userMessage },
  ];

  const [execution] = await db
    .insert(llmPromptExecutions)
    .values({
      projectId: input.projectId ?? null,
      bookTemplateId: input.bookTemplateId ?? null,
      chapterId: input.chapterId ?? null,
      chapterGenerationId: input.chapterGenerationId ?? null,
      stage: input.stage,
      promptRevisionId: revision.id,
      model: input.model,
      provider,
      messages: messages as unknown[],
      dataManifest,
      outputContract: revision.outputContract,
      technicalPolicies: (input.technicalPolicies ?? []) as unknown as string[],
      providerPayloadManifest,
      status: 'started' as const,
    })
    .returning();

  // 6. Call the LLM (branch on schema to satisfy overloaded signatures)
  try {
    const result: CompletionResult<unknown> = input.schema
      ? await generateCompletion({
          systemPrompt: composed.systemMessage,
          userPrompt: composed.userMessage,
          schema: input.schema,
          model: input.model,
          temperature: input.temperature,
          maxTokens: input.maxTokens,
          effort: input.effort,
          signal: input.signal,
          timeoutMs: input.timeoutMs,
        })
      : await generateCompletion({
          systemPrompt: composed.systemMessage,
          userPrompt: composed.userMessage,
          model: input.model,
          temperature: input.temperature,
          maxTokens: input.maxTokens,
          effort: input.effort,
          signal: input.signal,
          timeoutMs: input.timeoutMs,
        });

    // 7. Update execution to completed
    await db
      .update(llmPromptExecutions)
      .set({
        status: 'completed',
        usage: result.usage as unknown as Record<string, unknown>,
        completedAt: new Date(),
      })
      .where(eq(llmPromptExecutions.id, execution.id));

    return {
      result,
      executionId: execution.id,
      revision,
    };
  } catch (error) {
    // 8. Update execution to failed and re-throw
    const sanitized = error instanceof Error ? sanitizeError(error) : 'Unknown error';
    await db
      .update(llmPromptExecutions)
      .set({
        status: 'failed',
        error: sanitized,
        completedAt: new Date(),
      })
      .where(eq(llmPromptExecutions.id, execution.id));

    throw error;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDataManifest(
  composerManifest: Record<string, { sha256: string; chars: number }>,
  lineage?: Record<
    string,
    { entityIds?: string[]; versionIds?: string[]; sourceHashes?: string[] }
  >,
): Record<string, unknown> {
  const manifest: Record<string, unknown> = {};

  for (const [marker, entry] of Object.entries(composerManifest)) {
    const combined: Record<string, unknown> = { sha256: entry.sha256, chars: entry.chars };

    if (lineage?.[marker]) {
      const caller = lineage[marker];
      if (caller.entityIds?.length) combined.entityIds = caller.entityIds;
      if (caller.versionIds?.length) combined.versionIds = caller.versionIds;
      if (caller.sourceHashes?.length) combined.sourceHashes = caller.sourceHashes;
    }

    manifest[marker] = combined;
  }

  // Reject unknown lineage keys
  if (lineage) {
    for (const marker of Object.keys(lineage)) {
      if (!manifest[marker]) {
        throw new Error(`Unknown marker in dataLineage: ${marker}`);
      }
    }
  }

  return manifest;
}
