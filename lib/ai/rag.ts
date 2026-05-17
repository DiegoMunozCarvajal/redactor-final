import { db } from "@/lib/db/drizzle";
import { sourceChunks, sources } from "@/lib/db/schema";
import { generateEmbedding, generateEmbeddings } from "./embeddings";
import { sql, eq, and, inArray, notInArray } from "drizzle-orm";
import { RAG_TOP_K, RAG_TOKEN_BUDGET } from "@/lib/constants";
import { getSourceChunkSchemaSupport } from "@/lib/db/source-chunk-schema";
import { CohereClient } from "cohere-ai";
import {
  rerankRetrievedChunks,
  type RetrievedChunkCandidate,
} from "./rag-scoring";
import type { SourceKind } from "@/lib/sources/source-kind";

let cohereInstance: CohereClient | null = null;

function getCohereClient() {
  if (cohereInstance) return cohereInstance;
  if (!process.env.COHERE_API_KEY) return null;

  cohereInstance = new CohereClient({
    token: process.env.COHERE_API_KEY,
  });
  return cohereInstance;
}

export function resetCohereClient() {
  cohereInstance = null;
}

export interface RetrievedChunk {
  id: string;
  sourceId: string;
  sourceFileName: string;
  sourceKind: SourceKind;
  citation: string | null;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  pageNumber: number | null;
  sectionTitle: string | null;
  charStart: number;
  charEnd: number;
  similarity: number;
  lexicalScore: number;
  hybridScore: number;
}

interface CohereRerankResult {
  index: number;
  relevanceScore: number;
}

/**
 * Split a long composite query into focused sub-queries.
 * Chapter draft queries often concatenate synopsis + key points + objectives,
 * which dilutes the embedding. Decomposition improves recall.
 */
function decomposeQuery(query: string): string[] {
  // Split on sentence boundaries that look like separate topics
  const sentences = query
    .split(/(?<=[.;])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);

  if (sentences.length <= 2) return [query];

  // Group into sub-queries of ~2-3 sentences each
  const subQueries: string[] = [];
  for (let i = 0; i < sentences.length; i += 2) {
    const group = sentences.slice(i, i + 2).join(". ");
    subQueries.push(group);
  }

  // Cap at 3 sub-queries to control embedding cost
  return subQueries.slice(0, 3);
}

/**
 * Run vector similarity search for a single embedding.
 * Sets ef_search for better HNSW recall on larger indexes.
 */
