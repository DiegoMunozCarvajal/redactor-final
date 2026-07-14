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

import { runAssemblyAssembler } from '../assembler';

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
  text?: string;
  executionId?: string;
}) {
  return {
    result: {
      data: overrides?.text ?? 'Contenido del capítulo ensamblado.\n\nSegundo párrafo.',
      usage: { promptTokens: 200, completionTokens: 100, totalTokens: 300, costUsd: 0.005, cacheCreationTokens: 0, cacheReadTokens: 0 },
      durationMs: 1200,
    },
    executionId: overrides?.executionId ?? 'exec-assembly-1',
    revision: {
      id: 'rev-assembly-1',
      definitionId: 'def-assembly-1',
      kind: 'assembly',
      name: 'Assembly v1.3',
      revisionNumber: 3,
      versionLabel: 'v1.3',
      systemTemplate: '',
      userTemplate: '',
      requiredMarkers: ['{{EDITORIAL_CONTEXT}}', '{{ASSEMBLY_PLAN}}', '{{SECCIONES_GENERADAS}}'],
      outputContract: null,
      configuration: {},
    },
  };
}

const defaultPlan = makeValidPlan();

const defaultInput = {
  projectId: 'proj-1',
  model: 'claude-sonnet-4-20250514',
  editorialContext: '<editorial_context version="1" hash="abc"><market>...</market></editorial_context>',
  plan: defaultPlan,
  fragments: [
    { id: 'f1', title: 'Fragmento 1', content: 'Contenido del fragmento 1' },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockExecute.mockClear();
});

describe('runAssemblyAssembler', () => {
  it('calls executeVersionedPrompt with kind "assembly"', async () => {
    mockExecute.mockResolvedValue(makeMockResult());

    await runAssemblyAssembler(defaultInput);

    expect(mockExecute).toHaveBeenCalledOnce();
    const callArg = mockExecute.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.kind).toBe('assembly');
  });

  it('passes the correct markers to executeVersionedPrompt', async () => {
    mockExecute.mockResolvedValue(makeMockResult());

    await runAssemblyAssembler(defaultInput);

    const callArg = mockExecute.mock.calls[0][0] as Record<string, unknown>;
    const markerValues = callArg.markerValues as Record<string, string>;

    expect(markerValues).toHaveProperty('{{EDITORIAL_CONTEXT}}');
    expect(markerValues['{{EDITORIAL_CONTEXT}}']).toBe(defaultInput.editorialContext);
    expect(markerValues).toHaveProperty('{{ASSEMBLY_PLAN}}');
    expect(() => JSON.parse(markerValues['{{ASSEMBLY_PLAN}}'])).not.toThrow();
    expect(markerValues).toHaveProperty('{{SECCIONES_GENERADAS}}');
    expect(markerValues['{{SECCIONES_GENERADAS}}']).toContain('<fragments>');
    expect(markerValues['{{SECCIONES_GENERADAS}}']).toContain('<fragment id="f1"');
  });

  it('passes stage "assembling" to executeVersionedPrompt', async () => {
    mockExecute.mockResolvedValue(makeMockResult());

    await runAssemblyAssembler(defaultInput);

    const callArg = mockExecute.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.stage).toBe('assembling');
  });

  it('does not pass schema (raw text output)', async () => {
    mockExecute.mockResolvedValue(makeMockResult());

    await runAssemblyAssembler(defaultInput);

    const callArg = mockExecute.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.schema).toBeUndefined();
  });

  it('returns chapterText, executionId, and model', async () => {
    mockExecute.mockResolvedValue(
      makeMockResult({
        text: 'Texto del capítulo ensamblado.',
        executionId: 'exec-xyz',
      }),
    );

    const result = await runAssemblyAssembler(defaultInput);

    expect(result.chapterText).toBe('Texto del capítulo ensamblado.');
    expect(result.executionId).toBe('exec-xyz');
    expect(result.model).toBe(defaultInput.model);
  });

  it('returns usage and durationMs from the execution result', async () => {
    mockExecute.mockResolvedValue(makeMockResult());

    const result = await runAssemblyAssembler(defaultInput);

    expect(result.usage.totalTokens).toBe(300);
    expect(result.durationMs).toBe(1200);
  });

  it('trims leading/trailing whitespace from the output', async () => {
    mockExecute.mockResolvedValue(
      makeMockResult({ text: '  Texto con espacios externos.\n\nSegundo párrafo.  ' }),
    );

    const result = await runAssemblyAssembler(defaultInput);
    expect(result.chapterText).toBe('Texto con espacios externos.\n\nSegundo párrafo.');
  });

  it('throws when assembly produces empty output', async () => {
    mockExecute.mockResolvedValue(makeMockResult({ text: '' }));

    await expect(
      runAssemblyAssembler(defaultInput),
    ).rejects.toThrow('Assembly produced empty output');
  });

  it('passes revisionId when provided', async () => {
    mockExecute.mockResolvedValue(makeMockResult());

    await runAssemblyAssembler({
      ...defaultInput,
      revisionId: 'my-revision',
    });

    const callArg = mockExecute.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.revisionId).toBe('my-revision');
  });

  it('passes effort when provided', async () => {
    mockExecute.mockResolvedValue(makeMockResult());

    await runAssemblyAssembler({
      ...defaultInput,
      effort: 'high',
    });

    const callArg = mockExecute.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.effort).toBe('high');
  });
});
