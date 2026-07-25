import type { SearchResult } from "@/lib/ai/placeholder-fill";
import type { OriginalityLineage } from "@/lib/originality/lineage";

export interface PlaceholderFillMetadata {
  provider?: string;
  sources: SearchResult[];
  ragChunks?: number;
  model?: string;
  filledAt: string;
  promptsHash?: string;
  /** Fill status: "completed" (definition is valid) or "insufficient_evidence" (blocked). */
  status?: "completed" | "insufficient_evidence";
  /** Reason why evidence was insufficient for this placeholder. */
  insufficientReason?: string;
  /** Editorial brief version used when this definition was filled. */
  editorialBriefId?: string;
  editorialBriefVersion?: number;
  editorialBriefHash?: string;
  /** Contract evidence query that drove the search, if any. */
  evidenceQuery?: string;
  /** Source IDs that were searched for evidence (from approved brief). */
  evidenceSourceIds?: string[];
  /** Lineage describing the template and prompt context for originality tracking. */
  originalityLineage?: OriginalityLineage;
  /** ID of the originality assessment result, if one was performed. */
  originalityAssessmentId?: string;
  /** How this placeholder definition was originally filled. */
  definitionOrigin?: "legacy" | "manual" | "ai";
  /** ISO timestamp of when a human confirmed this placeholder definition. */
  manualConfirmedAt?: string;
}

export function buildPlaceholderFillMetadata(params: {
  provider?: string;
  sources?: SearchResult[];
  ragChunks?: number;
  model?: string;
  filledAt?: string;
  promptsHash?: string;
  status?: "completed" | "insufficient_evidence";
  insufficientReason?: string;
  editorialBriefId?: string;
  editorialBriefVersion?: number;
  editorialBriefHash?: string;
  evidenceQuery?: string;
  evidenceSourceIds?: string[];
  originalityLineage?: OriginalityLineage;
  originalityAssessmentId?: string;
  definitionOrigin?: "legacy" | "manual" | "ai";
  manualConfirmedAt?: string;
}): PlaceholderFillMetadata {
  return {
    ...(params.provider ? { provider: params.provider } : {}),
    sources: params.sources ?? [],
    ...(params.ragChunks ? { ragChunks: params.ragChunks } : {}),
    ...(params.model ? { model: params.model } : {}),
    filledAt: params.filledAt ?? new Date().toISOString(),
    ...(params.promptsHash ? { promptsHash: params.promptsHash } : {}),
    ...(params.status ? { status: params.status } : {}),
    ...(params.insufficientReason ? { insufficientReason: params.insufficientReason } : {}),
    ...(params.editorialBriefId ? { editorialBriefId: params.editorialBriefId } : {}),
    ...(params.editorialBriefVersion ? { editorialBriefVersion: params.editorialBriefVersion } : {}),
    ...(params.editorialBriefHash ? { editorialBriefHash: params.editorialBriefHash } : {}),
    ...(params.evidenceQuery ? { evidenceQuery: params.evidenceQuery } : {}),
    ...(params.evidenceSourceIds && params.evidenceSourceIds.length > 0 ? { evidenceSourceIds: params.evidenceSourceIds } : {}),
    ...(params.originalityLineage ? { originalityLineage: params.originalityLineage } : {}),
    ...(params.originalityAssessmentId ? { originalityAssessmentId: params.originalityAssessmentId } : {}),
    ...(params.definitionOrigin ? { definitionOrigin: params.definitionOrigin } : {}),
    ...(params.manualConfirmedAt ? { manualConfirmedAt: params.manualConfirmedAt } : {}),
  };
}
