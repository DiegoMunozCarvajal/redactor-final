import { db } from "@/lib/db";
import { bookTemplates, chapters, prompts } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";

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

  const chaptersWithPrompts = await Promise.all(
    template.chapters.map(async (ch) => getChapterWithPrompts(ch.id))
  );

  return { ...template, chapters: chaptersWithPrompts.filter(Boolean) };
}
