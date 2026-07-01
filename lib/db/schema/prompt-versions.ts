import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { prompts } from "./prompts";

export const promptVersions = pgTable("prompt_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  // References prompts.id — both template (projectId=NULL) and project (projectId set)
  promptId: uuid("prompt_id")
    .notNull()
    .references(() => prompts.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  content: text("content").notNull(),
  userPrompt: text("user_prompt"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_prompt_versions_prompt_id").on(table.promptId),
]);

export type PromptVersion = typeof promptVersions.$inferSelect;
export type NewPromptVersion = typeof promptVersions.$inferInsert;
