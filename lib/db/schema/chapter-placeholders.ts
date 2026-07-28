import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { chapters } from "./chapters";
import type { PlaceholderFillMetadata } from "@/lib/placeholder-fill-metadata";

export const chapterPlaceholders = pgTable(
  "chapter_placeholders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    definition: text("definition"),
    function: text("function"),
    notes: text("notes"),
    definitionOrigin: text("definition_origin").notNull().default("legacy"),
    // FK to template_pipeline_runs enforced via SQL migration.
    // Raw UUID column avoids import cycle with template-pipeline.ts.
    templatePipelineRunId: uuid("template_pipeline_run_id"),
    templateArtifactHash: text("template_artifact_hash"),
    dependencyNames: text("dependency_names").array().notNull().default([]),
    fillMetadata: jsonb("fill_metadata").$type<PlaceholderFillMetadata>(),
    // FK to placeholder_versions enforced via SQL migration.
    // No Drizzle `references()` call to avoid circular import between
    // chapter-placeholders and placeholder-versions.
    activeVersionId: uuid("active_version_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("idx_chapter_placeholders_unique").on(table.chapterId, table.name)],
);

export type ChapterPlaceholder = typeof chapterPlaceholders.$inferSelect;
export type NewChapterPlaceholder = typeof chapterPlaceholders.$inferInsert;
