import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const bookTemplates = pgTable("book_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BookTemplate = typeof bookTemplates.$inferSelect;
export type NewBookTemplate = typeof bookTemplates.$inferInsert;
