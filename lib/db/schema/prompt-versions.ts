import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { prompts } from "./prompts";

export const promptVersions = pgTable("prompt_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  // References prompts.id — both template (projectId=NULL) and project (projectId set)
  promptId: uuid("prompt_id")
    .notNull()
    .references(() => prompts.id, { onDelete: "cascade" }),
  // Defaults for schema transition; P3-T2 code sets real values.
  revisionNumber: integer("revision_number").notNull().default(1),
  title: text("title").notNull(),
  content: text("content").notNull(),
  userPrompt: text("user_prompt"),
  snapshot: jsonb("snapshot").notNull().$type<ChapterPromptSnapshot>().default({} as ChapterPromptSnapshot),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_prompt_versions_prompt_id").on(table.promptId),
]);

export interface ChapterPromptSnapshot {
  title: string;
  content: string;
  userPrompt: string | null;
  position: number | null;
  isAssembly: boolean | null;
  isCritique: boolean | null;
  isCorrector: boolean | null;
  function: string | null;
  notes: string | null;
  sourceContext: string | null;
  legacyIncomplete?: boolean;
  templatePipelineRunId?: string | null;
  templateArtifactHash?: string | null;
}

export type PromptVersion = typeof promptVersions.$inferSelect;
export type NewPromptVersion = typeof promptVersions.$inferInsert;
