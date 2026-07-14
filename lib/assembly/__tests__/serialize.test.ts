import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  serializeAssemblyFragments,
  serializeAssemblyPlan,
  serializeOutputSchema,
} from '../serialize';
import { assemblyPlanV1Schema } from '../plan-schema';

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const basicFragments = [
  { id: 'f1', title: 'Introduccion', content: 'Contenido de la introduccion' },
  { id: 'f2', title: 'Desarrollo con &', content: 'Texto con <especial> & "comillas"' },
];

const emptyFragments: { id: string; title: string; content: string }[] = [];

const validPlan = {
  version: '1' as const,
  chapterIntent: 'Test chapter',
  opening: {
    sourceFragmentIds: ['f1'],
    approach: 'Open with context',
  },
  sections: [
    {
      id: 's1',
      purpose: 'Define concepts',
      sourceTreatments: [
        { fragmentId: 'f1', action: 'keep' as const, reason: 'Central material' },
      ],
      synthesis: null,
      transitionIn: null,
    },
  ],
  mustCover: [
    {
      contractIndex: 0,
      item: 'Item A',
      status: 'covered' as const,
      sourceFragmentIds: ['f1'],
      handling: 'Covered by main fragment',
    },
  ],
  redundancies: [],
  illustrations: [],
  bridges: [],
  closing: {
    sourceFragmentIds: ['f1'],
    approach: 'Summarize',
    transitionToNext: null,
  },
  unsupportedGaps: [],
};

// ---------------------------------------------------------------------------
// serializeAssemblyFragments tests
// ---------------------------------------------------------------------------

describe('serializeAssemblyFragments', () => {
  it('wraps fragments in root <fragments> element', () => {
    const result = serializeAssemblyFragments(basicFragments);
    expect(result).toMatch(/^<fragments>/);
    expect(result).toMatch(/<\/fragments>$/);
  });

  it('renders each fragment as a <fragment> element with id and title attributes', () => {
    const result = serializeAssemblyFragments(basicFragments);
    expect(result).toContain('<fragment id="f1" title="Introduccion">');
    expect(result).toContain('<fragment id="f2" title="Desarrollo con &amp;">');
  });

  it('includes text content inside each fragment element, XML-escaped', () => {
    const result = serializeAssemblyFragments(basicFragments);
    // First fragment — no special chars
    expect(result).toContain('Contenido de la introduccion');
    // Second fragment — XML-escaped
    expect(result).toContain('Texto con &lt;especial&gt; &amp; &quot;comillas&quot;');
    expect(result).not.toContain('Texto con <especial>');
    expect(result).not.toContain('"comillas"');
  });

  it('handles an empty fragment array', () => {
    const result = serializeAssemblyFragments(emptyFragments);
    expect(result).toBe('<fragments>\n</fragments>');
  });

  it('delimits multiple fragments with newlines', () => {
    const result = serializeAssemblyFragments(basicFragments);
    // Two fragment elements should be on separate lines
    const lines = result.split('\n');
    const fragmentLines = lines.filter((l) => l.includes('<fragment id='));
    expect(fragmentLines).toHaveLength(2);
  });

  it('escapes XML special characters in all attributes', () => {
    const frags = [
      { id: 'a&b', title: 'title with "quotes"', content: 'plain' },
    ];
    const result = serializeAssemblyFragments(frags);
    expect(result).toContain('id="a&amp;b"');
    expect(result).toContain('title="title with &quot;quotes&quot;"');
  });
});

// ---------------------------------------------------------------------------
// serializeAssemblyPlan tests
// ---------------------------------------------------------------------------

describe('serializeAssemblyPlan', () => {
  it('produces valid JSON', () => {
    const result = serializeAssemblyPlan(validPlan);
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it('round-trips to the same object shape', () => {
    const result = serializeAssemblyPlan(validPlan);
    const parsed = JSON.parse(result);
    expect(parsed.version).toBe('1');
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].id).toBe('s1');
  });
});

// ---------------------------------------------------------------------------
// serializeOutputSchema tests
// ---------------------------------------------------------------------------

describe('serializeOutputSchema', () => {
  it('produces valid JSON', () => {
    const result = serializeOutputSchema(assemblyPlanV1Schema);
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it('produces an OpenAPI 3 style JSON Schema with type, properties, required', () => {
    const result = serializeOutputSchema(assemblyPlanV1Schema);
    const parsed = JSON.parse(result);
    // OpenAPI 3 wrapper has a top-level schema
    expect(parsed).toHaveProperty('type');
    expect(parsed).toHaveProperty('properties');
    expect(parsed).toHaveProperty('required');
  });

  it('includes version field with literal "1" constraint', () => {
    const result = serializeOutputSchema(assemblyPlanV1Schema);
    const parsed = JSON.parse(result);
    expect(parsed.properties?.version).toBeDefined();
  });

  it('handles simple schemas like z.string()', () => {
    const result = serializeOutputSchema(z.string());
    const parsed = JSON.parse(result);
    expect(parsed.type).toBe('string');
  });

  it('handles z.object() schemas', () => {
    const schema = z.object({ name: z.string(), count: z.number() });
    const result = serializeOutputSchema(schema);
    const parsed = JSON.parse(result);
    expect(parsed.type).toBe('object');
    expect(parsed.properties).toHaveProperty('name');
    expect(parsed.properties).toHaveProperty('count');
  });
});
