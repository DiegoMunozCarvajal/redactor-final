import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { PromptKind } from '@/lib/db/schema/prompt-registry';

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    select: vi.fn(),
    insert: vi.fn(),
    transaction: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({
  db: mockDb,
}));

import { resolvePromptRevision, createPromptRevision } from '@/lib/prompts/repository';

function makeChain(resolvedValue: unknown[] = []) {
  const select = vi.fn(() => chain);
  const from = vi.fn(() => chain);
  const innerJoin = vi.fn(() => chain);
  const where = vi.fn(() => chain);
  const orderBy = vi.fn(() => chain);
  const limit = vi.fn(() => Promise.resolve(resolvedValue));
  const forUpdate = vi.fn(() => Promise.resolve(resolvedValue));
  const chain = { select, from, innerJoin, where, orderBy, limit, for: forUpdate };
  return chain;
}

function revRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rev-1',
    promptDefinitionId: 'def-1',
    revisionNumber: 1,
    versionLabel: '1.0',
    systemTemplate: 'SYS {{TEST}}',
    userTemplate: 'USER {{TEST}}',
    requiredMarkers: ['{{TEST}}'],
    outputContract: null,
    configuration: {},
    kind: 'assembly',
    name: 'Test Assembly',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// resolvePromptRevision
// ---------------------------------------------------------------------------

describe('resolvePromptRevision', () => {
  it('resolves with runRevisionId override', async () => {
    const chain = makeChain([revRow({ id: 'run-rev', kind: 'assembly' })]);
    mockDb.select.mockReturnValue(chain);

    const result = await resolvePromptRevision(
      { kind: 'assembly' as PromptKind, runRevisionId: 'run-rev' },
    );

    expect(result.id).toBe('run-rev');
    expect(result.kind).toBe('assembly');
  });

  it('resolves with project binding fallback', async () => {
    const chain = makeChain([revRow({ id: 'proj-rev' })]);
    mockDb.select.mockReturnValue(chain);

    const result = await resolvePromptRevision(
      { kind: 'assembly' as PromptKind, projectId: 'proj-1' },
    );

    expect(result.id).toBe('proj-rev');
    expect(result.kind).toBe('assembly');
  });

  it('resolves with global default fallback', async () => {
    const chain = makeChain([revRow({ id: 'default-rev' })]);
    mockDb.select.mockReturnValue(chain);

    const result = await resolvePromptRevision(
      { kind: 'assembly' as PromptKind },
    );

    expect(result.id).toBe('default-rev');
    expect(result.kind).toBe('assembly');
  });

  it('rejects a run revision whose definition kind differs from requested kind', async () => {
    const chain = makeChain([revRow({ id: 'run-rev', kind: 'critique' })]);
    mockDb.select.mockReturnValue(chain);

    await expect(
      resolvePromptRevision(
        { kind: 'assembly' as PromptKind, runRevisionId: 'run-rev' },
      ),
    ).rejects.toThrow('Prompt kind mismatch: requested assembly, found critique');
  });

  it('rejects a legacy non-executable revision', async () => {
    const chain = makeChain([
      revRow({
        id: 'legacy-rev',
        kind: 'assembly',
        configuration: { legacyNonExecutable: true },
      }),
    ]);
    mockDb.select.mockReturnValue(chain);

    await expect(
      resolvePromptRevision(
        { kind: 'assembly' as PromptKind, runRevisionId: 'legacy-rev' },
      ),
    ).rejects.toThrow('is non-executable (legacy)');
  });

  it('throws when no revision is found', async () => {
    const chain = makeChain([]);
    mockDb.select.mockReturnValue(chain);

    await expect(
      resolvePromptRevision({ kind: 'assembly' as PromptKind }),
    ).rejects.toThrow('No prompt revision found for kind assembly');
  });
});

// ---------------------------------------------------------------------------
// createPromptRevision
// ---------------------------------------------------------------------------

