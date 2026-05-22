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

  // Delete rows no longer referenced
  if (detected.length > 0) {
    await db
      .delete(chapterPlaceholders)
      .where(
        and(
          eq(chapterPlaceholders.chapterId, chapterId),
          notInArray(chapterPlaceholders.name, detected),
        ),
      );
  } else {
    await db
      .delete(chapterPlaceholders)
      .where(eq(chapterPlaceholders.chapterId, chapterId));
    return;
  }

  // Upsert detected names (keep existing definitions)
  for (const name of detected) {
    await db
      .insert(chapterPlaceholders)
      .values({ chapterId, name })
      .onConflictDoNothing();
  }
}
