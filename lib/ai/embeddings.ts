import { getOpenAIClient } from "./clients/openai";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const BATCH_SIZE = 100;

export { EMBEDDING_DIMENSIONS };

export class EmbeddingError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "EmbeddingError";
  }
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const openai = getOpenAIClient();
  try {
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text,
    });
    return response.data[0].embedding;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new EmbeddingError(`OpenAI embeddings API call failed: ${msg}`, err);
  }
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const openai = getOpenAIClient();
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    try {
      const response = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: batch,
      });
      allEmbeddings.push(...response.data.map((d) => d.embedding));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const ctx = texts.length > 1
        ? ` (batch ${Math.floor(i / BATCH_SIZE) + 1}, chunks ${i}-${Math.min(i + BATCH_SIZE, texts.length)})`
        : "";
      throw new EmbeddingError(`OpenAI embeddings API call failed${ctx}: ${msg}`, err);
    }
  }

  return allEmbeddings;
}
