import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  action: text("action").notNull(), // e.g., "project.create", "template.delete", "chapter.generate"
  resourceType: text("resource_type").notNull(), // e.g., "project", "book_template", "chapter"
  resourceId: uuid("resource_id"),
  metadata: jsonb("metadata"), // JSON for extra context
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_audit_logs_user").on(table.userId),
  index("idx_audit_logs_created_at").on(table.createdAt),
]);

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
