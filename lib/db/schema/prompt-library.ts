import { pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";

export const promptLibrary = pgTable("prompt_library", {
  id: uuid("id").primaryKey().defaultRandom(),
  category: text("category").notNull(), // "assembly" | "critique" | "corrector"
  name: text("name").notNull(),
  description: text("description"),
  content: text("content").notNull(),
  userPrompt: text("user_prompt"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_prompt_library_category").on(table.category),
]);

export type PromptLibrary = typeof promptLibrary.$inferSelect;
export type NewPromptLibrary = typeof promptLibrary.$inferInsert;
