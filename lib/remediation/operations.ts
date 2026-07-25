import { db } from "@/lib/db/drizzle";
import { pipelineMaintenanceOperations } from "@/lib/db/schema";
import { sha256Canonical } from "@/lib/template-pipeline/hash";
import { eq, and } from "drizzle-orm";
import type {
  RegenerationInput,
  CloneInput,
  MaintenanceKind,
  MaintenanceOperation,
  MaintenanceStatus,
  OperationReport,
  BeginOperationResult,
} from "./contracts";
import { OperationInputConflictError, OperationStateError } from "./contracts";

// ---------------------------------------------------------------------------
// Input hash
// ---------------------------------------------------------------------------

/**
 * Compute the canonical hash for an operation input, excluding the operationId
 * so that the same workload always produces the same hash regardless of the
 * specific operation tracking ID.
 */
export function inputHashFor(
  input: RegenerationInput | CloneInput,
): string {
  const { operationId: _, ...rest } = input;
  return sha256Canonical(rest);
}

// ---------------------------------------------------------------------------
// Shared implementation
// ---------------------------------------------------------------------------

async function _beginMaintenanceOperation(
  input: RegenerationInput | CloneInput,
  kind: MaintenanceKind,
): Promise<BeginOperationResult> {
  const inputHash = inputHashFor(input);

  try {
    const [operation] = await db
      .insert(pipelineMaintenanceOperations)
      .values({
        id: input.operationId,
        kind,
        inputHash,
        status: "running",
      })
      .returning();

    return { state: "new", operation: rowToOperation(operation) };
  } catch (err: unknown) {
    if (!isUniqueViolation(err)) throw err;

    // --- Unique violation — re-read and reconcile ---

    const [existing] = await db
      .select()
      .from(pipelineMaintenanceOperations)
      .where(eq(pipelineMaintenanceOperations.id, input.operationId));

    if (!existing) {
      throw new OperationStateError(
        `Operation ${input.operationId}: insert conflict but no row exists`,
      );
    }

    // Kind mismatch
    if (existing.kind !== kind) {
      throw new OperationInputConflictError(
        input.operationId,
        existing.inputHash,
        inputHash,
      );
    }

    // Input hash mismatch
    if (existing.inputHash !== inputHash) {
      throw new OperationInputConflictError(
        input.operationId,
        existing.inputHash,
        inputHash,
      );
    }

    // Completed — no action needed
    if (existing.status === "completed") {
      return { state: "completed", operation: rowToOperation(existing) };
    }

    // Running — another process is working
    if (existing.status === "running") {
      return { state: "running", operation: rowToOperation(existing) };
    }

    // Failed — atomically restart
    const [restarted] = await db
      .update(pipelineMaintenanceOperations)
      .set({ status: "running", completedAt: null })
      .where(
        and(
          eq(pipelineMaintenanceOperations.id, input.operationId),
          eq(pipelineMaintenanceOperations.status, "failed"),
        ),
      )
      .returning();

    return {
      state: "running",
      operation: rowToOperation(restarted),
    };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function beginRegeneration(
  input: RegenerationInput,
): Promise<BeginOperationResult> {
  return _beginMaintenanceOperation(input, "template_regeneration");
}

export async function beginClone(
  input: CloneInput,
): Promise<BeginOperationResult> {
  return _beginMaintenanceOperation(input, "project_clone");
}

// ---------------------------------------------------------------------------
// Completion & failure
// ---------------------------------------------------------------------------

export async function completeMaintenanceOperation({
  operationId,
  resultTemplateId = null,
  resultProjectId = null,
  report = {},
}: {
  operationId: string;
  resultTemplateId?: string | null;
  resultProjectId?: string | null;
  report?: OperationReport;
}): Promise<MaintenanceOperation> {
  const [updated] = await db
    .update(pipelineMaintenanceOperations)
    .set({
      status: "completed",
      resultTemplateId,
      resultProjectId,
      report,
      completedAt: new Date(),
    })
    .where(
      and(
        eq(pipelineMaintenanceOperations.id, operationId),
        eq(pipelineMaintenanceOperations.status, "running"),
      ),
    )
    .returning();

  if (updated) return rowToOperation(updated);

  // No rows updated — operation may already be in a terminal state
  const [existing] = await db
    .select()
    .from(pipelineMaintenanceOperations)
    .where(eq(pipelineMaintenanceOperations.id, operationId));

  if (!existing) {
    throw new OperationStateError(`Operation ${operationId} not found`);
  }

  if (
    existing.status === "completed" &&
    existing.resultTemplateId === resultTemplateId &&
    existing.resultProjectId === resultProjectId
  ) {
    // Idempotent — same operation with matching result IDs
    return rowToOperation(existing);
  }

  throw new OperationStateError(
    `Cannot complete operation ${operationId}: current status is "${existing.status}"`,
  );
}

export async function failMaintenanceOperation({
  operationId,
  report = {},
}: {
  operationId: string;
  report?: OperationReport;
}): Promise<MaintenanceOperation> {
  const [updated] = await db
    .update(pipelineMaintenanceOperations)
    .set({
      status: "failed",
      report,
      completedAt: new Date(),
    })
    .where(
      and(
        eq(pipelineMaintenanceOperations.id, operationId),
        eq(pipelineMaintenanceOperations.status, "running"),
      ),
    )
    .returning();

  if (updated) return rowToOperation(updated);

  // Idempotent — return whatever exists
  const [existing] = await db
    .select()
    .from(pipelineMaintenanceOperations)
    .where(eq(pipelineMaintenanceOperations.id, operationId));

  if (!existing) {
    throw new OperationStateError(`Operation ${operationId} not found`);
  }

  return rowToOperation(existing);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToOperation(
  row: {
    id: string;
    kind: string;
    inputHash: string;
    status: string;
    resultTemplateId: string | null;
    resultProjectId: string | null;
    report: unknown;
    createdAt: Date;
    completedAt: Date | null;
  },
): MaintenanceOperation {
  return {
    id: row.id,
    kind: row.kind as MaintenanceKind,
    inputHash: row.inputHash,
    status: row.status as MaintenanceStatus,
    resultTemplateId: row.resultTemplateId,
    resultProjectId: row.resultProjectId,
    report:
      typeof row.report === "object" && row.report !== null
        ? (row.report as Record<string, unknown>)
        : {},
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "23505"
  );
}