async function vectorSearch(
  queryEmbedding: number[],
  projectId: string,
  limit: number,
  options?: {
    sourceKinds?: SourceKind[];
    excludeSourceKinds?: SourceKind[];
  },
) {
  const support = await getSourceChunkSchemaSupport();
  const embeddingParam = sql.param(queryEmbedding, {
    mapToDriverValue: (v: number[]) => JSON.stringify(v),
  });

  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL hnsw.ef_search = 100`);

    const conditions = [eq(sourceChunks.projectId, projectId)];

    if (options?.sourceKinds?.length) {
      conditions.push(inArray(sources.sourceKind, options.sourceKinds));
    }

    if (options?.excludeSourceKinds?.length) {
      conditions.push(notInArray(sources.sourceKind, options.excludeSourceKinds));
    }

    return tx
      .select({
        id: sourceChunks.id,
        sourceId: sourceChunks.sourceId,
        sourceFileName: sources.fileName,
        sourceKind: sources.sourceKind,
        citation: sources.citation,
        chunkIndex: sourceChunks.chunkIndex,
        content: sourceChunks.content,
        tokenCount: sourceChunks.tokenCount,
        pageNumber: support.pageNumber
          ? sourceChunks.pageNumber
          : sql<number | null>`null`,
        sectionTitle: support.sectionTitle
          ? sourceChunks.sectionTitle
          : sql<string | null>`null`,
        charStart: support.charOffsets ? sourceChunks.charStart : sql<number>`0`,
        charEnd: support.charOffsets
          ? sourceChunks.charEnd
          : sql<number>`char_length(${sourceChunks.content})`,
        similarity: sql<number>`1 - (${sourceChunks.embedding} <=> ${embeddingParam}::vector)`,
      })
      .from(sourceChunks)
      .innerJoin(sources, eq(sourceChunks.sourceId, sources.id))
      .where(and(...conditions))
      .orderBy(
        sql`${sourceChunks.embedding} <=> ${embeddingParam}::vector`,
      )
      .limit(limit);
  });
}

/**
 * Retrieve relevant source chunks for a query using cosine similarity.
 * For complex queries, decomposes into sub-queries for better recall.
 * Returns chunks within the token budget, ordered by relevance.
 */
export async function retrieveContext(
  query: string,
  projectId: string,
  options?: {
    topK?: number;
    tokenBudget?: number;
    maxChunksPerSource?: number;
    minSimilarity?: number;
    sourceKinds?: SourceKind[];
    excludeSourceKinds?: SourceKind[];
    excludeChunkIds?: string[];
  },
): Promise<{
  chunks: RetrievedChunk[];
  contextText: string;
  totalTokens: number;
}> {
  const topK = options?.topK ?? RAG_TOP_K;
  const tokenBudget = options?.tokenBudget ?? RAG_TOKEN_BUDGET;
  const maxChunksPerSource = options?.maxChunksPerSource ?? 2;
  const minSimilarity = options?.minSimilarity ?? 0.35;

  const subQueries = decomposeQuery(query);

  // Embed all sub-queries (single query skips decomposition overhead)
  let allResults: Array<{
    id: string;
    sourceId: string;
    sourceFileName: string;
    sourceKind: SourceKind;
    citation: string | null;
    chunkIndex: number;
    content: string;
    tokenCount: number;
    pageNumber: number | null;
    sectionTitle: string | null;
    charStart: number;
    charEnd: number;
    similarity: number;
  }>;

  // Always fetch at least 120 candidates so a low topK still searches the full corpus.
  const fetchLimit = Math.max(topK * 6, 120);

  if (subQueries.length === 1) {
    const queryEmbedding = await generateEmbedding(query);
    allResults = await vectorSearch(queryEmbedding, projectId, fetchLimit, {
      sourceKinds: options?.sourceKinds,
      excludeSourceKinds: options?.excludeSourceKinds,
    });
  } else {
    const embeddings = await generateEmbeddings(subQueries);
    const perQueryLimit = Math.ceil(fetchLimit / subQueries.length);

    const resultSets = await Promise.all(
      embeddings.map((emb) =>
        vectorSearch(emb, projectId, perQueryLimit, {
          sourceKinds: options?.sourceKinds,
          excludeSourceKinds: options?.excludeSourceKinds,
        }),
      ),
    );

    // Merge and deduplicate — keep the highest similarity per chunk
    const bestByChunk = new Map<string, (typeof allResults)[number]>();
    for (const results of resultSets) {
      for (const row of results) {
        const existing = bestByChunk.get(row.id);
        if (!existing || row.similarity > existing.similarity) {
          bestByChunk.set(row.id, row);
        }
      }
    }
    allResults = [...bestByChunk.values()];
  }

  const reranked: RetrievedChunkCandidate[] = rerankRetrievedChunks(
    allResults.map(
      (row): RetrievedChunkCandidate => ({
        id: row.id,
        sourceId: row.sourceId,
        sourceFileName: row.sourceFileName,
        sourceKind: row.sourceKind,
        citation: row.citation,
        chunkIndex: row.chunkIndex,
        content: row.content,
        tokenCount: row.tokenCount,
        pageNumber: row.pageNumber,
        sectionTitle: row.sectionTitle,
        charStart: row.charStart,
        charEnd: row.charEnd,
        similarity: row.similarity,
      }),
    ),
    query,
  );

  // Build exclusion set BEFORE Cohere rerank to avoid wasting API quota on excluded chunks
  const excludeSet = new Set(options?.excludeChunkIds ?? []);
  const rerankedForCohere = excludeSet.size > 0
    ? reranked.filter((c) => !excludeSet.has(c.id))
    : reranked;

  // Apply Cohere Rerank if available
  let finalCandidates: RetrievedChunkCandidate[] = reranked;
  const cohere = getCohereClient();
  if (cohere && rerankedForCohere.length > 0) {
    try {
      const rerankResponse = await cohere.rerank({
        model: process.env.COHERE_RERANK_MODEL || "rerank-english-v3.0",
        query,
        documents: rerankedForCohere.map((c) => c.content),
        topN: topK * 2,
      });

      finalCandidates = rerankResponse.results
        .map((result): RetrievedChunkCandidate => {
          const rerankResult = result as CohereRerankResult;
          const candidate = rerankedForCohere[rerankResult.index];
          if (!candidate) {
            throw new Error(
              `Cohere rerank returned out-of-range index ${rerankResult.index}.`,
            );
          }

          const finalScore =
            (candidate.hybridScore ?? 0) * 0.3 +
            rerankResult.relevanceScore * 0.7;
          return {
            ...candidate,
            rerankScore: rerankResult.relevanceScore,
            // Blend hybrid and rerank scores for sorting
            finalScore,
          };
        })
        .sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0));
    } catch (error) {
      console.error(
        "Cohere Rerank failed, falling back to hybrid scoring:",
        error,
      );
    }
  }

  // Filter out excluded chunks (safety net: already excluded before Cohere;
  // still needed for non-Cohere fallback path)
  if (excludeSet.size > 0) {
    finalCandidates = finalCandidates.filter((c) => !excludeSet.has(c.id));
  }

  // Accumulate chunks within token budget
  const chunks: RetrievedChunk[] = [];
  let totalTokens = 0;
  const chunksPerSource = new Map<string, number>();

  for (const row of finalCandidates) {
    const lexicalScore = row.lexicalScore ?? 0;

    if (
      !row.rerankScore &&
      row.similarity < minSimilarity &&
      lexicalScore < 0.35
    ) {
      continue;
    }

    const sourceCount = chunksPerSource.get(row.sourceId) ?? 0;
    if (sourceCount >= maxChunksPerSource) {
      continue;
    }

    if (totalTokens + row.tokenCount > tokenBudget) {
      continue;
    }

    chunks.push({
      id: row.id,
      sourceId: row.sourceId,
      sourceFileName: row.sourceFileName,
      sourceKind: (row.sourceKind as SourceKind) ?? "unknown",
      citation: row.citation ?? null,
      chunkIndex: row.chunkIndex,
      content: row.content,
      tokenCount: row.tokenCount,
      pageNumber: row.pageNumber,
      sectionTitle: row.sectionTitle,
      charStart: row.charStart,
      charEnd: row.charEnd,
      similarity: row.similarity,
      lexicalScore: row.lexicalScore ?? 0,
      hybridScore: row.hybridScore ?? row.similarity,
    });
    totalTokens += row.tokenCount;
    chunksPerSource.set(row.sourceId, sourceCount + 1);

    if (chunks.length >= topK) {
      break;
    }
  }

  const contextText = chunks
    .map(
      (c, i) =>
        [
          `[Source ${i + 1} | id ${c.id} | ${c.sourceKind} | ${c.citation ?? c.sourceFileName} | chunk ${c.chunkIndex + 1}`,
          c.pageNumber ? `page ${c.pageNumber}` : null,
          c.sectionTitle ? `section ${c.sectionTitle}` : null,
          `hybrid ${c.hybridScore.toFixed(3)}`,
          `semantic ${c.similarity.toFixed(3)}]`,
        ]
          .filter(Boolean)
          .join(" | ") + `\n${c.content}`,
    )
    .join("\n\n---\n\n");

  return { chunks, contextText, totalTokens };
}
