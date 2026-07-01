import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const generationSystemPrompts = pgTable("generation_system_prompts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  content: text("content").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GenerationSystemPrompt = typeof generationSystemPrompts.$inferSelect;
export type NewGenerationSystemPrompt = typeof generationSystemPrompts.$inferInsert;
