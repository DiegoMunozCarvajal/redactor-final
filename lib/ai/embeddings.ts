import { getOpenAIClient } from "./clients/openai";
import { EMBEDDING_MODEL, EMBEDDING_BATCH_SIZE } from "@/lib/constants";

/**
 * Generate an embedding for a single text string.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const client = getOpenAIClient();
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });
  const item = response.data[0];
  if (!item) throw new Error("OpenAI embeddings returned empty data array");
  return item.embedding;
}

/**
 * Generate embeddings for multiple texts in batches.
 * Returns embeddings in the same order as the input texts.
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const client = getOpenAIClient();
  const embeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
    const response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch,
    });
    embeddings.push(...response.data.map((d) => d.embedding));
  }

  return embeddings;
}
