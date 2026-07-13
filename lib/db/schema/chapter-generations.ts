import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { chapters } from "./chapters";

export const generationStatusEnum = pgEnum("generation_status", [
  "pending",
  "generating",
  "assembling",
  "completed",
  "failed",
  "awaiting_assembly",
]);

export const chapterGenerations = pgTable(
  "chapter_generations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    status: generationStatusEnum("status").notNull().default("pending"),
    generationMetadata: jsonb("generation_metadata").$type<{
      type?: string;
      promptId?: string;
      promptTitle?: string;
      model?: string;
      provider?: string;
      effort?: string;
      algorithm?: string;
      fragmentIds?: string[];
      assemblyPromptId?: string;
      critiqueGenerationId?: string;
      editorialBriefId?: string;
      editorialBriefVersion?: number;
      editorialBriefHash?: string;
    }>(),
    assembledContent: text("assembled_content"),
    assemblyMetadata: jsonb("assembly_metadata").$type<{
      algorithm?: "merge-sort" | "sequential" | "halves" | "critique" | "correction";
      promptId?: string;
      promptTitle?: string;
      promptSource?: string;
      model?: string;
      fragmentCount?: number;
      critiqueGenerationId?: string;
      correctionRaw?: string;
      tokensUsed?: number;
      costUsd?: number;
      durationMs?: number;
    }>(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_chapter_generations_project").on(table.projectId, table.chapterId),
    // Rate-limit queries filter on (projectId, status, createdAt)
    index("idx_chapter_generations_rate_limit").on(table.projectId, table.status, table.createdAt),
    // Content lookup for critique/correction: latest completed per chapter
    index("idx_chapter_generations_content_lookup").on(table.projectId, table.chapterId, table.status, table.completedAt),
  ],
);

export type ChapterGeneration = typeof chapterGenerations.$inferSelect;
export type NewChapterGeneration = typeof chapterGenerations.$inferInsert;
