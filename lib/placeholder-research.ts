import { RAG_KEYWORDS, SEMANTIC_SCHOLAR_KEYWORDS, STYLISTIC_PATTERNS } from "./placeholder-constants";

export type PlaceholderProvider = "rag" | "semantic-scholar" | "llm" | "direct";

export function inferPlaceholderProvider(
  name: string,
  functionStr?: string | null,
): PlaceholderProvider {
  const lower = name.toLowerCase();
  const nameSegments = lower.split("_");

  if (nameSegments.includes("tema") || nameSegments.includes("topic")) {
    return "direct";
  }

  // Include function words in classification (notes excluded — they contain
  // meta-prefixes like "Ejemplo:" that would incorrectly trigger RAG).
  const fnWords = (functionStr ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const allSegments = [...nameSegments, ...fnWords];

  const needsResearch =
    functionStr?.toLowerCase().includes("investigación") ||
    functionStr?.toLowerCase().includes("búsqueda");

  // Segment-based matching: check if any keyword matches a whole segment.
  // Uses both name segments and function words for precise matching.
  if (!needsResearch && STYLISTIC_PATTERNS.some((pattern) => nameSegments.some((s) => s === pattern))) {
    return "llm";
  }

  if (RAG_KEYWORDS.some((keyword) => allSegments.some((s) => s === keyword))) {
    return "rag";
  }

  if (SEMANTIC_SCHOLAR_KEYWORDS.some((keyword) => allSegments.some((s) => s === keyword))) {
    return "semantic-scholar";
  }

  return "llm";
}
