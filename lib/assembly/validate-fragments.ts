// ---------------------------------------------------------------------------
// Evidence marker validation
// ---------------------------------------------------------------------------
// Fragments containing unresolved evidence markers must block assembly.
// The LLM should not be relied upon to detect these — use deterministic code.
// ---------------------------------------------------------------------------

export class AssemblyBlockedError extends Error {
  constructor(
    public readonly fragmentPosition: number,
    public readonly marker: string,
  ) {
    super(
      `Fragment ${fragmentPosition} contiene marcador no resuelto: ${marker}`,
    );
    this.name = 'AssemblyBlockedError';
  }
}

const BLOCKED_MARKERS = ['[EVIDENCIA PENDIENTE', '[EVIDENCIA INCOMPATIBLE'] as const;

export interface FragmentWithContent {
  content: string;
}

/**
 * Check every fragment for unresolved evidence markers.
 *
 * @param fragments - Array of fragment objects with a `content` property.
 *   Position is derived from the array index (1-based) for error reporting.
 * @throws {AssemblyBlockedError} if any fragment contains a blocked marker.
 */
export function validateFragmentMarkers(fragments: FragmentWithContent[]): void {
  for (let i = 0; i < fragments.length; i++) {
    const content = fragments[i].content;
    for (const marker of BLOCKED_MARKERS) {
      if (content.includes(marker)) {
        throw new AssemblyBlockedError(i + 1, marker);
      }
    }
  }
}
