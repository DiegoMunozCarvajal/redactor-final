import { db } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { promptVersions, type ChapterPromptSnapshot } from '@/lib/db/schema/prompt-versions';
import { llmPromptExecutions } from '@/lib/db/schema/prompt-registry';
import { generateCompletion, type ReasoningEffort } from '@/lib/ai/completion';
import { getProviderForModel } from '@/lib/ai/providers';
import { resolvePromptRevision } from './repository';
import { sanitizeError } from '@/lib/sanitize-error';
import { applyPlaceholders, stripPlaceholderWrappers } from './placeholder-transform';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecuteChapterPromptInput {
  projectId: string;
  chapterId: string;
  chapterGenerationId: string;
  chapterPromptRevisionId: string;
  editorialContext: string | null;
  editorialLineage?: {
    entityIds?: string[];
    versionIds?: string[];
    sourceHashes?: string[];
  };
  placeholders: Record<string, string>;
  projectTopic: string | null;
  model: string;
  effort?: ReasoningEffort;
  signal?: AbortSignal;
}

export interface ExecuteChapterPromptResult {
  text: string;
  executionId: string;
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
// Main function
// ---------------------------------------------------------------------------

export async function executeChapterPrompt(
  input: ExecuteChapterPromptInput,
): Promise<ExecuteChapterPromptResult> {
  const {
    projectId,
    chapterId,
    chapterGenerationId,
    chapterPromptRevisionId,
    editorialContext,
    editorialLineage,
    placeholders,
    projectTopic,
    model,
    effort,
    signal,
  } = input;

  // 1. Load the chapter prompt's immutable snapshot from prompt_versions
  const [version] = await db
    .select()
    .from(promptVersions)
    .where(eq(promptVersions.id, chapterPromptRevisionId))
    .limit(1);

  if (!version) {
    throw new Error(
      `Chapter prompt version ${chapterPromptRevisionId} not found for chapter ${chapterId}`,
    );
  }

  const localContent = version.content;
  const localUserPrompt = version.userPrompt;

  // 2. Resolve the generation-system prompt revision
  const generationSystemRevision = await resolvePromptRevision({
    kind: 'generation-system',
    projectId,
  });

  // 3. Build effective system + user messages
  //    - If local prompt HAS userPrompt: local content = system, local userPrompt = user
  //    - Otherwise: generation-system revision = system, local content = user
  let systemMessage: string;
  let userMessage: string;

  if (localUserPrompt) {
    systemMessage = localContent;
    userMessage = localUserPrompt;
  } else {
    systemMessage = generationSystemRevision.systemTemplate;
    userMessage = localContent;
  }

  // 4. Apply runtime markers ({{EDITORIAL_CONTEXT}}) — replaces BEFORE dynamic placeholders.
  //    Fail-closed: if the generation-system template lacks the marker, the prompt revision
  //    is incorrectly configured. Log a warning so operators can fix the revision.
  const editorialMarker = '{{EDITORIAL_CONTEXT}}';
  const resolvedEditorialContext = editorialContext ?? '';

  const hasMarker = systemMessage.includes(editorialMarker) || userMessage.includes(editorialMarker);
  if (!hasMarker && editorialContext) {
    throw new Error(
      `[chapter-executor] Editorial context provided but neither system nor user message contains {{EDITORIAL_CONTEXT}} marker. The generation-system revision (${generationSystemRevision.id}) is missing the marker — update the revision to include {{EDITORIAL_CONTEXT}}.`,
    );
  }

  if (systemMessage.includes(editorialMarker)) {
    systemMessage = systemMessage.split(editorialMarker).join(resolvedEditorialContext);
  }
  if (userMessage.includes(editorialMarker)) {
    userMessage = userMessage.split(editorialMarker).join(resolvedEditorialContext);
  }

  // 5. Apply dynamic placeholders ({tema}, {placeholderName}) — AFTER runtime markers.
  userMessage = applyPlaceholders(userMessage, placeholders, projectTopic);
  systemMessage = applyPlaceholders(systemMessage, placeholders, projectTopic);

  // 6. Build provider metadata
  const provider = getProviderForModel(model);

  // 7. Build data manifest with lineage
  const dataManifest: Record<string, unknown> = {};

  // Chapter prompt revision (prompt_versions.id)
  dataManifest['chapter-prompt'] = {
    entityIds: [chapterPromptRevisionId],
  };

  // Generation system revision (prompt_revisions.id)
  dataManifest['generation-system'] = {
    entityIds: [generationSystemRevision.id],
  };

  // Editorial context lineage
  if (editorialLineage) {
    dataManifest['editorial-context'] = {
      ...(editorialLineage.entityIds?.length ? { entityIds: editorialLineage.entityIds } : {}),
      ...(editorialLineage.versionIds?.length ? { versionIds: editorialLineage.versionIds } : {}),
      ...(editorialLineage.sourceHashes?.length ? { sourceHashes: editorialLineage.sourceHashes } : {}),
    };
  }

  // 8. Insert llm_prompt_executions row
  const messages: Array<{ role: 'system' | 'user'; content: string }> = [
    { role: 'system' as const, content: systemMessage },
    { role: 'user' as const, content: userMessage },
  ];

  const [execution] = await db
    .insert(llmPromptExecutions)
    .values({
      projectId,
      chapterId,
      chapterGenerationId,
      stage: 'fragment',
      promptRevisionId: generationSystemRevision.id,
      chapterPromptRevisionId,
      model,
      provider,
      messages: messages as unknown[],
      dataManifest,
      technicalPolicies: [],
      providerPayloadManifest: { provider, model },
      status: 'started' as const,
    })
    .returning();

  // 9. Call generateCompletion directly (NOT executeVersionedPrompt) since we
  //    already resolved versions and composed messages ourselves.
  try {
    const startTime = performance.now();

    const result = await generateCompletion({
      systemPrompt: systemMessage,
      userPrompt: userMessage,
      model,
      ...(effort !== undefined ? { effort } : {}),
      ...(signal !== undefined ? { signal } : {}),
    });

    const durationMs = Math.round(performance.now() - startTime);

    // 10. Update execution to completed
    await db
      .update(llmPromptExecutions)
      .set({
        status: 'completed' as const,
        usage: result.usage as unknown as Record<string, unknown>,
        completedAt: new Date(),
      })
      .where(eq(llmPromptExecutions.id, execution.id));

    // Strip placeholder wrappers from generated text
    const text = stripPlaceholderWrappers(result.data as string);

    return {
      text,
      executionId: execution.id,
      usage: {
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
        costUsd: result.usage.costUsd,
        cacheCreationTokens: result.usage.cacheCreationTokens,
        cacheReadTokens: result.usage.cacheReadTokens,
      },
      durationMs,
    };
  } catch (error) {
    // 11. Update execution to failed and re-throw
    const sanitized = error instanceof Error ? sanitizeError(error) : 'Unknown error';
    await db
      .update(llmPromptExecutions)
      .set({
        status: 'failed' as const,
        error: sanitized,
        completedAt: new Date(),
      })
      .where(eq(llmPromptExecutions.id, execution.id));

    throw error;
  }
}
