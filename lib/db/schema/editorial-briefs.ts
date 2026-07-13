import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { chapters } from "./chapters";
import { sources } from "./sources";

export const editorialBriefStatusEnum = pgEnum("editorial_brief_status", [
  "draft",
  "approved",
  "archived",
]);

export const editorialBriefs = pgTable(
  "editorial_briefs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: editorialBriefStatusEnum("status").notNull().default("draft"),
    content: jsonb("content").notNull(),
    contentHash: text("content_hash").notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_editorial_briefs_project_version").on(table.projectId, table.version),
    uniqueIndex("uq_editorial_briefs_project_draft")
      .on(table.projectId)
      .where(sql`status = 'draft'`),
    uniqueIndex("uq_editorial_briefs_project_approved")
      .on(table.projectId)
      .where(sql`status = 'approved'`),
    check("chk_editorial_briefs_version", sql`${table.version} > 0`),
    check(
      "chk_editorial_briefs_content_hash",
      sql`${table.contentHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const chapterEditorialContracts = pgTable(
  "chapter_editorial_contracts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    editorialBriefId: uuid("editorial_brief_id")
      .notNull()
      .references(() => editorialBriefs.id, { onDelete: "cascade" }),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    content: jsonb("content").notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_chapter_editorial_contracts_brief_chapter").on(
      table.editorialBriefId,
      table.chapterId,
    ),
    index("idx_chapter_editorial_contracts_brief").on(table.editorialBriefId),
    check(
      "chk_contracts_content_hash",
      sql`${table.contentHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const editorialBriefSources = pgTable(
  "editorial_brief_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    editorialBriefId: uuid("editorial_brief_id")
      .notNull()
      .references(() => editorialBriefs.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "restrict" }),
    useForExtraction: boolean("use_for_extraction").notNull().default(true),
    useForEvidence: boolean("use_for_evidence").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_editorial_brief_sources_brief_source").on(
      table.editorialBriefId,
      table.sourceId,
    ),
    index("idx_editorial_brief_sources_brief").on(table.editorialBriefId),
  ],
);

export type EditorialBrief = typeof editorialBriefs.$inferSelect;
export type NewEditorialBrief = typeof editorialBriefs.$inferInsert;
export type ChapterEditorialContract = typeof chapterEditorialContracts.$inferSelect;
export type NewChapterEditorialContract = typeof chapterEditorialContracts.$inferInsert;
export type EditorialBriefSource = typeof editorialBriefSources.$inferSelect;
export type NewEditorialBriefSource = typeof editorialBriefSources.$inferInsert;
