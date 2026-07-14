import { describe, expect, it } from 'vitest';
import {
  assemblyPlanV1Schema,
  validateAssemblyPlan,
  type AssemblyPlanV1,
} from '@/lib/assembly/plan-schema';

function makeValidPlan(overrides?: Partial<AssemblyPlanV1>): AssemblyPlanV1 {
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
          { fragmentId: 'f1', action: 'keep', reason: 'Material central' },
          { fragmentId: 'f2', action: 'merge', reason: 'Complementa f1' },
        ],
        synthesis: null,
        transitionIn: null,
      },
    ],
    mustCover: [
      {
        contractIndex: 0,
        item: 'A',
        status: 'covered' as const,
        sourceFragmentIds: ['f1'],
        handling: 'Cubierto por fragmento principal',
      },
      {
        contractIndex: 1,
        item: 'B',
        status: 'covered' as const,
        sourceFragmentIds: ['f2'],
        handling: 'Cubierto por fragmento complementario',
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
    ...overrides,
  };
}

const defaultCtx = {
  fragmentIds: ['f1', 'f2', 'f3'],
  mustCover: ['A', 'B'],
};

describe('assemblyPlanV1Schema', () => {
  it('accepts a valid plan', () => {
    const plan = makeValidPlan();
    expect(() => assemblyPlanV1Schema.parse(plan)).not.toThrow();
  });

  it('rejects version other than 1', () => {
    const plan = makeValidPlan({ version: '2' as unknown as '1' });
    expect(() => assemblyPlanV1Schema.parse(plan)).toThrow();
  });

  it('rejects empty sections array', () => {
    const plan = makeValidPlan({ sections: [] });
    expect(() => assemblyPlanV1Schema.parse(plan)).toThrow();
  });
});

describe('validateAssemblyPlan', () => {
  it('returns parsed plan on valid input', () => {
    const plan = makeValidPlan();
    const result = validateAssemblyPlan(plan, defaultCtx);
    expect(result.version).toBe('1');
  });

  it('rejects missing mustCover index', () => {
    const plan = makeValidPlan({
      mustCover: [
        { contractIndex: 0, item: 'A', status: 'covered', sourceFragmentIds: ['f1'], handling: 'ok' },
      ],
    });
    expect(() => validateAssemblyPlan(plan, defaultCtx)).toThrow(
      'mustCover contractIndex 1 is missing',
    );
  });

  it('rejects duplicate contractIndex', () => {
    const plan = makeValidPlan({
      mustCover: [
        { contractIndex: 0, item: 'A', status: 'covered', sourceFragmentIds: ['f1'], handling: 'ok' },
        { contractIndex: 1, item: 'B', status: 'covered', sourceFragmentIds: ['f2'], handling: 'ok' },
        { contractIndex: 1, item: 'B', status: 'covered', sourceFragmentIds: ['f2'], handling: 'duplicate' },
      ],
    });
    expect(() => validateAssemblyPlan(plan, defaultCtx)).toThrow('duplicate contractIndex 1');
  });

  it('rejects item text different from contract', () => {
    const plan = makeValidPlan({
      mustCover: [
        { contractIndex: 0, item: 'A', status: 'covered', sourceFragmentIds: ['f1'], handling: 'ok' },
        { contractIndex: 1, item: 'Wrong', status: 'covered', sourceFragmentIds: ['f2'], handling: 'ok' },
      ],
    });
    expect(() => validateAssemblyPlan(plan, defaultCtx)).toThrow('does not match contract');
  });

  it('rejects unknown fragment ID in treatments', () => {
    const plan = makeValidPlan({
      sections: [{
        id: 's1',
        purpose: 'Test',
        sourceTreatments: [{ fragmentId: 'unknown-frag', action: 'keep', reason: 'test' }],
        synthesis: null,
        transitionIn: null,
      }],
    });
    expect(() => validateAssemblyPlan(plan, defaultCtx)).toThrow('Unknown fragment ID "unknown-frag"');
  });

  it('rejects unknown section ID in bridge', () => {
    const plan = makeValidPlan({
      bridges: [{
        fromSectionId: 'unknown-section',
        toSectionId: 's1',
        logicalConnection: 'Test',
        factualBoundary: 'Test',
      }],
    });
    expect(() => validateAssemblyPlan(plan, defaultCtx)).toThrow('Unknown section ID "unknown-section"');
  });

  it('rejects cut fragment used by illustration', () => {
    const plan = makeValidPlan({
      sections: [{
        id: 's1',
        purpose: 'Test',
        sourceTreatments: [{ fragmentId: 'f1', action: 'cut', reason: 'Weak' }],
        synthesis: null,
        transitionIn: null,
      }],
      illustrations: [{
        sourceFragmentIds: ['f1'],
        purpose: 'Test',
        handling: 'keep',
      }],
    });
    expect(() => validateAssemblyPlan(plan, defaultCtx)).toThrow(
      '"f1" is cut but still referenced by an illustration',
    );
  });
});
