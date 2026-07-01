import { boolean, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { chapters } from "./chapters";
import { projects } from "./projects";

export const prompts = pgTable("prompts", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  chapterId: uuid("chapter_id")
    .notNull()
    .references(() => chapters.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  isAssembly: boolean("is_assembly").notNull().default(false),
  isCritique: boolean("is_critique").notNull().default(false),
  isCorrector: boolean("is_corrector").notNull().default(false),
  title: text("title").notNull(),
  content: text("content").notNull(),
  userPrompt: text("user_prompt"),
  function: text("function"),
  notes: text("notes"),
  sourceContext: text("source_context"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("idx_prompts_chapter_position").on(table.chapterId, table.position),
]);

export type Prompt = typeof prompts.$inferSelect;
export type NewPrompt = typeof prompts.$inferInsert;
