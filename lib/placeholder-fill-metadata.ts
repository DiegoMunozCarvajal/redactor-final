import type { SearchResult } from "@/lib/ai/placeholder-fill";

export interface PlaceholderFillMetadata {
  provider?: string;
  sources: SearchResult[];
  ragChunks?: number;
  model?: string;
  filledAt: string;
  promptsHash?: string;
  /** Editorial brief version used when this definition was filled. */
  editorialBriefId?: string;
  editorialBriefVersion?: number;
  editorialBriefHash?: string;
  /** Contract evidence query that drove the search, if any. */
  evidenceQuery?: string;
  /** Source IDs that were searched for evidence (from approved brief). */
  evidenceSourceIds?: string[];
}

export function buildPlaceholderFillMetadata(params: {
  provider?: string;
  sources?: SearchResult[];
  ragChunks?: number;
  model?: string;
  filledAt?: string;
  promptsHash?: string;
  editorialBriefId?: string;
  editorialBriefVersion?: number;
  editorialBriefHash?: string;
  evidenceQuery?: string;
  evidenceSourceIds?: string[];
}): PlaceholderFillMetadata {
  return {
    ...(params.provider ? { provider: params.provider } : {}),
    sources: params.sources ?? [],
    ...(params.ragChunks ? { ragChunks: params.ragChunks } : {}),
    ...(params.model ? { model: params.model } : {}),
    filledAt: params.filledAt ?? new Date().toISOString(),
    ...(params.promptsHash ? { promptsHash: params.promptsHash } : {}),
    ...(params.editorialBriefId ? { editorialBriefId: params.editorialBriefId } : {}),
    ...(params.editorialBriefVersion ? { editorialBriefVersion: params.editorialBriefVersion } : {}),
    ...(params.editorialBriefHash ? { editorialBriefHash: params.editorialBriefHash } : {}),
    ...(params.evidenceQuery ? { evidenceQuery: params.evidenceQuery } : {}),
    ...(params.evidenceSourceIds && params.evidenceSourceIds.length > 0 ? { evidenceSourceIds: params.evidenceSourceIds } : {}),
  };
}
