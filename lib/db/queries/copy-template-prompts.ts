import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { prompts, chapterPlaceholders } from "@/lib/db/schema";
import { eq, asc, inArray, isNull, and } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { writeCurrentChapterPromptRevision } from "@/lib/prompts/chapter-revisions";

type Tx = PostgresJsDatabase<typeof schema>;

/**
 * Copy template prompts from a template chapter to a project chapter.
 * Also copies chapter placeholders (names only, no definitions) and creates
 * an immutable prompt_versions snapshot for each copied prompt so
 * currentRevisionId is never null.
 *
 * Used by project creation (projects/route.ts) and chapter addition
 * (projects/[id]/chapters/route.ts). Having this in one place eliminates
 * the risk of field-mapping drift between the two routes.
 */
export async function copyTemplatePromptsToChapter(
  tx: Tx,
  templateChapterId: string,
  projectId: string,
  projectChapterId: string,
  userId: string,
): Promise<void> {
  // Copy prompts
  const templatePrompts = await tx
    .select()
    .from(prompts)
    .where(
      and(
        eq(prompts.chapterId, templateChapterId),
        isNull(prompts.projectId),
      ),
    )
    .orderBy(asc(prompts.position));

  if (templatePrompts.length > 0) {
    const inserted = await tx.insert(prompts).values(
      templatePrompts.map((p) => ({
        projectId,
        chapterId: projectChapterId,
        position: p.position,
        isAssembly: p.isAssembly,
        isCritique: p.isCritique,
        isCorrector: p.isCorrector,
        title: p.title,
        content: p.content,
        userPrompt: p.userPrompt,
        function: p.function,
        notes: p.notes,
        sourceContext: p.sourceContext,
      })),
    ).returning({ id: prompts.id });

    // Create immutable prompt_versions snapshot for each copied prompt.
    // Without this, currentRevisionId is null and fragment generation fails.
    for (const prompt of inserted) {
      await writeCurrentChapterPromptRevision(prompt.id, userId, tx);
    }
  }

  // Copy placeholders (names only, no definitions).
  // Deduplicate by lowercase name — template chapters may have both "foo" and
  // "FOO" from the pre-lowercase-extraction era. First function/notes wins.
  const templatePlaceholders = await tx
    .select()
    .from(chapterPlaceholders)
    .where(eq(chapterPlaceholders.chapterId, templateChapterId));

  if (templatePlaceholders.length > 0) {
    const seen = new Map<
      string,
      { chapterId: string; name: string; function: string | null; notes: string | null }
    >();
    for (const ph of templatePlaceholders) {
      const key = ph.name.toLowerCase();
      if (!seen.has(key)) {
        seen.set(key, {
          chapterId: projectChapterId,
          name: key,
          function: ph.function,
          notes: ph.notes,
        });
      }
    }
    await tx.insert(chapterPlaceholders).values(Array.from(seen.values()));
  }
}

/**
 * Batch copy placeholders from multiple template chapters to project chapters.
 * Deduplicates by (chapterId, lowerName) — first function/notes wins.
 */
export async function copyTemplatePlaceholdersBatch(
  tx: Tx,
  chapterIdMap: Map<string, string>, // template chapter id → project chapter id
): Promise<void> {
  const allTemplateChapterIds = Array.from(chapterIdMap.keys());
  if (allTemplateChapterIds.length === 0) return;

  const templatePlaceholders = await tx
    .select()
    .from(chapterPlaceholders)
    .where(inArray(chapterPlaceholders.chapterId, allTemplateChapterIds));

  // Group by (projectChapterId, lowerName) — first function/notes wins
  const grouped = new Map<
    string,
    { chapterId: string; name: string; function: string | null; notes: string | null }
  >();

  for (const ph of templatePlaceholders) {
    const projectChapterId = chapterIdMap.get(ph.chapterId);
    if (!projectChapterId) continue;
    const key = `${projectChapterId}:${ph.name.toLowerCase()}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        chapterId: projectChapterId,
        name: ph.name.toLowerCase(),
        function: ph.function,
        notes: ph.notes,
      });
    }
  }

  if (grouped.size > 0) {
    await tx.insert(chapterPlaceholders).values(Array.from(grouped.values()));
  }
}
