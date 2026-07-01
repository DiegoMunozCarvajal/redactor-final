import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { bookTemplates } from "./book-templates";
import { projects } from "./projects";

export const chapters = pgTable(
  "chapters",
  {
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
  },
  (table) => [
    index("idx_chapters_template").on(table.bookTemplateId, table.position),
    index("idx_chapters_project").on(table.projectId),
    uniqueIndex("uq_chapters_project_position").on(table.projectId, table.position),
    check("chk_chapter_parent", sql`book_template_id IS NOT NULL OR project_id IS NOT NULL`),
  ],
);

export type Chapter = typeof chapters.$inferSelect;
export type NewChapter = typeof chapters.$inferInsert;
