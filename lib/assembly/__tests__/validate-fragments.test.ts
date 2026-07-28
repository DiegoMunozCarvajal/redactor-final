import { describe, it, expect } from 'vitest';
import {
  validateFragmentMarkers,
  AssemblyBlockedError,
} from '../validate-fragments';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validateFragmentMarkers', () => {
  it('passes when no fragments contain blocked markers', () => {
    const fragments = [
      { content: 'Texto limpio sin marcadores.' },
      { content: 'Otro fragmento valido.' },
    ];

    expect(() => validateFragmentMarkers(fragments)).not.toThrow();
  });

  it('passes on an empty fragment list', () => {
    expect(() => validateFragmentMarkers([])).not.toThrow();
  });

  it('throws AssemblyBlockedError when a fragment contains [EVIDENCIA PENDIENTE', () => {
    const fragments = [
      { content: 'Contenido normal.' },
      { content: 'Texto con [EVIDENCIA PENDIENTE — falta fuente' },
    ];

    expect(() => validateFragmentMarkers(fragments)).toThrow(AssemblyBlockedError);
  });

  it('throws with correct position (1-based) for [EVIDENCIA PENDIENTE', () => {
    const fragments = [
      { content: 'Primer fragmento.' },
      { content: 'Segundo con [EVIDENCIA PENDIENTE' },
    ];

    try {
      validateFragmentMarkers(fragments);
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AssemblyBlockedError);
      expect((err as AssemblyBlockedError).fragmentPosition).toBe(2);
      expect((err as AssemblyBlockedError).marker).toBe('[EVIDENCIA PENDIENTE');
    }
  });

  it('throws AssemblyBlockedError when a fragment contains [EVIDENCIA INCOMPATIBLE', () => {
    const fragments = [
      { content: 'Texto [EVIDENCIA INCOMPATIBLE — tipo de fuente no coincide' },
    ];

    expect(() => validateFragmentMarkers(fragments)).toThrow(AssemblyBlockedError);
  });

  it('throws for [EVIDENCIA INCOMPATIBLE with correct marker string and position', () => {
    const fragments = [
      { content: 'Uno.' },
      { content: 'Dos.' },
      { content: 'Tres con [EVIDENCIA INCOMPATIBLE' },
    ];

    try {
      validateFragmentMarkers(fragments);
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AssemblyBlockedError);
      expect((err as AssemblyBlockedError).fragmentPosition).toBe(3);
      expect((err as AssemblyBlockedError).marker).toBe('[EVIDENCIA INCOMPATIBLE');
    }
  });

  it('throws on the first fragment with a marker (short-circuits)', () => {
    const fragments = [
      { content: 'Primero [EVIDENCIA PENDIENTE' },
      { content: 'Segundo [EVIDENCIA INCOMPATIBLE' },
    ];

    try {
      validateFragmentMarkers(fragments);
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect((err as AssemblyBlockedError).fragmentPosition).toBe(1);
      expect((err as AssemblyBlockedError).marker).toBe('[EVIDENCIA PENDIENTE');
    }
  });

  it('does not throw on text that merely contains the word EVIDENCIA', () => {
    const fragments = [
      { content: 'Esto habla de evidencia en general, sin marcador.' },
    ];

    expect(() => validateFragmentMarkers(fragments)).not.toThrow();
  });

  it('has a descriptive error message', () => {
    const fragments = [
      { content: ' [EVIDENCIA PENDIENTE' },
    ];

    try {
      validateFragmentMarkers(fragments);
      expect.unreachable('Should have thrown');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('Fragment');
      expect(msg).toContain('1');
      expect(msg).toContain('[EVIDENCIA PENDIENTE');
      expect(msg).toContain('contiene marcador no resuelto');
    }
  });
});

describe('AssemblyBlockedError', () => {
  it('has name set to AssemblyBlockedError', () => {
    const err = new AssemblyBlockedError(1, '[EVIDENCIA PENDIENTE');
    expect(err.name).toBe('AssemblyBlockedError');
  });
});
