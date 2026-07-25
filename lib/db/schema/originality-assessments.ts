import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { templatePipelineRuns } from "./template-pipeline";
import { projects } from "./projects";
import { chapters } from "./chapters";
import { chapterGenerations } from "./chapter-generations";

export const originalityAssessments = pgTable("originality_assessments", {
  id: uuid("id").primaryKey().defaultRandom(),
  scope: text("scope").notNull(),
  pipelineRunId: uuid("pipeline_run_id").references(() => templatePipelineRuns.id, { onDelete: "restrict" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  chapterId: uuid("chapter_id").references(() => chapters.id, { onDelete: "cascade" }),
  chapterGenerationId: uuid("chapter_generation_id").references(() => chapterGenerations.id, { onDelete: "cascade" }),
  executionId: uuid("execution_id"),
  stage: text("stage").notNull(),
  candidateHash: text("candidate_hash").notNull(),
  sourceProfileSetHash: text("source_profile_set_hash").notNull(),
  originalityPolicyVersion: text("originality_policy_version").notNull(),
  decision: text("decision").notNull(),
  signals: jsonb("signals").notNull().default([]),
  acceptedEntityType: text("accepted_entity_type"),
  acceptedEntityId: uuid("accepted_entity_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OriginalityAssessment = typeof originalityAssessments.$inferSelect;
export type NewOriginalityAssessment = typeof originalityAssessments.$inferInsert;
