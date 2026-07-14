import { describe, expect, it } from 'vitest';
import { assertPromptMarkers, promptRevisionInputSchema } from '@/lib/prompts/contracts';

describe('prompt marker contracts', () => {
  it('requires planner data and schema markers', () => {
    expect(() => assertPromptMarkers('assembly-planner', 'sys', '{{SECCIONES_GENERADAS}}')).toThrow(
      '{{EDITORIAL_CONTEXT}}',
    );
  });

  it('rejects undeclared runtime markers', () => {
    expect(() =>
      assertPromptMarkers(
        'assembly',
        '{{EDITORIAL_CONTEXT}}',
        '{{ASSEMBLY_PLAN}} {{SECCIONES_GENERADAS}} {{SECRET_RULE}}',
      ),
    ).toThrow('Unknown runtime marker {{SECRET_RULE}}');
  });

  it('accepts immutable revision input', () => {
    expect(
      promptRevisionInputSchema.parse({
        versionLabel: '1.3',
        systemTemplate: '{{EDITORIAL_CONTEXT}}',
        userTemplate: '{{ASSEMBLY_PLAN}} {{SECCIONES_GENERADAS}}',
        configuration: {},
      }).versionLabel,
    ).toBe('1.3');
  });
});
