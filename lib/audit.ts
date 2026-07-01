import { db } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";

interface AuditEntry {
  userId: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}

// Exported for monitoring: increments on every audit write failure.
// Operational tooling can read this to detect silent audit loss.
export const auditMetrics = {
  failures: 0,
  total: 0,
};

export async function logAudit(entry: AuditEntry): Promise<void> {
  auditMetrics.total++;
  try {
    await db.insert(auditLogs).values({
      userId: entry.userId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
    });
  } catch {
    auditMetrics.failures++;
    // Logging should never break the main flow
    console.error("[audit] Failed to write audit log:", entry.action, entry.resourceType, entry.resourceId);
  }
}
