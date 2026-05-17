import { integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
  styleRules: text("style_rules"),
  knowledgeAreas: text("knowledge_areas"),
  suggestedLength: text("suggested_length"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Prompt = typeof prompts.$inferSelect;
export type NewPrompt = typeof prompts.$inferInsert;
