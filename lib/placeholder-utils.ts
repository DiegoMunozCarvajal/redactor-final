import type { OriginalityLineage } from "@/lib/originality/lineage";
import { isOriginalityLineageCurrent } from "@/lib/originality/lineage";

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

export function needsPlaceholderFill(
  definition: string | null | undefined,
  metadata: { promptsHash?: string; editorialBriefHash?: string; originalityLineage?: { scope: string } } | null | undefined,
  promptsHash: string,
  editorialBriefHash?: string | null,
  currentLineage?: { scope: string } | null,
): boolean {
  if (!definition) return true;
  if (!metadata?.promptsHash && !metadata?.editorialBriefHash) return true;
  if (metadata.promptsHash && metadata.promptsHash !== promptsHash) return true;
  if (editorialBriefHash && metadata.editorialBriefHash !== editorialBriefHash) return true;
  // Lineage mismatch → requires refresh (source contamination guard)
  if (currentLineage && metadata?.originalityLineage) {
    try {
      if (!isOriginalityLineageCurrent(
        metadata.originalityLineage as OriginalityLineage,
        currentLineage as OriginalityLineage,
      )) {
        return true;
      }
    } catch {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Dependency-based placeholder context selection
// ---------------------------------------------------------------------------

export interface PlaceholderDependencyContext {
  [name: string]: string;
}

export class PlaceholderDependencyError extends Error {
  constructor(
    public readonly missingNames: string[],
    message: string,
  ) {
    super(message);
    this.name = "PlaceholderDependencyError";
  }
}

export function selectPlaceholderDependencies(input: {
  current: { name: string; dependencyNames: string[] };
  rows: Array<{
    name: string;
    definition: string | null;
    fillMetadata?: { status?: string; originalityAssessmentId?: string; originalityLineage?: OriginalityLineage; definitionOrigin?: string } | null;
  }>;
  currentLineage: OriginalityLineage;
}): PlaceholderDependencyContext {
  const { current, rows, currentLineage } = input;

  // Only use declared dependency names (never all siblings)
  const dependencyNames = new Set(current.dependencyNames);
  if (dependencyNames.size === 0) return {};

  const context: PlaceholderDependencyContext = {};
  const missing: string[] = [];

  for (const name of dependencyNames) {
    const dep = rows.find((r) => r.name === name);

    if (!dep || !dep.definition || dep.fillMetadata?.status !== "completed") {
      missing.push(name);
      continue;
    }

    // Require clean assessment
    if (dep.fillMetadata?.originalityAssessmentId) {
      // Has assessment — check lineage currency
      if (dep.fillMetadata.originalityLineage && !isOriginalityLineageCurrent(dep.fillMetadata.originalityLineage, currentLineage)) {
        missing.push(name);
        continue;
      }
    }

    context[name] = dep.definition;
  }

  if (missing.length > 0) {
    throw new PlaceholderDependencyError(missing, `Unresolved dependencies: ${missing.join(", ")}`);
  }

  return context;
}
