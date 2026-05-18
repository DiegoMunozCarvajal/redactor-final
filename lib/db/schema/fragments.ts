import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { chapterRuns } from "./chapter-runs";
import { prompts } from "./prompts";
import { chapterGenerations } from "./chapter-generations";
import { projectPrompts } from "./project-prompts";

export const fragments = pgTable(
  "fragments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chapterRunId: uuid("chapter_run_id")
      .references(() => chapterRuns.id, { onDelete: "cascade" }),
    promptId: uuid("prompt_id")
      .references(() => prompts.id, { onDelete: "restrict" }),
    chapterGenerationId: uuid("chapter_generation_id")
      .references(() => chapterGenerations.id, { onDelete: "cascade" }),
    projectPromptId: uuid("project_prompt_id")
      .references(() => projectPrompts.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    content: text("content"),
    metadata: jsonb("metadata"),
    modelUsed: text("model_used"),
    tokensUsed: integer("tokens_used"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_fragments_chapter_run").on(table.chapterRunId),
    index("idx_fragments_chapter_generation").on(table.chapterGenerationId),
  ],
);

export type Fragment = typeof fragments.$inferSelect;
export type NewFragment = typeof fragments.$inferInsert;
