import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { bookTemplates } from "./book-templates";
import { chapters } from "./chapters";
// FK to prompt_revisions: enforced via SQL migration, raw UUID column in Drizzle
// to avoid import cycles from prompt-registry.ts ↔ template-pipeline.ts.

export const templatePipelineRunStatuses = [
  "running",
  "clean",
  "quarantined",
  "failed",
] as const;

export type TemplatePipelineRunStatus =
  (typeof templatePipelineRunStatuses)[number];

export const templatePipelineFailureStages = [
  "source_profile",
  "trace_classification",
  "trace_validation",
  "template_compilation",
  "template_validation",
  "finalization",
] as const;

export type TemplatePipelineFailureStage =
  (typeof templatePipelineFailureStages)[number];

export interface DistinctiveElement {
  id: string;
  kind:
    | "entity"
    | "number"
    | "formula"
    | "coined_term"
    | "named_framework"
    | "metaphor"
    | "anecdote"
    | "example"
    | "creative_sequence";
  canonicalLabel: string;
  aliases: string[];
  sourceChunkIndexes: number[];
  confidence: number;
  distinctiveness: number;
}

export const templatePipelineRuns = pgTable(
  "template_pipeline_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookTemplateId: uuid("book_template_id")
      .notNull()
      .references(() => bookTemplates.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("running"),
    pipelineVersion: text("pipeline_version").notNull(),
    compilerVersion: text("compiler_version"),
    compilerHash: text("compiler_hash"),
    recipeCatalogHash: text("recipe_catalog_hash"),
    // FK to prompt_revisions enforced via SQL migration.
    // Raw UUID column avoids import cycle with prompt-registry.ts.
    rhetoricTraceRevisionId: uuid("rhetoric_trace_revision_id"),
    sourceProfileVersion: text("source_profile_version"),
    originalityPolicyVersion: text("originality_policy_version").notNull(),
    failureStage: text("failure_stage"),
    report: jsonb("report").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("idx_template_pipeline_runs_template").on(
      table.bookTemplateId,
      table.createdAt.desc(),
    ),
  ],
);

export const templateSourceProfiles = pgTable(
  "template_source_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pipelineRunId: uuid("pipeline_run_id")
      .notNull()
      .references(() => templatePipelineRuns.id, { onDelete: "restrict" }),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "restrict" }),
    sourceHash: text("source_hash").notNull(),
    sourceLanguage: text("source_language").notNull(),
    profileVersion: text("profile_version").notNull(),
    distinctiveElements: jsonb("distinctive_elements")
      .notNull()
      .default([]),
    profileHash: text("profile_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_template_profiles_run").on(
      table.pipelineRunId,
      table.chapterId,
    ),
  ],
);

export const templateSourceProfileChunks = pgTable(
  "template_source_profile_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceProfileId: uuid("source_profile_id")
      .notNull()
      .references(() => templateSourceProfiles.id, { onDelete: "restrict" }),
    chunkIndex: integer("chunk_index").notNull(),
    contentHash: text("content_hash").notNull(),
    lexicalFingerprint: jsonb("lexical_fingerprint").notNull(),
    embedding: text("embedding").notNull(), // vector(1536) stored as text in Drizzle
    tokenCount: integer("token_count").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_template_profile_chunks_profile").on(
      table.sourceProfileId,
      table.chunkIndex,
    ),
  ],
);

export const templateRunArtifacts = pgTable(
  "template_run_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pipelineRunId: uuid("pipeline_run_id")
      .notNull()
      .references(() => templatePipelineRuns.id, { onDelete: "restrict" }),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "restrict" }),
    traceIr: jsonb("trace_ir").notNull(),
    compiledTemplate: jsonb("compiled_template").notNull(),
    artifactHash: text("artifact_hash").notNull(),
    sourceContent: text("source_content"),
    validationReport: jsonb("validation_report").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_template_run_artifacts").on(
      table.pipelineRunId,
      table.chapterId,
    ),
  ],
);

export type TemplatePipelineRun = typeof templatePipelineRuns.$inferSelect;
export type NewTemplatePipelineRun =
  typeof templatePipelineRuns.$inferInsert;
export type TemplateSourceProfile =
  typeof templateSourceProfiles.$inferSelect;
export type NewTemplateSourceProfile =
  typeof templateSourceProfiles.$inferInsert;
export type TemplateSourceProfileChunk =
  typeof templateSourceProfileChunks.$inferSelect;
export type NewTemplateSourceProfileChunk =
  typeof templateSourceProfileChunks.$inferInsert;
export type TemplateRunArtifact = typeof templateRunArtifacts.$inferSelect;
export type NewTemplateRunArtifact =
  typeof templateRunArtifacts.$inferInsert;
