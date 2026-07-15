export interface AssemblyMetadata {
  algorithm?: "merge-sort" | "sequential" | "halves" | "critique" | "correction" | "planned-editorial-v1";
  promptId?: string;
  promptTitle?: string;
  promptSource?: string;
  model?: string;
  fragmentCount?: number;
  pipeline?: string;
  tokensUsed?: number;
  costUsd?: number;
  durationMs?: number;
  plannerExecutionId?: string;
  assemblyExecutionId?: string;
}

export interface AssemblyVersionState {
  id: string;
  status: string;
  assembledContent: string | null;
  completedAt: string | null;
  createdAt: string;
  assemblyMetadata?: AssemblyMetadata | null;
  assemblyPlan?: Record<string, unknown> | null;
  planningMetadata?: Record<string, unknown> | null;
  plannerPromptRevisionId?: string | null;
  assemblyPromptRevisionId?: string | null;
}

export function getAssemblyVersions<T extends AssemblyVersionState>(
  generations: T[],
): T[] {
  return generations
    .filter((generation) => generation.status === "completed" && generation.assembledContent)
    .sort((a, b) => {
      const aTime = new Date(a.completedAt ?? a.createdAt).getTime();
      const bTime = new Date(b.completedAt ?? b.createdAt).getTime();
      return bTime - aTime;
    });
}

export function getSelectedAssemblyVersion<T extends AssemblyVersionState>(
  generations: T[],
  selectedId?: string,
): T | undefined {
  const versions = getAssemblyVersions(generations);
  return versions.find((generation) => generation.id === selectedId) ?? versions[0];
}
