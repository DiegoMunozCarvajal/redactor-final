import { integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { chapters } from "./chapters";
import { promptTypeEnum } from "./prompts";

export const projectPrompts = pgTable("project_prompts", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  chapterId: uuid("chapter_id")
    .notNull()
    .references(() => chapters.id, { onDelete: "restrict" }),
  position: integer("position").notNull(),
  type: promptTypeEnum("type").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("idx_project_prompts_chapter_position").on(table.chapterId, table.position),
]);

export type ProjectPrompt = typeof projectPrompts.$inferSelect;
export type NewProjectPrompt = typeof projectPrompts.$inferInsert;
