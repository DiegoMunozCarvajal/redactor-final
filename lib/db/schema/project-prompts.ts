import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
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

export type ProjectPrompt = typeof projectPrompts.$inferSelect;
export type NewProjectPrompt = typeof projectPrompts.$inferInsert;
