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
    expect(KIND_LABELS['rhetoric-trace']).toBe('Traza retórica');
    expect(KIND_LABELS['template-generator']).toBe('Generador de templates');
    expect(KIND_LABELS['source-risk-profiler']).toBe('Perfil de riesgo de fuente');
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
  it('lists all kinds in pipeline order without utility split', () => {
    expect(CORE_PROMPT_KINDS).toEqual([
      'editorial-brief-extractor',
      'rhetoric-trace',
      'template-generator',
      'source-risk-profiler',
      'placeholder-fill',
      'generation-system',
      'assembly-planner',
      'assembly',
      'title',
      'critique',
      'corrector',
    ]);
    expect(UTILITY_PROMPT_KINDS).toEqual([]);
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

describe('RevisionDiff', () => {
  it('marks removed and added draft lines', async () => {
    const React = await import('react');
    const { render, screen } = await import('@testing-library/react');
    const { RevisionDiff } = await import('@/components/prompts/revision-diff');
    render(
      React.createElement(RevisionDiff, {
        before: 'línea anterior\n',
        after: 'línea nueva\n',
      }),
    );
    expect(screen.getByText('línea anterior').getAttribute('data-change')).toBe(
      'removed',
    );
    expect(screen.getByText('línea nueva').getAttribute('data-change')).toBe(
      'added',
    );
  });
});

describe('PromptRevisionEditor create from base', () => {
  it('creates a draft from the selected revision, not always latest', async () => {
    const { fireEvent, render, screen } = await import('@testing-library/react');
    const React = await import('react');
    const { PromptRevisionEditor } = await import(
      '@/components/prompts/prompt-revision-editor'
    );

    render(
      React.createElement(PromptRevisionEditor, {
        definitionId: 'def-1',
        definitionName: 'Assembly',
        kind: 'assembly',
        archived: false,
        currentDefaultRevisionId: 'rev-2',
        revisions: [
          {
            id: 'rev-2',
            revisionNumber: 2,
            versionLabel: '1.1',
            systemTemplate: 'latest',
            userTemplate: 'latest user',
            requiredMarkers: [],
            outputContract: null,
            configuration: {},
            createdAt: '2026-07-14',
            createdBy: null,
            isDefault: true,
            bindingCount: 0,
            executionCount: 0,
          },
          {
            id: 'rev-1',
            revisionNumber: 1,
            versionLabel: '1.0',
            systemTemplate: 'chosen base',
            userTemplate: 'chosen user',
            requiredMarkers: [],
            outputContract: null,
            configuration: { temperature: 0 },
            createdAt: '2026-07-13',
            createdBy: null,
            isDefault: false,
            bindingCount: 0,
            executionCount: 0,
          },
        ],
        onChanged: vi.fn(),
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Crear desde v1.0' }));
    expect(
      (screen.getByLabelText('System Template') as HTMLTextAreaElement).value,
    ).toBe('chosen base');
    expect(
      (screen.getByLabelText('User Template') as HTMLTextAreaElement).value,
    ).toBe('chosen user');
    expect(
      (screen.getByLabelText('Configuración JSON') as HTMLTextAreaElement).value,
    ).toBe('{\n  "temperature": 0\n}');
  });
});
