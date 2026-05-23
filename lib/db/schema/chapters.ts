import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { bookTemplates } from "./book-templates";
import { projects } from "./projects";

// WARNING: DB has CHECK constraint chk_chapter_parent:
//   CHECK (book_template_id IS NOT NULL OR project_id IS NOT NULL)
// This constraint cannot be expressed in Drizzle pgTable. If regenerating
// migrations, re-add it manually.
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
  ],
);

export type Chapter = typeof chapters.$inferSelect;
export type NewChapter = typeof chapters.$inferInsert;
