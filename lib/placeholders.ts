// lib/placeholders.ts
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";
import { db } from "@/lib/db";
import { chapterPlaceholders, placeholderVersions } from "@/lib/db/schema";
import { eq, inArray, and, asc } from "drizzle-orm";
import {
  extractPlaceholders,
  getMissingPlaceholderNames,
  getPlaceholderNamesToDelete,
} from "@/lib/placeholder-utils";

export { extractPlaceholders, getMissingPlaceholderNames, getPlaceholderNamesToDelete };

type DbOrTx = PostgresJsDatabase<typeof schema>;

export async function syncChapterPlaceholders(
  chapterId: string,
  promptContents: string[],
  projectTopic?: string | null,
  parentTx?: DbOrTx,
) {
  const detected = extractPlaceholders(promptContents);

  const doSync = async (tx: DbOrTx) => {
    const existingRows = await tx
      .select({
        name: chapterPlaceholders.name,
        definition: chapterPlaceholders.definition,
        function: chapterPlaceholders.function,
        notes: chapterPlaceholders.notes,
      })
      .from(chapterPlaceholders)
      .where(eq(chapterPlaceholders.chapterId, chapterId));

    // Deduplicate case variants: if an existing row differs only in case from a
    // detected name, migrate definitions to the lowercase canonical form and
    // delete the variant. This handles the {tema}/{TEMA}/{Tema} case after the
    // extractPlaceholders lowercasing fix.
    const detectedLower = new Set(detected.map((n) => n.toLowerCase()));
    const caseVariantNamesToDelete: string[] = [];
    const caseVariantDefsToInsert: { chapterId: string; name: string; definition?: string | null; function?: string | null; notes?: string | null }[] = [];
    const migratedNames = new Set<string>(); // prevent duplicate inserts for same canonical name

    for (const row of existingRows) {
      const lower = row.name.toLowerCase();
      if (lower !== row.name && detectedLower.has(lower) && !detected.includes(row.name)) {
        // Case variant: existing row has different case than canonical lowercase.
        if ((row.definition || row.function || row.notes) && !migratedNames.has(lower)) {
          // Migrate user data to lowercase canonical name (first variant wins)
          migratedNames.add(lower);
          caseVariantDefsToInsert.push({
            chapterId,
            name: lower,
            definition: row.definition,
            function: row.function,
            notes: row.notes,
          });
        }
        // Always delete the old case variant
        if (!caseVariantNamesToDelete.includes(row.name)) {
          caseVariantNamesToDelete.push(row.name);
        }
        // If the canonical lowercase already exists in detected, remove it
        // so the data-bearing migration insert isn't blocked by onConflictDoNothing.
        // Only do this when we have data to migrate — otherwise let the normal
        // insert at the end create the lowercase row.
        if (row.definition || row.function || row.notes) {
          if (detected.includes(lower)) {
            detected.splice(detected.indexOf(lower), 1);
          }
        }
      }
    }

    // Delete case variants first (they share the same (chapterId, name) unique
    // constraint as their lowercase canonical)
    if (caseVariantNamesToDelete.length > 0) {
      await tx
        .delete(chapterPlaceholders)
        .where(
          and(
            eq(chapterPlaceholders.chapterId, chapterId),
            inArray(chapterPlaceholders.name, caseVariantNamesToDelete),
          ),
        );
    }

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

    // Insert case-variant definitions under canonical lowercase names
    if (caseVariantDefsToInsert.length > 0) {
      await tx
        .insert(chapterPlaceholders)
        .values(caseVariantDefsToInsert)
        .onConflictDoNothing();
    }

    // Batch upsert detected names (keep existing definitions)
    if (detected.length > 0) {
      await tx
        .insert(chapterPlaceholders)
        .values(detected.map((name) => ({ chapterId, name })))
        .onConflictDoNothing();
    }

    // Auto-resolve tema variants from project topic (if provided)
    if (projectTopic) {
      const allRows = await tx
        .select({
          id: chapterPlaceholders.id,
          name: chapterPlaceholders.name,
          definition: chapterPlaceholders.definition,
        })
        .from(chapterPlaceholders)
        .where(eq(chapterPlaceholders.chapterId, chapterId));

      const unresolvedTemaNames = allRows.filter((r) => {
        if (r.definition) return false;
        const segments = r.name.toLowerCase().split("_");
        return segments.includes("tema") || segments.includes("topic");
      });

      for (const row of unresolvedTemaNames) {
        const [version] = await tx
          .insert(placeholderVersions)
          .values({
            placeholderId: row.id,
            definition: projectTopic,
            fillMetadata: {
              sources: [],
              filledAt: new Date().toISOString(),
              definitionOrigin: "system",
            },
          })
          .returning({ id: placeholderVersions.id });

        await tx
          .update(chapterPlaceholders)
          .set({
            definition: projectTopic,
            activeVersionId: version.id,
            definitionOrigin: "system",
          })
          .where(eq(chapterPlaceholders.id, row.id));
      }
    }
  };

  if (parentTx) {
    return doSync(parentTx);
  }
  return db.transaction(doSync);
}

export async function getChapterPlaceholders(chapterId: string, projectTopic?: string | null): Promise<Record<string, string>> {
  const rows = await db
    .select({
      name: chapterPlaceholders.name,
      definition: chapterPlaceholders.definition,
    })
    .from(chapterPlaceholders)
    .where(eq(chapterPlaceholders.chapterId, chapterId))
    .orderBy(asc(chapterPlaceholders.name));

  const map: Record<string, string> = {};
  for (const row of rows) {
    const key = row.name.toLowerCase();
    // Tema/topic variants: effectiveTopic (brief.centralTopic ?? project.topic)
    // wins over any persisted definition. The brief is canonical.
    const segments = key.split("_");
    const isTopicVariant = segments.includes("tema") || segments.includes("topic");

    if (isTopicVariant && projectTopic) {
      map[key] = projectTopic; // canonical — overrides legacy definitions
    } else if (row.definition) {
      map[key] = row.definition;
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
