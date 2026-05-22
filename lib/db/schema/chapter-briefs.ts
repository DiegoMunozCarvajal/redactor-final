import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { chapters } from "./chapters";

export const chapterBriefs = pgTable("chapter_briefs", {
  id: uuid("id").primaryKey().defaultRandom(),
  chapterId: uuid("chapter_id")
    .notNull()
    .references(() => chapters.id, { onDelete: "cascade" })
    .unique(),
  content: text("content"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ChapterBrief = typeof chapterBriefs.$inferSelect;
export type NewChapterBrief = typeof chapterBriefs.$inferInsert;
