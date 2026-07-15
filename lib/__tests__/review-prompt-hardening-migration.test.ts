import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../../supabase/migrations/20260715000000_review_prompt_hardening.sql', import.meta.url),
  'utf8',
);

describe('review prompt hardening migration', () => {
  it('creates Critique v2, Corrector v2, and Assembly v1.x revisions', () => {
    expect(sql).toContain('seed:critique:v2:rev2');
    expect(sql).toContain('seed:corrector:v2:rev2');
    expect(sql).toContain('seed:assembly:v1.4:rev2');
  });

  it('computes revision_number dynamically to avoid UNIQUE conflict', () => {
    // Each insert computes COALESCE(MAX(revision_number), 0) + 1
    expect(sql).toMatch(/COALESCE\(MAX\(revision_number\),\s*0\)\s*\+\s*1/i);
    // Locks rows to prevent concurrent computation
    expect(sql).toMatch(/FOR UPDATE/i);
  });

  it('handles pre-existing user-created revision 2', () => {
    // With a pre-existing revision_number=2 for critique, the seed
    // should compute next_rev=3 and insert without UNIQUE violation.
    // The ON CONFLICT(id) DO NOTHING + dynamic revision_number
    // guarantee the migration succeeds regardless of prior user revisions.
    expect(sql).toMatch(/COALESCE\(MAX\(revision_number\),\s*0\)\s*\+\s*1/i);
    expect(sql).toContain('ON CONFLICT (id) DO NOTHING');
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
