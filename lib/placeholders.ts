// lib/placeholders.ts
import { db } from "@/lib/db";
import { chapterPlaceholders } from "@/lib/db/schema";
import { eq, inArray, and } from "drizzle-orm";
import {
  extractPlaceholders,
  getMissingPlaceholderNames,
  getPlaceholderNamesToDelete,
} from "@/lib/placeholder-utils";

export { extractPlaceholders, getMissingPlaceholderNames, getPlaceholderNamesToDelete };

export async function syncChapterPlaceholders(
  chapterId: string,
  promptContents: string[],
) {
  const detected = extractPlaceholders(promptContents);

  await db.transaction(async (tx) => {
    const existingRows = await tx
      .select({
        name: chapterPlaceholders.name,
        definition: chapterPlaceholders.definition,
        function: chapterPlaceholders.function,
        notes: chapterPlaceholders.notes,
      })
      .from(chapterPlaceholders)
      .where(eq(chapterPlaceholders.chapterId, chapterId));

    // Delete only unfilled rows no longer referenced. Filled rows carry user
    // work and must survive prompt syncs/refreshes.
    const namesToDelete = getPlaceholderNamesToDelete(existingRows, detected);
    if (namesToDelete.length > 0) {
      await tx
        .delete(chapterPlaceholders)
        .where(
          and(
            eq(chapterPlaceholders.chapterId, chapterId),
            inArray(chapterPlaceholders.name, namesToDelete),
          ),
        );
    }

    // Batch upsert detected names (keep existing definitions)
    if (detected.length > 0) {
      await tx
        .insert(chapterPlaceholders)
        .values(detected.map((name) => ({ chapterId, name })))
        .onConflictDoNothing();
    }
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
    // These require LLM filling — no longer resolved from chapter brief.
    if (
      segments.includes("lector") ||
      segments.includes("audiencia") ||
      segments.includes("audience")
    ) {
      unresolved.push(name);
      continue;
    }

    unresolved.push(name);
  }

  return { resolved, unresolved };
}
