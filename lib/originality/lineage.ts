import { sha256Canonical, EMPTY_SOURCE_PROFILE_SET_HASH } from "@/lib/template-pipeline/hash";

// ---------------------------------------------------------------------------
// Lineage types
// ---------------------------------------------------------------------------

interface BaseOriginalityLineage {
  scope: "template" | "source-free";
  sourceProfileSetHash: string;
  originalityPolicyVersion: string;
  promptRevisions: Record<string, string>;
}

export type OriginalityLineage =
  | (BaseOriginalityLineage & {
      scope: "template";
      pipelineRunId: string;
      pipelineVersion: string;
      compilerVersion: string;
      compilerHash: string;
      recipeCatalogHash: string;
      templateArtifactHash: string;
      sourceProfileVersion: string;
      placeholderFunctionHash?: string;
    })
  | (BaseOriginalityLineage & {
      scope: "source-free";
      pipelineRunId: null;
    });

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

export function templateLineage(input: {
  pipelineRunId: string;
  pipelineVersion: string;
  compilerVersion: string;
  compilerHash: string;
  recipeCatalogHash: string;
  templateArtifactHash: string;
  sourceProfileVersion: string;
  sourceProfileSetHash: string;
  originalityPolicyVersion: string;
  promptRevisions: Record<string, string>;
  placeholderFunctionHash?: string;
}): OriginalityLineage {
  return {
    scope: "template",
    pipelineRunId: input.pipelineRunId,
    pipelineVersion: input.pipelineVersion,
    compilerVersion: input.compilerVersion,
    compilerHash: input.compilerHash,
    recipeCatalogHash: input.recipeCatalogHash,
    templateArtifactHash: input.templateArtifactHash,
    sourceProfileVersion: input.sourceProfileVersion,
    sourceProfileSetHash: input.sourceProfileSetHash,
    originalityPolicyVersion: input.originalityPolicyVersion,
    promptRevisions: normalizeRevisions(input.promptRevisions),
    placeholderFunctionHash: input.placeholderFunctionHash,
  };
}

export function sourceFreeLineage(input?: {
  promptRevisions?: Record<string, string>;
}): OriginalityLineage {
  return {
    scope: "source-free",
    pipelineRunId: null,
    sourceProfileSetHash: EMPTY_SOURCE_PROFILE_SET_HASH,
    originalityPolicyVersion: "originality-policy-v2",
    promptRevisions: normalizeRevisions(input?.promptRevisions ?? {}),
  };
}

// ---------------------------------------------------------------------------
// Equality
// ---------------------------------------------------------------------------

function normalizeRevisions(
  revisions: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(revisions)
      .sort(([a], [b]) => a.localeCompare(b))
      .filter(([, v]) => v !== undefined && v !== null),
  );
}

function lineageHash(lineage: OriginalityLineage): string {
   
  const { promptRevisions, ...rest } = lineage as unknown as Record<string, unknown>;
  return sha256Canonical({
    ...rest,
    promptRevisions: normalizeRevisions(
      promptRevisions as Record<string, string>,
    ),
  });
}

export function isOriginalityLineageCurrent(
  saved: OriginalityLineage | null | undefined,
  current: OriginalityLineage,
): boolean {
  if (!saved) return false;
  return lineageHash(saved) === lineageHash(current);
}
