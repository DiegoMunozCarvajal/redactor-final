import { db } from "@/lib/db";
import { sourceChunks, sources } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { generateEmbedding } from "./embeddings";

export interface RetrievedChunk {
  sourceId: string;
  sourceFileName: string;
  sourceKind: string;
  citation: string | null;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  similarity: number;
}

export async function retrieveContext(
  query: string,
  projectId: string,
  options?: {
    topK?: number;
    tokenBudget?: number;
    minSimilarity?: number;
  },
): Promise<{ chunks: RetrievedChunk[]; contextText: string }> {
  const topK = options?.topK ?? 10;
  const tokenBudget = options?.tokenBudget ?? 4000;
  const minSimilarity = options?.minSimilarity ?? 0.3;

  // Generate embedding for query
  const embedding = await generateEmbedding(query);
  const embeddingStr = `[${embedding.join(",")}]`;

  // Vector similarity search using cosine distance (<=>)
  const rows = (await db.execute(sql`
    SELECT
      sc.id,
      sc.source_id,
      sc.chunk_index,
      sc.content,
      sc.token_count,
      sc.embedding <=> ${embeddingStr}::vector AS similarity,
      s.file_name,
      s.source_kind,
      s.citation
    FROM source_chunks sc
    JOIN sources s ON s.id = sc.source_id
    WHERE sc.project_id = ${projectId}
      AND sc.embedding <=> ${embeddingStr}::vector < ${1 - minSimilarity}
    ORDER BY sc.embedding <=> ${embeddingStr}::vector
    LIMIT ${topK * 3}
  `)) as unknown as Array<{
    id: string;
    source_id: string;
    chunk_index: number;
    content: string;
    token_count: number;
    similarity: number;
    file_name: string;
    source_kind: string;
    citation: string | null;
  }>;

  // Deduplicate by source, keep highest similarity (already sorted by similarity)
  const seen = new Set<string>();
  const deduped: typeof rows = [];
  for (const row of rows) {
    if (seen.has(row.source_id)) continue;
    seen.add(row.source_id);
    deduped.push(row);
  }

  // Accumulate within token budget
  const chunks: RetrievedChunk[] = [];
  let totalTokens = 0;
  for (const row of deduped) {
    if (totalTokens + row.token_count > tokenBudget) break;
    chunks.push({
      sourceId: row.source_id,
      sourceFileName: row.file_name,
      sourceKind: row.source_kind,
      citation: row.citation,
      chunkIndex: row.chunk_index,
      content: row.content,
      tokenCount: row.token_count,
      similarity: row.similarity,
    });
    totalTokens += row.token_count;
    if (chunks.length >= topK) break;
  }

  // Build context text
  let contextText = "";
  if (chunks.length > 0) {
    contextText = "## Source Material\n\n";
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      const cite = c.citation ? ` (${c.citation})` : "";
      contextText += `[Source ${i + 1} | ${c.sourceKind} | ${c.sourceFileName}${cite}]\n${c.content}\n\n`;
    }
  }

  return { chunks, contextText };
}
