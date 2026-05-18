import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { bookTemplates } from "./book-templates";
import { projects } from "./projects";

export const chapters = pgTable("chapters", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookTemplateId: uuid("book_template_id").references(() => bookTemplates.id, {
    onDelete: "set null",
  }),
  projectId: uuid("project_id").references(() => projects.id, {
    onDelete: "cascade",
  }),
  position: integer("position").notNull(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Chapter = typeof chapters.$inferSelect;
export type NewChapter = typeof chapters.$inferInsert;