describe('createPromptRevision', () => {
  it('allocates next revision number under transaction', async () => {
    const defResult = { id: 'def-1', kind: 'assembly', name: 'Test' };
    const defChain = makeChain([defResult]);
    defChain.for = vi.fn(() => Promise.resolve([defResult]));

    const maxChain = makeChain([{ maxRevision: 2 }]);

    let selectCallCount = 0;
    const txSelect = vi.fn(() => {
      selectCallCount++;
      return selectCallCount === 1 ? defChain : maxChain;
    });

    const insertedRev = {
      id: 'new-rev',
      promptDefinitionId: 'def-1',
      revisionNumber: 3,
      versionLabel: '1.4',
      systemTemplate: '{{EDITORIAL_CONTEXT}}',
      userTemplate: '{{ASSEMBLY_PLAN}} {{SECCIONES_GENERADAS}}',
      requiredMarkers: ['{{EDITORIAL_CONTEXT}}', '{{ASSEMBLY_PLAN}}', '{{SECCIONES_GENERADAS}}'],
      outputContract: null,
      configuration: {},
      createdBy: 'user-1',
      createdAt: new Date(),
    };

    const tx = {
      select: txSelect,
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve([insertedRev])),
        })),
      })),
    };

    mockDb.transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
    );

    const result = await createPromptRevision(
      'def-1',
      {
        versionLabel: '1.4',
        systemTemplate: '{{EDITORIAL_CONTEXT}}',
        userTemplate: '{{ASSEMBLY_PLAN}} {{SECCIONES_GENERADAS}}',
        configuration: {},
      },
      'user-1',
    );

    expect(result.revisionNumber).toBe(3);
    expect(result.revisionNumber).toBe(3);
    expect(result.versionLabel).toBe('1.4');
    expect(result.definitionId).toBe('def-1');
    expect(result.kind).toBe('assembly');
  });

  it('throws for invalid input', async () => {
    await expect(
      createPromptRevision('def-1', { versionLabel: '', systemTemplate: '', userTemplate: '' }, 'user-1'),
    ).rejects.toThrow('Invalid prompt revision input');
  });

  it('throws when definition is not found', async () => {
    const defChain = makeChain([]);
    defChain.for = vi.fn(() => Promise.resolve([]));

    const tx = {
      select: vi.fn(() => defChain),
      insert: vi.fn(),
    };

    mockDb.transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
    );

    await expect(
      createPromptRevision(
        'def-missing',
        {
          versionLabel: '1.0',
          systemTemplate: '{{EDITORIAL_CONTEXT}}',
          userTemplate: '{{ASSEMBLY_PLAN}} {{SECCIONES_GENERADAS}}',
          configuration: {},
        },
        'user-1',
      ),
    ).rejects.toThrow('Prompt definition def-missing not found');
  });

  it('validates required markers and throws when they are missing', async () => {
    const defResult = { id: 'def-1', kind: 'assembly', name: 'Test' };
    const defChain = makeChain([defResult]);
    defChain.for = vi.fn(() => Promise.resolve([defResult]));

    const maxChain = makeChain([{ maxRevision: 1 }]);

    let selectCallCount = 0;
    const txSelect = vi.fn(() => {
      selectCallCount++;
      return selectCallCount === 1 ? defChain : maxChain;
    });

    const tx = {
      select: txSelect,
      insert: vi.fn(),
    };

    mockDb.transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
    );

    await expect(
      createPromptRevision(
        'def-1',
        {
          versionLabel: '1.0',
          systemTemplate: 'no valid markers here',
          userTemplate: 'also missing required markers',
          configuration: {},
        },
        'user-1',
      ),
    ).rejects.toThrow('Missing required marker');
  });

  it('rejects reserved legacy configuration keys', async () => {
    const defResult = { id: 'def-1', kind: 'assembly', name: 'Test' };
    const defChain = makeChain([defResult]);
    defChain.for = vi.fn(() => Promise.resolve([defResult]));

    const tx = {
      select: vi.fn(() => defChain),
      insert: vi.fn(),
    };

    mockDb.transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
    );

    await expect(
      createPromptRevision(
        'def-1',
        {
          versionLabel: '1.5',
          systemTemplate: '{{EDITORIAL_CONTEXT}}',
          userTemplate: '{{ASSEMBLY_PLAN}} {{SECCIONES_GENERADAS}}',
          configuration: { legacySource: 'test' },
        },
        'user-1',
      ),
    ).rejects.toThrow('Reserved configuration key');
  });
});

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

describe('module exports', () => {
  it('exports resolvePromptRevision and createPromptRevision', async () => {
    const mod = await import('@/lib/prompts/repository');
    expect(typeof mod.resolvePromptRevision).toBe('function');
    expect(typeof mod.createPromptRevision).toBe('function');
  });
});
