import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const critiquePrompts = pgTable("critique_prompts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  content: text("content").notNull(),
  userPrompt: text("user_prompt"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CritiquePrompt = typeof critiquePrompts.$inferSelect;
export type NewCritiquePrompt = typeof critiquePrompts.$inferInsert;
