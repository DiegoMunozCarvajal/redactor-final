import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { chapters } from "./chapters";

export const chapterConfigPrompts = pgTable(
  "chapter_config_prompts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // 'fill_placeholders' | 'generate_brief'
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("idx_config_prompts_unique").on(table.chapterId, table.type)],
);

export type ChapterConfigPrompt = typeof chapterConfigPrompts.$inferSelect;
export type NewChapterConfigPrompt = typeof chapterConfigPrompts.$inferInsert;
