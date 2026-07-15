import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../../supabase/migrations/20260715000000_review_prompt_hardening.sql', import.meta.url),
  'utf8',
);

describe('review prompt hardening migration', () => {
  it('creates Critique 2.0, Corrector 2.0, and Assembly 1.4 revisions', () => {
    expect(sql).toContain("'2.0'");
    expect(sql.match(/'2\.0'/g)).toHaveLength(2);
    expect(sql).toContain("'1.4'");
    expect(sql).toContain('seed:critique:v2:rev2');
    expect(sql).toContain('seed:corrector:v2:rev2');
    expect(sql).toContain('seed:assembly:v1.4:rev2');
  });

  it('defines the six Critique v2 editorial criteria and status contract', () => {
    for (const id of [
      'audiencia',
      'promesa',
      'contrato_capitulo',
      'voz',
      'guardrails',
      'evidencia',
    ]) {
      expect(sql).toContain(`<criterio id="${id}">`);
    }
    expect(sql).toContain('pass|partial|fail');
    expect(sql).toContain('<evidencia>');
    expect(sql).toContain('<impacto>');
    expect(sql).toContain('<correccion_requerida>');
  });

  it('requires Corrector v2 to resolve every partial or fail', () => {
    expect(sql).toMatch(/resuelve todos los criterios editoriales con estado partial o fail/i);
    expect(sql).toContain('<capitulo_corregido>');
    expect(sql).toContain('<correcciones>');
    expect(sql).toContain('<correccion>');
  });

  it('makes EditorialBrief control assembly language with Spanish fallback', () => {
    expect(sql).toContain('Eres un editor y escritor senior de no ficción. Conviertes');
    expect(sql).toMatch(/manuscriptLanguage controla el idioma/i);
    expect(sql).toMatch(/Si no existe contexto editorial aprobado, escribe en español/i);
  });

  it('updates only global defaults and preserves project bindings', () => {
    for (const kind of ['critique', 'corrector', 'assembly']) {
      expect(sql).toMatch(new RegExp(`WHERE kind = '${kind}'`, 'i'));
    }
    expect(sql).not.toMatch(/UPDATE\s+project_prompt_bindings/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+project_prompt_bindings/i);
  });
});
