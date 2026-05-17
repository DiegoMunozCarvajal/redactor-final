import { index, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { runs } from "./runs";
import { chapters } from "./chapters";

export const chapterRunStatusEnum = pgEnum("chapter_run_status", [
  "pending",
  "generating_fragments",
  "assembling",
  "completed",
  "failed",
]);

export const chapterRuns = pgTable(
  "chapter_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    status: chapterRunStatusEnum("status").notNull().default("pending"),
    assembledContent: text("assembled_content"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_chapter_runs_run").on(table.runId)],
);

export type ChapterRun = typeof chapterRuns.$inferSelect;
export type NewChapterRun = typeof chapterRuns.$inferInsert;
