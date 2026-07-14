import { describe, it, expect, vi } from 'vitest';
import type { AssemblyPlanV1 } from '../plan-schema';

// ---------------------------------------------------------------------------
// Mock executeVersionedPrompt
// ---------------------------------------------------------------------------

const mockExecute = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(),
);

import { beforeEach } from 'vitest';

vi.mock('@/lib/prompts/executor', () => ({
  executeVersionedPrompt: mockExecute,
}));

// ---------------------------------------------------------------------------
// Subject
// ---------------------------------------------------------------------------

import { runAssemblyPlanner } from '../planner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeValidPlan(): AssemblyPlanV1 {
  return {
    version: '1',
    chapterIntent: 'Introducir al lector en el tema',
    opening: {
      sourceFragmentIds: ['f1'],
      approach: 'Abrir con contexto general',
    },
    sections: [
      {
        id: 's1',
        purpose: 'Definir conceptos',
        sourceTreatments: [
          { fragmentId: 'f1', action: 'keep' as const, reason: 'Material central' },
          { fragmentId: 'f2', action: 'merge' as const, reason: 'Complementa f1' },
        ],
        synthesis: null,
        transitionIn: null,
      },
    ],
    mustCover: [
      {
        contractIndex: 0,
        item: 'Requerimiento A',
        status: 'covered' as const,
        sourceFragmentIds: ['f1'],
        handling: 'Cubierto por fragmento principal',
      },
    ],
    redundancies: [],
    illustrations: [],
    bridges: [],
    closing: {
      sourceFragmentIds: ['f1'],
      approach: 'Resumir conclusiones',
      transitionToNext: null,
    },
    unsupportedGaps: [],
  };
}

function makeMockResult(overrides?: {
  plan?: AssemblyPlanV1;
  executionId?: string;
}) {
  const plan = overrides?.plan ?? makeValidPlan();
  return {
    result: {
      data: plan,
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, costUsd: 0.002, cacheCreationTokens: 0, cacheReadTokens: 0 },
      durationMs: 500,
    },
    executionId: overrides?.executionId ?? 'exec-1',
    revision: {
      id: 'rev-1',
      definitionId: 'def-1',
      kind: 'assembly-planner',
      name: 'Assembly Planner v1',
      revisionNumber: 1,
      versionLabel: 'v1.0',
      systemTemplate: '',
      userTemplate: '',
      requiredMarkers: ['{{EDITORIAL_CONTEXT}}', '{{SECCIONES_GENERADAS}}', '{{OUTPUT_SCHEMA}}'],
      outputContract: null,
      configuration: {},
    },
  };
}

const defaultInput = {
  projectId: 'proj-1',
  model: 'claude-sonnet-4-20250514',
  editorialContext: '<editorial_context version="1" hash="abc"><market>...</market></editorial_context>',
  fragments: [
    { id: 'f1', title: 'Fragmento 1', content: 'Contenido del fragmento 1' },
    { id: 'f2', title: 'Fragmento 2', content: 'Contenido del fragmento 2' },
  ],
  validationContext: {
    fragmentIds: ['f1', 'f2'],
    mustCover: ['Requerimiento A'],
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockExecute.mockClear();
});

describe('runAssemblyPlanner', () => {
  it('calls executeVersionedPrompt with kind "assembly-planner"', async () => {
    mockExecute.mockResolvedValue(makeMockResult());

    await runAssemblyPlanner(defaultInput);

    expect(mockExecute).toHaveBeenCalledOnce();
    const callArg = mockExecute.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.kind).toBe('assembly-planner');
  });

  it('passes the correct markers to executeVersionedPrompt', async () => {
    mockExecute.mockResolvedValue(makeMockResult());

    await runAssemblyPlanner(defaultInput);

    const callArg = mockExecute.mock.calls[0][0] as Record<string, unknown>;
    const markerValues = callArg.markerValues as Record<string, string>;

    expect(markerValues).toHaveProperty('{{EDITORIAL_CONTEXT}}');
    expect(markerValues['{{EDITORIAL_CONTEXT}}']).toBe(defaultInput.editorialContext);
    expect(markerValues).toHaveProperty('{{SECCIONES_GENERADAS}}');
    expect(markerValues['{{SECCIONES_GENERADAS}}']).toContain('<fragments>');
    expect(markerValues['{{SECCIONES_GENERADAS}}']).toContain('<fragment id="f1"');
    expect(markerValues).toHaveProperty('{{OUTPUT_SCHEMA}}');
    expect(() => JSON.parse(markerValues['{{OUTPUT_SCHEMA}}'])).not.toThrow();
  });

  it('passes the assemblyPlanV1Schema as schema for structured output', async () => {
    mockExecute.mockResolvedValue(makeMockResult());

    await runAssemblyPlanner(defaultInput);

    const callArg = mockExecute.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.schema).toBeDefined();
    expect(typeof (callArg.schema as { parse: unknown }).parse).toBe('function');
  });

  it('passes stage "planning" to executeVersionedPrompt', async () => {
    mockExecute.mockResolvedValue(makeMockResult());

    await runAssemblyPlanner(defaultInput);

    const callArg = mockExecute.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.stage).toBe('planning');
  });

  it('returns validated plan, executionId, and model', async () => {
    mockExecute.mockResolvedValue(makeMockResult({ executionId: 'exec-abc' }));

    const result = await runAssemblyPlanner(defaultInput);

    expect(result.plan).toBeDefined();
    expect(result.plan.version).toBe('1');
    expect(result.plan.chapterIntent).toBe('Introducir al lector en el tema');
    expect(result.executionId).toBe('exec-abc');
    expect(result.model).toBe(defaultInput.model);
  });

  it('returns usage and durationMs from the execution result', async () => {
    mockExecute.mockResolvedValue(makeMockResult());

    const result = await runAssemblyPlanner(defaultInput);

    expect(result.usage.totalTokens).toBe(150);
    expect(result.durationMs).toBe(500);
  });

  it('validates the plan after the executor returns', async () => {
    const invalidPlan = makeValidPlan();
    invalidPlan.mustCover = [];
    mockExecute.mockResolvedValue(makeMockResult({ plan: invalidPlan }));

    await expect(runAssemblyPlanner(defaultInput)).rejects.toThrow(
      'mustCover contractIndex 0 is missing',
    );
  });

  it('rejects a plan with unknown fragment IDs', async () => {
    const planWithBadRef = makeValidPlan();
    planWithBadRef.opening.sourceFragmentIds = ['nonexistent-frag'];
    mockExecute.mockResolvedValue(makeMockResult({ plan: planWithBadRef }));

    await expect(runAssemblyPlanner(defaultInput)).rejects.toThrow(
      'Unknown fragment ID',
    );
  });

  it('passes revisionId when provided', async () => {
    mockExecute.mockResolvedValue(makeMockResult());

    await runAssemblyPlanner({
      ...defaultInput,
      revisionId: 'my-revision',
    });

    const callArg = mockExecute.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.revisionId).toBe('my-revision');
  });

  it('passes effort when provided', async () => {
    mockExecute.mockResolvedValue(makeMockResult());

    await runAssemblyPlanner({
      ...defaultInput,
      effort: 'high',
    });

    const callArg = mockExecute.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.effort).toBe('high');
  });
});
