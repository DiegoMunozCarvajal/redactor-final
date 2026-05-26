import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const metaPrompts = pgTable("meta_prompts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  content: text("content").notNull(),
  userPrompt: text("user_prompt"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MetaPrompt = typeof metaPrompts.$inferSelect;
export type NewMetaPrompt = typeof metaPrompts.$inferInsert;
