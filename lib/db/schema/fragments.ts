import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { chapterGenerations } from "./chapter-generations";
import { projectPrompts } from "./project-prompts";

export const fragments = pgTable(
  "fragments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chapterGenerationId: uuid("chapter_generation_id")
      .notNull()
      .references(() => chapterGenerations.id, { onDelete: "cascade" }),
    projectPromptId: uuid("project_prompt_id")
      .notNull()
      .references(() => projectPrompts.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    content: text("content"),
    metadata: jsonb("metadata"),
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

// fragmentMetadataSchema and FragmentMetadata removed — unused.
// The `metadata` jsonb column is typed as unknown in application code.
