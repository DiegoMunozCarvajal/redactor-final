import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const bookTemplates = pgTable("book_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("ready"),
  // FK to template_pipeline_runs enforced via SQL migration.
  // Raw UUID column avoids import cycle with template-pipeline.ts.
  activePipelineRunId: uuid("active_pipeline_run_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BookTemplate = typeof bookTemplates.$inferSelect;
export type NewBookTemplate = typeof bookTemplates.$inferInsert;
