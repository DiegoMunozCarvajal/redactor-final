const PLACEHOLDER_RE = /(?<!\{)\{([a-zA-Z_][a-zA-Z0-9_]*)\}(?!\})/g;

export function extractPlaceholders(contents: string[]): string[] {
  const names = new Set<string>();
  for (const content of contents) {
    for (const match of content.matchAll(PLACEHOLDER_RE)) {
      names.add(match[1]);
    }
  }
  return [...names];
}

export interface PlaceholderSyncRow {
  name: string;
  definition?: string | null;
  function?: string | null;
  notes?: string | null;
}

export function getPlaceholderNamesToDelete(
  existingRows: PlaceholderSyncRow[],
  detectedNames: string[],
): string[] {
  const detected = new Set(detectedNames);
  return existingRows
    .filter((row) => {
      if (detected.has(row.name)) return false;
      return !row.definition && !row.function && !row.notes;
    })
    .map((row) => row.name);
}

export function getMissingPlaceholderNames(
  contents: string[],
  placeholders: Record<string, string>,
): string[] {
  return extractPlaceholders(contents).filter((name) => !(name in placeholders));
}
