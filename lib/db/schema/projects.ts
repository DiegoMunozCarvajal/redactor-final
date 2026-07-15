import { index, pgSchema, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { bookTemplates } from "./book-templates";

const authSchema = pgSchema("auth");
const authUsers = authSchema.table("users", {
  id: uuid("id").notNull(),
});

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    topic: text("topic"),
    bookTemplateId: uuid("book_template_id").references(() => bookTemplates.id, {
      onDelete: "restrict",
    }),
    title: text("title"),
    subtitle: text("subtitle"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
  },
  (table) => [index("idx_projects_user").on(table.userId)],
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
