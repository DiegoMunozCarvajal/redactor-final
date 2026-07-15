import type { PromptKind } from "@/lib/db/schema/prompt-registry";

export interface DefinitionSummary {
  id: string;
  name: string;
  description: string | null;
  kind: PromptKind;
  archivedAt: string | null;
  latestRevision: { id: string; versionLabel: string; revisionNumber: number } | null;
  defaultRevisionId: string | null;
  defaultVersionLabel: string | null;
  bindingCount: number;
  executionCount: number;
}

export interface DefinitionDetail {
  id: string;
  name: string;
  description: string | null;
  kind: PromptKind;
  archivedAt: string | null;
  revisions: RevisionDetail[];
  defaultRevisionId: string | null;
  totalBindingCount: number;
  totalExecutionCount: number;
}

export interface RevisionDetail {
  id: string;
  revisionNumber: number;
  versionLabel: string;
  systemTemplate: string;
  userTemplate: string;
  requiredMarkers: string[];
  outputContract: string | null;
  configuration: Record<string, unknown>;
  createdAt: string;
  createdBy: string | null;
  isDefault: boolean;
  bindingCount: number;
  executionCount: number;
}

export interface ArchiveConflictError {
  defaultCount: number;
  bindingCount: number;
}
