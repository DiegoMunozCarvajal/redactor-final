import { pgTable, text, timestamp, uuid, jsonb } from "drizzle-orm/pg-core";
import { bookTemplates } from "./book-templates";
import { projects } from "./projects";

export const pipelineMaintenanceOperations = pgTable("pipeline_maintenance_operations", {
  id: uuid("id").primaryKey(),
  kind: text("kind").notNull(),
  inputHash: text("input_hash").notNull(),
  status: text("status").notNull().default("running"),
  resultTemplateId: uuid("result_template_id").references(() => bookTemplates.id, { onDelete: "restrict" }),
  resultProjectId: uuid("result_project_id").references(() => projects.id, { onDelete: "restrict" }),
  report: jsonb("report").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export type PipelineMaintenanceOperation = typeof pipelineMaintenanceOperations.$inferSelect;
export type NewPipelineMaintenanceOperation = typeof pipelineMaintenanceOperations.$inferInsert;
