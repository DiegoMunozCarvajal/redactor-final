import { index, jsonb, pgTable, text, timestamp, uuid, integer, unique, primaryKey } from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { bookTemplates } from "./book-templates";
import { chapters } from "./chapters";
import { chapterGenerations } from "./chapter-generations";
import { promptVersions } from "./prompt-versions";

export const promptKindValues = [
  "generation-system",
  "assembly-planner",
  "assembly",
  "critique",
  "corrector",
  "title",
  "placeholder-fill",
  "editorial-brief-extractor",
  "rhetoric-trace",
  "template-generator",
  "source-risk-profiler",
] as const;

export type PromptKind = (typeof promptKindValues)[number];

export const promptDefinitions = pgTable(
  "prompt_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    createdBy: uuid("created_by"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_prompt_definitions_kind").on(table.kind),
  ],
);

export const promptRevisions = pgTable(
  "prompt_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    promptDefinitionId: uuid("prompt_definition_id")
      .notNull()
      .references(() => promptDefinitions.id, { onDelete: "restrict" }),
    revisionNumber: integer("revision_number").notNull(),
    versionLabel: text("version_label").notNull(),
    systemTemplate: text("system_template").notNull(),
    userTemplate: text("user_template").notNull(),
    requiredMarkers: jsonb("required_markers").$type<string[]>().notNull().default([]),
    outputContract: text("output_contract"),
    configuration: jsonb("configuration")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.promptDefinitionId, table.revisionNumber),
    unique().on(table.promptDefinitionId, table.versionLabel),
    index("idx_prompt_revisions_definition").on(table.promptDefinitionId, table.revisionNumber),
  ],
);

export const promptDefaults = pgTable("prompt_defaults", {
  kind: text("kind").primaryKey(),
  promptRevisionId: uuid("prompt_revision_id")
    .notNull()
    .references(() => promptRevisions.id, { onDelete: "restrict" }),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projectPromptBindings = pgTable(
  "project_prompt_bindings",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    promptRevisionId: uuid("prompt_revision_id")
      .notNull()
      .references(() => promptRevisions.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.kind] }),
  ],
);

export const llmPromptExecutions = pgTable(
  "llm_prompt_executions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    bookTemplateId: uuid("book_template_id").references(() => bookTemplates.id, {
      onDelete: "cascade",
    }),
    chapterId: uuid("chapter_id").references(() => chapters.id, { onDelete: "cascade" }),
    chapterGenerationId: uuid("chapter_generation_id").references(() => chapterGenerations.id, {
      onDelete: "cascade",
    }),
    stage: text("stage").notNull(),
    promptRevisionId: uuid("prompt_revision_id").references(() => promptRevisions.id, {
      onDelete: "set null",
    }),
    chapterPromptRevisionId: uuid("chapter_prompt_revision_id").references(() => promptVersions.id, {
      onDelete: "restrict",
    }),
    model: text("model").notNull(),
    provider: text("provider").notNull(),
    messages: jsonb("messages").$type<unknown[]>().notNull(),
    dataManifest: jsonb("data_manifest")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    outputContract: text("output_contract"),
    technicalPolicies: jsonb("technical_policies").$type<string[]>().notNull().default([]),
    providerPayloadManifest: jsonb("provider_payload_manifest")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    status: text("status").notNull().default("started"),
    usage: jsonb("usage").$type<Record<string, unknown>>(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_llm_prompt_executions_generation").on(table.chapterGenerationId, table.createdAt),
    index("idx_llm_prompt_executions_template").on(table.bookTemplateId, table.createdAt),
  ],
);

export type PromptDefinition = typeof promptDefinitions.$inferSelect;
export type NewPromptDefinition = typeof promptDefinitions.$inferInsert;
export type PromptRevision = typeof promptRevisions.$inferSelect;
export type NewPromptRevision = typeof promptRevisions.$inferInsert;
export type PromptDefault = typeof promptDefaults.$inferSelect;
export type NewPromptDefault = typeof promptDefaults.$inferInsert;
export type ProjectPromptBinding = typeof projectPromptBindings.$inferSelect;
export type NewProjectPromptBinding = typeof projectPromptBindings.$inferInsert;
export type LlmPromptExecution = typeof llmPromptExecutions.$inferSelect;
export type NewLlmPromptExecution = typeof llmPromptExecutions.$inferInsert;
