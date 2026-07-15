import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { generateEmbedding } from "./embeddings";
import { rerank } from "./rerank";

export interface RetrievedChunk {
  sourceId: string;
  sourceFileName: string;
  sourceKind: string;
  citation: string | null;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  /** Cosine distance from pgvector <=> (0 = identical, 2 = opposite). Not similarity! */
  distance: number;
  rerankScore: number | null;
}

/**
 * Retrieve relevant source chunks via vector search + Cohere rerank.
 *
 * IMPORTANT: Callers MUST verify the user owns `projectId` before calling this
 * function. This function trusts its caller for authorization — it does not
 * independently verify project ownership.
 */
export async function retrieveContext(
  query: string,
  projectId: string,
  options?: {
    topK?: number;
    tokenBudget?: number;
    minSimilarity?: number;
    sourceIds?: string[];
  },
): Promise<{ chunks: RetrievedChunk[]; contextText: string }> {
  const topK = options?.topK ?? 10;
  const tokenBudget = options?.tokenBudget ?? 4000;
  const minSimilarity = options?.minSimilarity ?? 0.3;
  const sourceIds = options?.sourceIds;

  // Early return for explicitly-empty source filter: no approved sources → no context.
  if (sourceIds && sourceIds.length === 0) {
    return { chunks: [], contextText: "" };
  }

  // Generate embedding for query
  const embedding = await generateEmbedding(query);
  const embeddingStr = `[${embedding.join(",")}]`;

  // Build conditions
  const conditions = [
    sql`sc.project_id = ${projectId}`,
    sql`sc.embedding <=> ${embeddingStr}::vector < ${1 - minSimilarity}`,
  ];
  if (sourceIds && sourceIds.length > 0) {
    // IN clause — avoids ANY(ARRAY[...]::uuid[]) which produces
    // "malformed array literal" when Drizzle nests parameterized
    // sql.join chunks inside db.execute() on pgvector queries.
    const idPlaceholders = sourceIds.map((id) => sql`${id}::uuid`);
    conditions.push(
      sql`sc.source_id IN (${sql.join(idPlaceholders, sql`, `)})`,
    );
  }

  // Vector similarity search using cosine distance (<=>)
  const rows = (await db.execute(sql`
    SELECT
      sc.id,
      sc.source_id,
      sc.chunk_index,
      sc.content,
      sc.token_count,
      sc.embedding <=> ${embeddingStr}::vector AS distance,
      s.file_name,
      s.source_kind,
      s.citation
    FROM source_chunks sc
    JOIN sources s ON s.id = sc.source_id
    WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY sc.embedding <=> ${embeddingStr}::vector
    LIMIT ${topK * 3}
  `)) as unknown as Array<{
    id: string;
    source_id: string;
    chunk_index: number;
    content: string;
    token_count: number;
    distance: number;
    file_name: string;
    source_kind: string;
    citation: string | null;
  }>;

  if (rows.length === 0) {
    return { chunks: [], contextText: "" };
  }

  // Rerank with Cohere for semantic relevance
  const documents = rows.map((r) => r.content);
  const reranked = await rerank(query, documents, { topN: topK });

  // Build reranked result set
  const chunks: RetrievedChunk[] = [];
  let totalTokens = 0;

  for (const { index, score } of reranked) {
    if (totalTokens >= tokenBudget) break;
    const row = rows[index];
    if (!row) continue;

    chunks.push({
      sourceId: row.source_id,
      sourceFileName: row.file_name,
      sourceKind: row.source_kind,
      citation: row.citation,
      chunkIndex: row.chunk_index,
      content: row.content,
      tokenCount: row.token_count,
      distance: row.distance,
      rerankScore: score,
    });
    totalTokens += row.token_count;
  }

  // Build context text
  let contextText = "";
  if (chunks.length > 0) {
    // Check for protected content in retrieved chunks
    const allContent = chunks.map((c) => c.content).join(" ");
    const { checkBlocklist } = await import("@/lib/ai/originality-check");
    const blocklistHits = checkBlocklist(allContent);
    const warningHeader =
      blocklistHits.length > 0
        ? `⚠️ ADVERTENCIA: El siguiente material de investigación puede contener elementos de obras protegidas (${blocklistHits.length} patrón(es) detectado(s)). NO copies frases, metáforas, ejemplos ni estructuras. Úsalo SOLO para entender el dominio. Si el material infringe derechos de autor, ignóralo completamente.\n\n`
        : "";

    contextText = warningHeader + "## Documentos subidos\n\n";
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      const cite = c.citation ? ` (${c.citation})` : "";
      contextText += `[Fuente ${i + 1} | ${c.sourceKind} | ${c.sourceFileName}${cite}]\n${c.content}\n\n`;
    }
  }

  return { chunks, contextText };
}
