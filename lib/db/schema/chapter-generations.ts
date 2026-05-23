import { index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { chapters } from "./chapters";

export const generationStatusEnum = pgEnum("generation_status", [
  "pending",
  "generating",
  "assembling",
  "completed",
  "failed",
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
    assembledContent: text("assembled_content"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [index("idx_chapter_generations_project").on(table.projectId, table.chapterId)],
);

export type ChapterGeneration = typeof chapterGenerations.$inferSelect;
export type NewChapterGeneration = typeof chapterGenerations.$inferInsert;
