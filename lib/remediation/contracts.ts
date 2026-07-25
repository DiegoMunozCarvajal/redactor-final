import { z } from "zod";

export const regenerationInputSchema = z.object({
  operationId: z.string().uuid(),
  legacyTemplateId: z.string().uuid(),
  sourceHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1),
  rhetoricTraceRevisionId: z.string().uuid(),
  sourceProfilerRevisionId: z.string().uuid(),
  compilerHash: z.string().regex(/^[a-f0-9]{64}$/),
  policyVersion: z.string().min(1),
}).strict();

export type RegenerationInput = z.infer<typeof regenerationInputSchema>;

export const cloneInputSchema = z.object({
  operationId: z.string().uuid(),
  legacyProjectId: z.string().uuid(),
  cleanTemplateId: z.string().uuid(),
  legacyProjectStateHash: z.string().regex(/^[a-f0-9]{64}$/),
  cleanTemplateArtifactSetHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export type CloneInput = z.infer<typeof cloneInputSchema>;

export type MaintenanceKind = "template_regeneration" | "project_clone";
export type MaintenanceStatus = "running" | "completed" | "failed";

export interface MaintenanceOperation {
  id: string;
  kind: MaintenanceKind;
  inputHash: string;
  status: MaintenanceStatus;
  resultTemplateId: string | null;
  resultProjectId: string | null;
  report: Record<string, unknown>;
  createdAt: Date;
  completedAt: Date | null;
}

export interface OperationReport {
  counts?: Record<string, number>;
  hashes?: Record<string, string>;
  ids?: Record<string, string>;
  codes?: string[];
  [key: string]: unknown;
}

export type BeginOperationResult =
  | { state: "new"; operation: MaintenanceOperation }
  | { state: "running"; operation: MaintenanceOperation }
  | { state: "completed"; operation: MaintenanceOperation };

export class OperationInputConflictError extends Error {
  constructor(
    public readonly operationId: string,
    public readonly expectedHash: string,
    public readonly receivedHash: string,
  ) {
    super(
      `Operation ${operationId} exists with different input hash (expected ${expectedHash.slice(0, 8)}..., got ${receivedHash.slice(0, 8)}...)`,
    );
    this.name = "OperationInputConflictError";
  }
}

export class OperationStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationStateError";
  }
}
