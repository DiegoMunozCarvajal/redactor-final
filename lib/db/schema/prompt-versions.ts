import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const promptVersions = pgTable("prompt_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Stores both prompts.id (template) and projectPrompts.id (project-scoped) — no FK
  promptId: uuid("prompt_id").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PromptVersion = typeof promptVersions.$inferSelect;
export type NewPromptVersion = typeof promptVersions.$inferInsert;
