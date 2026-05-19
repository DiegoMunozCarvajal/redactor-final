import { integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { chapters } from "./chapters";

export const promptTypeEnum = pgEnum("prompt_type", [
  "apertura",
  "modelo",
  "contraste",
  "amplificacion",
  "anecdota",
  "acumulacion",
  "proceso",
  "cierre",
  "ensamblaje",
]);

export const prompts = pgTable("prompts", {
  id: uuid("id").primaryKey().defaultRandom(),
  chapterId: uuid("chapter_id")
    .notNull()
    .references(() => chapters.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  type: promptTypeEnum("type").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("idx_prompts_chapter_position").on(table.chapterId, table.position),
]);

export type Prompt = typeof prompts.$inferSelect;
export type NewPrompt = typeof prompts.$inferInsert;
