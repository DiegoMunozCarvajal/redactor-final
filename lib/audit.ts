import { db } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";

interface AuditEntry {
  userId: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}

export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      userId: entry.userId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
    });
  } catch {
    // Logging should never break the main flow
    console.error("[audit] Failed to write audit log:", entry);
  }
}
