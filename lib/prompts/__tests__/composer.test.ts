import { describe, expect, it } from 'vitest';
import { composePrompt } from '@/lib/prompts/composer';

const revision = {
  systemTemplate: 'SYS\n{{EDITORIAL_CONTEXT}}',
  userTemplate: 'PLAN={{ASSEMBLY_PLAN}}\nFRAGS={{SECCIONES_GENERADAS}}',
  requiredMarkers: ['{{EDITORIAL_CONTEXT}}', '{{ASSEMBLY_PLAN}}', '{{SECCIONES_GENERADAS}}'],
};

it('replaces only declared markers byte for byte', () => {
  const result = composePrompt(revision, {
    '{{EDITORIAL_CONTEXT}}': '<brief />',
    '{{ASSEMBLY_PLAN}}': '{"version":"1"}',
    '{{SECCIONES_GENERADAS}}': '<fragmentos />',
  });
  expect(result.systemMessage).toBe('SYS\n<brief />');
  expect(result.userMessage).toBe('PLAN={"version":"1"}\nFRAGS=<fragmentos />');
  expect(result.dataManifest).toEqual({
    '{{EDITORIAL_CONTEXT}}': { sha256: expect.any(String), chars: 9 },
    '{{ASSEMBLY_PLAN}}': { sha256: expect.any(String), chars: 15 },
    '{{SECCIONES_GENERADAS}}': { sha256: expect.any(String), chars: 14 },
  });
});

it('fails when a value is missing', () => {
  expect(() => composePrompt(revision, {})).toThrow('Missing marker value {{EDITORIAL_CONTEXT}}');
});

it('fails when replacement leaves a runtime marker', () => {
  expect(() =>
    composePrompt(revision, {
      '{{EDITORIAL_CONTEXT}}': '{{HIDDEN}}',
      '{{ASSEMBLY_PLAN}}': '{}',
      '{{SECCIONES_GENERADAS}}': '[]',
    }),
  ).toThrow('Unresolved runtime marker {{HIDDEN}}');
});

it('computes stable SHA-256 hashes', () => {
  const a = composePrompt(revision, {
    '{{EDITORIAL_CONTEXT}}': 'x',
    '{{ASSEMBLY_PLAN}}': 'y',
    '{{SECCIONES_GENERADAS}}': 'z',
  });
  const b = composePrompt(revision, {
    '{{EDITORIAL_CONTEXT}}': 'x',
    '{{ASSEMBLY_PLAN}}': 'y',
    '{{SECCIONES_GENERADAS}}': 'z',
  });
  expect(a.dataManifest).toEqual(b.dataManifest);
});
