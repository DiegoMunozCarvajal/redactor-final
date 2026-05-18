import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { z } from "zod";
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
      .references(() => projectPrompts.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    content: text("content"),
    metadata: jsonb("metadata"),
    modelUsed: text("model_used"),
    tokensUsed: integer("tokens_used"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_fragments_chapter_generation").on(table.chapterGenerationId),
  ],
);

export type Fragment = typeof fragments.$inferSelect;
export type NewFragment = typeof fragments.$inferInsert;

/**
 * Schema for the `metadata` jsonb column on fragments.
 * Currently holds the AI provider used to generate the content.
 * Optional and nullable — most fragments won't have metadata set.
 */
export const fragmentMetadataSchema = z.object({
  provider: z.string().optional(),
}).optional().nullable();

export type FragmentMetadata = z.infer<typeof fragmentMetadataSchema>;
