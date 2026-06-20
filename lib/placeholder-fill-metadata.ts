import type { SearchResult } from "@/lib/ai/placeholder-fill";

export interface PlaceholderFillMetadata {
  provider?: string;
  sources: SearchResult[];
  ragChunks?: number;
  model?: string;
  filledAt: string;
  promptsHash?: string;
}

export function buildPlaceholderFillMetadata(params: {
  provider?: string;
  sources?: SearchResult[];
  ragChunks?: number;
  model?: string;
  filledAt?: string;
  promptsHash?: string;
}): PlaceholderFillMetadata {
  return {
    ...(params.provider ? { provider: params.provider } : {}),
    sources: params.sources ?? [],
    ...(params.ragChunks ? { ragChunks: params.ragChunks } : {}),
    ...(params.model ? { model: params.model } : {}),
    filledAt: params.filledAt ?? new Date().toISOString(),
    ...(params.promptsHash ? { promptsHash: params.promptsHash } : {}),
  };
}
