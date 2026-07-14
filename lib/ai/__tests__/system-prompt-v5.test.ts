import { describe, expect, it } from 'vitest';
import { DEFAULT_SYSTEM_PROMPT, SYSTEM_PROMPT_V5 } from '@/lib/ai/system-prompts';

describe('System Prompt v5', () => {
  it('is the hardcoded generation fallback', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toBe(SYSTEM_PROMPT_V5);
  });

  it('gives approved editorial context authority over variable defaults', () => {
    expect(SYSTEM_PROMPT_V5).toContain('<jerarquia_de_instrucciones>');
    for (const field of [
      'manuscriptLanguage',
      'audience',
      'promise',
      'voice',
      'guardrails',
      'evidence',
      'chapter_contract',
    ]) {
      expect(SYSTEM_PROMPT_V5).toContain(field);
    }
    expect(SYSTEM_PROMPT_V5).toContain('Si no recibes <editorial_context>');
  });

  it('preserves stable v4 craft and output constraints', () => {
    for (const ruleId of [
      'una-idea',
      'voz-activa',
      'concreto',
      'atribucion',
      'originalidad',
      'precision',
      'apertura',
      'transiciones',
      'reencuadres',
    ]) {
      expect(SYSTEM_PROMPT_V5).toContain(`<regla id="${ruleId}"`);
    }
    expect(SYSTEM_PROMPT_V5).toContain('<autorevision>');
    expect(SYSTEM_PROMPT_V5).toContain('<formato-salida>');
    expect(SYSTEM_PROMPT_V5).toContain('Hábitos Atómicos');
  });

  it('prefers explanation over routine illustrations', () => {
    expect(SYSTEM_PROMPT_V5).toContain('Profundidad antes que variedad');
    expect(SYSTEM_PROMPT_V5).toContain('La respuesta predeterminada es no');
    expect(SYSTEM_PROMPT_V5).toContain('un único recurso central');
    expect(SYSTEM_PROMPT_V5).toContain('No inventes personajes con nombres propios');
    expect(SYSTEM_PROMPT_V5).not.toContain('{respaldo}');
    expect(SYSTEM_PROMPT_V5).not.toContain('Para cada párrafo planeado, define el anclaje');
    expect(SYSTEM_PROMPT_V5).not.toContain('crea un marco, metáfora o ejemplo propio');
  });

  it('qualifies or removes unsupported claims instead of inventing support', () => {
    expect(SYSTEM_PROMPT_V5).toContain('califica la afirmación o elimínala');
    expect(SYSTEM_PROMPT_V5).toContain('No dejes marcadores genéricos');
    expect(SYSTEM_PROMPT_V5).toContain(
      'La memoria del modelo nunca reemplaza una política de evidencia explícita',
    );
  });
});
