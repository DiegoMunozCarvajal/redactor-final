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

export async function getChapterPlaceholders(chapterId: string): Promise<Record<string, string>> {
  const rows = await db
    .select()
    .from(chapterPlaceholders)
    .where(eq(chapterPlaceholders.chapterId, chapterId));

  const map: Record<string, string> = {};
  for (const row of rows) {
    if (row.definition) {
      map[row.name] = row.definition;
    }
  }
  return map;
}
