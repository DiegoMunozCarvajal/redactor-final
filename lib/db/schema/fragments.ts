import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { chapterGenerations } from "./chapter-generations";
import { prompts } from "./prompts";
import { promptVersions } from "./prompt-versions";
import { llmPromptExecutions } from "./prompt-registry";

/**
 * Shape of the `metadata` jsonb column on fragments.
 *
 * `extractedBlocks` holds [BLOCK_NAME] blocks stripped from fragment text
 * for cross-chapter editorial context. Other fields track generation metadata.
 */
export type FragmentMetadata = {
  provider?: string;
  costUsd?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  durationMs?: number;
  extractedBlocks?: Record<string, Record<string, string>>;
  /** Originality gate lineage metadata (set by the prompt-generation route). */
  originalityLineage?: unknown;
  originalityAssessmentId?: string;
};

export const fragments = pgTable(
  "fragments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chapterGenerationId: uuid("chapter_generation_id")
      .notNull()
      .references(() => chapterGenerations.id, { onDelete: "cascade" }),
    projectPromptId: uuid("project_prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    // FK to prompt_versions enforced via SQL migration. Nullable during transition.
    promptRevisionId: uuid("prompt_revision_id"),
    executionId: uuid("execution_id")
      .references(() => llmPromptExecutions.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    content: text("content"),
    metadata: jsonb("metadata").$type<FragmentMetadata>(),
    modelUsed: text("model_used"),
    tokensUsed: integer("tokens_used"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_fragments_chapter_generation").on(table.chapterGenerationId),
    index("idx_fragments_project_prompt").on(table.projectPromptId),
  ],
);

export type Fragment = typeof fragments.$inferSelect;
export type NewFragment = typeof fragments.$inferInsert;
