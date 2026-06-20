const PLACEHOLDER_RE = /(?<!\{)\{([a-zA-Z_][a-zA-Z0-9_]*)\}(?!\})/g;

export function extractPlaceholders(contents: string[]): string[] {
  const names = new Set<string>();
  for (const content of contents) {
    for (const match of content.matchAll(PLACEHOLDER_RE)) {
      names.add(match[1].toLowerCase());
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
  // Case-insensitive lookup: extracted names are lowercase, but placeholders
  // map may have mixed-case keys from older data.
  const lowerKeys = new Map(Object.entries(placeholders).map(([k, v]) => [k.toLowerCase(), v]));
  return extractPlaceholders(contents).filter((name) => !lowerKeys.has(name));
}

export function hashPromptContents(contents: string[]): string {
  // Simple fast hash — not cryptographic, just change detection
  let hash = 0;
  const str = contents.join("|||");
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return hash.toString(36);
}
