const QUERY_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "what",
  "with",
]);

export interface RetrievedChunkCandidate {
  id: string;
  sourceId: string;
  sourceFileName: string;
  sourceKind?: string;
  citation?: string | null;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  pageNumber: number | null;
  sectionTitle: string | null;
  charStart: number;
  charEnd: number;
  similarity: number;
  lexicalScore?: number;
  hybridScore?: number;
  rerankScore?: number;
  finalScore?: number;
}

function tokenizeForLexicalMatch(text: string) {
  return new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

/**
 * Extract bigrams (consecutive word pairs) from tokenized words.
 * Catches multi-word terms like "machine learning", "narrative arc", etc.
 */
function extractBigrams(words: string[]): Set<string> {
  const bigrams = new Set<string>();
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.add(`${words[i]} ${words[i + 1]}`);
  }
  return bigrams;
}

export function extractQueryKeywords(query: string) {
  const seen = new Set<string>();
  const words = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return words.filter((word) => {
    if (word.length < 3) return false;
    if (QUERY_STOP_WORDS.has(word)) return false;
    if (seen.has(word)) return false;
    seen.add(word);
    return true;
  });
}

export function scoreChunkLexicalMatch(
  queryKeywords: string[],
  chunk: Pick<
    RetrievedChunkCandidate,
    "content" | "sourceFileName" | "sectionTitle"
  >,
) {
  if (queryKeywords.length === 0) return 0;

  const contentTokens = tokenizeForLexicalMatch(chunk.content);
  const fileTokens = tokenizeForLexicalMatch(chunk.sourceFileName);
  const sectionTokens = tokenizeForLexicalMatch(chunk.sectionTitle ?? "");

  const contentHits = queryKeywords.filter((keyword) =>
    contentTokens.has(keyword),
  ).length;
  const fileHits = queryKeywords.filter((keyword) =>
    fileTokens.has(keyword),
  ).length;
  const sectionHits = queryKeywords.filter((keyword) =>
    sectionTokens.has(keyword),
  ).length;
  const phraseBonus = chunk.content
    .toLowerCase()
    .includes(queryKeywords.join(" "))
    ? 0.1
    : 0;

  // Bigram matching — rewards chunks containing multi-word terms from the query
  const contentLower = chunk.content.toLowerCase();
  const contentWords = contentLower.match(/[a-z0-9]+/g) ?? [];
  const contentBigrams = extractBigrams(contentWords);
  const queryBigrams = extractBigrams(queryKeywords);
  let bigramHits = 0;
  for (const bigram of queryBigrams) {
    if (contentBigrams.has(bigram)) bigramHits++;
  }
  const bigramBonus =
    queryBigrams.size > 0 ? (bigramHits / queryBigrams.size) * 0.12 : 0;

  const contentScore = contentHits / queryKeywords.length;
  const fileScore = fileHits / queryKeywords.length;
  const sectionScore = sectionHits / queryKeywords.length;

  return Math.min(
    1,
    contentScore * 0.6 +
      fileScore * 0.18 +
      sectionScore * 0.18 +
      phraseBonus +
      bigramBonus,
  );
}

export function rerankRetrievedChunks(
  chunks: RetrievedChunkCandidate[],
  query: string,
) {
  const queryKeywords = extractQueryKeywords(query);

  return chunks
    .map((chunk) => {
      const lexicalScore = scoreChunkLexicalMatch(queryKeywords, chunk);
      const hybridScore = chunk.similarity * 0.72 + lexicalScore * 0.28;
      return {
        ...chunk,
        lexicalScore,
        hybridScore,
      };
    })
    .sort((a, b) => {
      if (b.hybridScore !== a.hybridScore) {
        return b.hybridScore - a.hybridScore;
      }
      if (b.similarity !== a.similarity) {
        return b.similarity - a.similarity;
      }
      return a.tokenCount - b.tokenCount;
    });
}
