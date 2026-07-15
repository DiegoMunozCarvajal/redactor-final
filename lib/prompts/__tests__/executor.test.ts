import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockDb, mockGenerateCompletion, mockResolvePromptRevision, mockGetProviderForModel } = vi.hoisted(() => ({
  mockDb: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
  mockGenerateCompletion: vi.fn(),
  mockResolvePromptRevision: vi.fn(),
  mockGetProviderForModel: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: mockDb }));
vi.mock('@/lib/ai/completion', () => ({ generateCompletion: mockGenerateCompletion }));
vi.mock('@/lib/ai/providers', () => ({ getProviderForModel: mockGetProviderForModel }));
vi.mock('@/lib/prompts/repository', () => ({ resolvePromptRevision: mockResolvePromptRevision }));

import { executeVersionedPrompt } from '@/lib/prompts/executor';

const revision = {
  id: 'rev-1',
  definitionId: 'def-1',
  kind: 'assembly' as const,
  name: 'Assembly v1.3',
  revisionNumber: 1,
  versionLabel: '1.3',
  systemTemplate: 'SYS\n{{EDITORIAL_CONTEXT}}',
  userTemplate: 'USER\n{{ASSEMBLY_PLAN}} {{SECCIONES_GENERADAS}}',
  requiredMarkers: ['{{EDITORIAL_CONTEXT}}', '{{ASSEMBLY_PLAN}}', '{{SECCIONES_GENERADAS}}'],
  outputContract: null,
  configuration: {},
};

const markerValues = {
  '{{EDITORIAL_CONTEXT}}': '<brief />',
  '{{ASSEMBLY_PLAN}}': '{"version":"1"}',
  '{{SECCIONES_GENERADAS}}': '<fragments />',
};

function makeChain(resolvedValue: unknown[] = []) {
  const select = vi.fn(() => chain);
  const from = vi.fn(() => chain);
  const innerJoin = vi.fn(() => chain);
  const where = vi.fn(() => Promise.resolve(resolvedValue));
  const limit = vi.fn(() => Promise.resolve(resolvedValue));
  const set = vi.fn(() => chain);
  const chain = { select, from, innerJoin, where, limit, set };
  return chain;
}

const insertedExecution = {
  id: 'exec-1',
  projectId: null,
  bookTemplateId: null,
  chapterId: null,
  chapterGenerationId: null,
  stage: 'assembly',
  promptRevisionId: 'rev-1',
  model: 'deepseek-v4-pro',
  provider: 'deepseek',
  messages: [],
  dataManifest: {},
  outputContract: null,
  technicalPolicies: [],
  providerPayloadManifest: {},
  status: 'started',
  usage: null,
  error: null,
  createdAt: new Date(),
  completedAt: null,
  chapterPromptRevisionId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockResolvePromptRevision.mockResolvedValue(revision);
  mockGetProviderForModel.mockReturnValue('deepseek');
});

describe('executeVersionedPrompt', () => {
  it('composes prompt from revision and stores execution', async () => {
    const insertChain = {
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([insertedExecution])),
      })),
    };
    mockDb.insert.mockReturnValue(insertChain);
    mockDb.update.mockReturnValue(makeChain());
    mockGenerateCompletion.mockResolvedValue({
      data: 'chapter text',
      usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300, costUsd: 0.01, cacheCreationTokens: 0, cacheReadTokens: 0 },
      durationMs: 1000,
    });

    const result = await executeVersionedPrompt({
      stage: 'assembly',
      kind: 'assembly',
      markerValues,
      model: 'deepseek-v4-pro',
    });

    expect(result.executionId).toBe('exec-1');
    expect(result.revision.id).toBe('rev-1');
    expect(result.result.data).toBe('chapter text');

    // Verify messages were composed correctly
    const valuesArg = (insertChain.values.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(valuesArg.messages).toEqual([
      { role: 'system', content: 'SYS\n<brief />' },
      { role: 'user', content: 'USER\n{"version":"1"} <fragments />' },
    ]);
  });

  it('updates execution to completed on success', async () => {
    const insertChain = {
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([insertedExecution])),
      })),
    };
    mockDb.insert.mockReturnValue(insertChain);
    const updateChain = makeChain();
    mockDb.update.mockReturnValue(updateChain);
    mockGenerateCompletion.mockResolvedValue({
      data: 'ok',
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, costUsd: 0.001, cacheCreationTokens: 0, cacheReadTokens: 0 },
      durationMs: 500,
    });

    await executeVersionedPrompt({
      stage: 'assembly',
      kind: 'assembly',
      markerValues,
      model: 'deepseek-v4-pro',
    });

    // Verify update was called with completed status
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('forwards a custom timeout to generateCompletion', async () => {
    const insertChain = {
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([insertedExecution])),
      })),
    };
    mockDb.insert.mockReturnValue(insertChain);
    mockDb.update.mockReturnValue(makeChain());
    mockGenerateCompletion.mockResolvedValue({
      data: 'ok',
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, costUsd: 0.001, cacheCreationTokens: 0, cacheReadTokens: 0 },
      durationMs: 500,
    });

    await executeVersionedPrompt({
      stage: 'planning',
      kind: 'assembly-planner',
      markerValues,
      model: 'deepseek-v4-pro',
      timeoutMs: 480_000,
    });

    expect(mockGenerateCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 480_000 }),
    );
  });

  it('updates execution to failed on error', async () => {
    const insertChain = {
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([insertedExecution])),
      })),
    };
    mockDb.insert.mockReturnValue(insertChain);
    const updateChain = makeChain();
    mockDb.update.mockReturnValue(updateChain);
    mockGenerateCompletion.mockRejectedValue(new Error('API error'));

    await expect(
      executeVersionedPrompt({
        stage: 'assembly',
        kind: 'assembly',
        markerValues,
        model: 'deepseek-v4-pro',
      }),
    ).rejects.toThrow('API error');

    // Verify the error is re-thrown
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('records provider payload manifest with cacheMode none', async () => {
    const insertChain = {
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([insertedExecution])),
      })),
    };
    mockDb.insert.mockReturnValue(insertChain);
    mockDb.update.mockReturnValue(makeChain());
    mockGenerateCompletion.mockResolvedValue({
      data: 'chapter text',
      usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300, costUsd: 0.01, cacheCreationTokens: 0, cacheReadTokens: 0 },
      durationMs: 1000,
    });

    await executeVersionedPrompt({
      stage: 'assembly',
      kind: 'assembly',
      markerValues,
      model: 'deepseek-v4-pro',
    });

    const valuesArg = (insertChain.values.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(valuesArg.providerPayloadManifest).toEqual({
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      cacheMode: 'none',
    });
  });

  it('rejects unknown data lineage markers', async () => {
    const insertChain = {
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([insertedExecution])),
      })),
    };
    mockDb.insert.mockReturnValue(insertChain);
    mockDb.update.mockReturnValue(makeChain());
    mockGenerateCompletion.mockResolvedValue({
      data: 'ok',
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, costUsd: 0.001, cacheCreationTokens: 0, cacheReadTokens: 0 },
      durationMs: 500,
    });

    await expect(
      executeVersionedPrompt({
        stage: 'assembly',
        kind: 'assembly',
        markerValues,
        model: 'deepseek-v4-pro',
        dataLineage: {
          '{{UNKNOWN_MARKER}}': { entityIds: ['e1'] },
        },
      }),
    ).rejects.toThrow('Unknown marker in dataLineage');
  });
});
