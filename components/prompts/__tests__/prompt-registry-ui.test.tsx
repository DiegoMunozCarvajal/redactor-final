import { describe, expect, it } from 'vitest';
import { KIND_LABELS } from '@/components/prompts/prompt-definition-list';
import { promptKindValues } from '@/lib/db/schema/prompt-registry';
import { assertPromptMarkers } from '@/lib/prompts/contracts';

describe('KIND_LABELS', () => {
  it('has labels for all prompt kind values', () => {
    for (const kind of promptKindValues) {
      expect(KIND_LABELS[kind]).toBeTruthy();
      expect(typeof KIND_LABELS[kind]).toBe('string');
    }
  });

  it('has Spanish labels for all kinds', () => {
    expect(KIND_LABELS['generation-system']).toBe('Sistema');
    expect(KIND_LABELS['assembly-planner']).toBe('Planificador');
    expect(KIND_LABELS.assembly).toBe('Ensamblaje');
    expect(KIND_LABELS.critique).toBe('Crítica');
    expect(KIND_LABELS.corrector).toBe('Corrector');
    expect(KIND_LABELS.title).toBe('Título');
    expect(KIND_LABELS['placeholder-fill']).toBe('Placeholders');
    expect(KIND_LABELS['editorial-brief-extractor']).toBe('Extractor editorial');
    expect(KIND_LABELS['meta-template']).toBe('Meta-prompt');
  });
});

describe('PromptDefinitionList component exports', () => {
  it('PromptDefinitionList is a valid component function', async () => {
    const mod = await import('@/components/prompts/prompt-definition-list');
    expect(typeof mod.PromptDefinitionList).toBe('function');
  });
});

describe('PromptRevisionEditor component exports', () => {
  it('PromptRevisionEditor is a valid component function', async () => {
    const mod = await import('@/components/prompts/prompt-revision-editor');
    expect(typeof mod.PromptRevisionEditor).toBe('function');
  });
});
