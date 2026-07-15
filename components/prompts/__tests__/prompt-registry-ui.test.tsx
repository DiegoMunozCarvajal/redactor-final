/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi } from 'vitest';
import { KIND_LABELS } from '@/components/prompts/prompt-definition-list';
import { promptKindValues } from '@/lib/db/schema/prompt-registry';
import { assertPromptMarkers } from '@/lib/prompts/contracts';
import { CORE_PROMPT_KINDS, UTILITY_PROMPT_KINDS } from '@/lib/prompts/kinds';

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

describe('prompt kind grouping', () => {
  it('groups exactly six Core and three Utility kinds', () => {
    expect(CORE_PROMPT_KINDS).toEqual([
      'assembly-planner',
      'assembly',
      'critique',
      'corrector',
      'generation-system',
      'meta-template',
    ]);
    expect(UTILITY_PROMPT_KINDS).toEqual([
      'title',
      'placeholder-fill',
      'editorial-brief-extractor',
    ]);
  });

  it('PromptDefinitionList shows exact default and usage counts', async () => {
    const React = await import('react');
    const { render, screen } = await import('@testing-library/react');
    const { PromptDefinitionList } = await import(
      '@/components/prompts/prompt-definition-list'
    );
    render(
      React.createElement(PromptDefinitionList, {
        kind: 'assembly',
        definitions: [
          {
            id: 'def-1',
            name: 'Assembly',
            description: null,
            kind: 'assembly',
            archivedAt: null,
            latestRevision: {
              id: 'rev-2',
              versionLabel: '1.1',
              revisionNumber: 2,
            },
            defaultRevisionId: 'rev-1',
            defaultVersionLabel: '1.0',
            bindingCount: 3,
            executionCount: 12,
          },
        ],
        onCreate: vi.fn(),
      }),
    );
    expect(screen.getByText('Default: v1.0')).toBeTruthy();
    expect(screen.getByText('3 proyectos')).toBeTruthy();
    expect(screen.getByText('12 ejecuciones')).toBeTruthy();
  });

  it('PromptKindNav exports the correct component', async () => {
    const mod = await import('@/components/prompts/prompt-kind-nav');
    expect(typeof mod.PromptKindNav).toBe('function');
  });
});
