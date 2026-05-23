// lib/placeholders.ts
import { db } from "@/lib/db";
import { chapterPlaceholders } from "@/lib/db/schema";
import { eq, notInArray, and } from "drizzle-orm";

const PLACEHOLDER_RE = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

export function extractPlaceholders(contents: string[]): string[] {
  const names = new Set<string>();
  for (const content of contents) {
    for (const match of content.matchAll(PLACEHOLDER_RE)) {
      names.add(match[1]);
    }
  }
  return [...names];
}

export async function syncChapterPlaceholders(
  chapterId: string,
  promptContents: string[],
) {
  const detected = extractPlaceholders(promptContents);

  await db.transaction(async (tx) => {
    // Delete rows no longer referenced
    if (detected.length > 0) {
      await tx
        .delete(chapterPlaceholders)
        .where(
          and(
            eq(chapterPlaceholders.chapterId, chapterId),
            notInArray(chapterPlaceholders.name, detected),
          ),
        );
    } else {
      await tx
        .delete(chapterPlaceholders)
        .where(eq(chapterPlaceholders.chapterId, chapterId));
      return;
    }

    // Batch upsert detected names (keep existing definitions)
    await tx
      .insert(chapterPlaceholders)
      .values(detected.map((name) => ({ chapterId, name })))
      .onConflictDoNothing();
  });
}

export async function getChapterPlaceholders(chapterId: string, projectTopic?: string | null): Promise<Record<string, string>> {
  const rows = await db
    .select()
    .from(chapterPlaceholders)
    .where(eq(chapterPlaceholders.chapterId, chapterId));

  const map: Record<string, string> = {};
  for (const row of rows) {
    if (row.definition) {
      map[row.name] = row.definition;
    } else if (row.name === "tema" && projectTopic) {
      map[row.name] = projectTopic;
    }
  }
  return map;
}

/**
 * Resolve placeholders directly from project/chapter data without LLM calls.
 * Only handles placeholders whose value already exists elsewhere in the system.
 * Returns resolved definitions and the list of placeholders that still need the LLM filler.
 */
export function resolvePlaceholdersDirect(
  placeholderNames: string[],
  projectTopic: string | null,
  chapterBrief: string,
): { resolved: Record<string, string>; unresolved: string[] } {
  const resolved: Record<string, string> = {};
  const unresolved: string[] = [];

  for (const name of placeholderNames) {
    const lower = name.toLowerCase();

    // {TEMA}, {TEMA_DEL_LIBRO}, {TOPIC}, etc. — split by underscore to avoid "sistema" matching "tema"
    const segments = lower.split("_");
    if ((segments.includes("tema") || segments.includes("topic")) && projectTopic) {
      resolved[name] = projectTopic;
      continue;
    }

    // {LECTOR_OBJETIVO}, {AUDIENCIA}, {LECTOR}, {AUDIENCE}, etc.
    if (
      segments.includes("lector") ||
      segments.includes("audiencia") ||
      segments.includes("audience")
    ) {
      const extracted = extractLectorFromBrief(chapterBrief);
      if (extracted) {
        resolved[name] = extracted;
        continue;
      }
    }

    unresolved.push(name);
  }

  return { resolved, unresolved };
}

/**
 * Extract the reader/audience description from a chapter brief.
 * The brief follows the format: "ALCANCE. LECTOR. RESULTADO."
 * Tries to find the sentence most relevant to the reader.
 */
function extractLectorFromBrief(brief: string): string | null {
  if (!brief) return null;

  // Split into sentences (Spanish sentence boundaries)
  const sentences = brief
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.trim().length > 0);

  // Look for sentence with reader/audience keywords
  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    if (
      lower.includes("lector") ||
      lower.includes("audiencia") ||
      lower.includes("dirigido") ||
      lower.includes("público") ||
      lower.includes("para quién") ||
      lower.includes("está escrito")
    ) {
      return sentence.trim();
    }
  }

  // Fallback: second sentence often describes the reader in 3-part brief format
  if (sentences.length >= 2) {
    const second = sentences[1].trim();
    // Only use if it doesn't look like scope/outcome
    if (
      !second.toLowerCase().includes("alcance") &&
      !second.toLowerCase().includes("resultado")
    ) {
      return second;
    }
  }

  return null;
}
