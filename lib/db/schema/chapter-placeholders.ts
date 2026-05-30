import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { chapters } from "./chapters";
import type { PlaceholderFillMetadata } from "@/lib/placeholder-fill-metadata";

export const chapterPlaceholders = pgTable(
  "chapter_placeholders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    definition: text("definition"),
    function: text("function"),
    notes: text("notes"),
    fillMetadata: jsonb("fill_metadata").$type<PlaceholderFillMetadata>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("idx_chapter_placeholders_unique").on(table.chapterId, table.name)],
);

export type ChapterPlaceholder = typeof chapterPlaceholders.$inferSelect;
export type NewChapterPlaceholder = typeof chapterPlaceholders.$inferInsert;
