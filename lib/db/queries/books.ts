import { db } from "@/lib/db";
import { bookTemplates, chapters, prompts } from "@/lib/db/schema";
import { eq, asc, inArray } from "drizzle-orm";

export async function getBookTemplateWithChapters(bookTemplateId: string) {
  const template = await db
    .select()
    .from(bookTemplates)
    .where(eq(bookTemplates.id, bookTemplateId))
    .limit(1);

  if (!template.length) return null;

  const chapterList = await db
    .select()
    .from(chapters)
    .where(eq(chapters.bookTemplateId, bookTemplateId))
    .orderBy(asc(chapters.position));

  return { ...template[0], chapters: chapterList };
}

export async function getChapterWithPrompts(chapterId: string) {
  const chapter = await db
    .select()
    .from(chapters)
    .where(eq(chapters.id, chapterId))
    .limit(1);

  if (!chapter.length) return null;

  const promptList = await db
    .select()
    .from(prompts)
    .where(eq(prompts.chapterId, chapterId))
    .orderBy(asc(prompts.position));

  return { ...chapter[0], prompts: promptList };
}

export async function getFullBookTemplate(bookTemplateId: string) {
  const template = await getBookTemplateWithChapters(bookTemplateId);
  if (!template) return null;

  // Batch-load all prompts for all chapters in one query instead of N+1
  const chapterIds = template.chapters.map((c) => c.id);
  const allPrompts = await db
    .select()
    .from(prompts)
    .where(inArray(prompts.chapterId, chapterIds))
    .orderBy(asc(prompts.position));

  const promptsByChapter = new Map<string, typeof allPrompts>();
  for (const p of allPrompts) {
    const list = promptsByChapter.get(p.chapterId);
    if (list) {
      list.push(p);
    } else {
      promptsByChapter.set(p.chapterId, [p]);
    }
  }

  const chaptersWithPrompts = template.chapters.map((ch) => ({
    ...ch,
    prompts: promptsByChapter.get(ch.id) ?? [],
  }));

  return { ...template, chapters: chaptersWithPrompts };
}
