import { getOpenAIClient } from "./clients/openai";
import { getCohereClient } from "./clients/cohere";

// ---------------------------------------------------------------------------
// Provider selection — tries Cohere first, falls back to OpenAI.
// Both generateEmbedding() (singular, RAG) and generateEmbeddings() (plural,
// template pipeline) use the same provider resolution.
// ---------------------------------------------------------------------------

type EmbeddingProvider = "cohere" | "openai";

let _resolvedProvider: EmbeddingProvider | null = null;
let _initialized = false;

async function resolveProvider(): Promise<EmbeddingProvider> {
  if (_resolvedProvider) return _resolvedProvider;

  if (process.env.COHERE_API_KEY) {
    _resolvedProvider = "cohere";
    return "cohere";
  }

  if (process.env.OPENAI_API_KEY) {
    _resolvedProvider = "openai";
    return "openai";
  }

  throw new Error("No embedding provider available. Set COHERE_API_KEY or OPENAI_API_KEY.");
}

// ---------------------------------------------------------------------------
// Embedding model constants
// ---------------------------------------------------------------------------

const COHERE_EMBEDDING_MODEL = "embed-multilingual-v3.0";
const COHERE_EMBEDDING_DIMENSIONS = 1024;
const COHERE_BATCH_SIZE = 96;

const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
const OPENAI_EMBEDDING_DIMENSIONS = 1536;
const OPENAI_BATCH_SIZE = 100;

// ---------------------------------------------------------------------------
// Lazy-initialized config — only set after first generateEmbeddings() call.
// Use getEmbeddingModel() / getEmbeddingDimensions() to read safely.
// ---------------------------------------------------------------------------

let _model = COHERE_EMBEDDING_MODEL;
let _dimensions = COHERE_EMBEDDING_DIMENSIONS;

async function initProvider(): Promise<EmbeddingProvider> {
  const provider = await resolveProvider();
  if (provider === "cohere") {
    _model = COHERE_EMBEDDING_MODEL;
    _dimensions = COHERE_EMBEDDING_DIMENSIONS;
  } else {
    _model = OPENAI_EMBEDDING_MODEL;
    _dimensions = OPENAI_EMBEDDING_DIMENSIONS;
  }
  EMBEDDING_MODEL = _model;
  EMBEDDING_DIMENSIONS = _dimensions;
  _initialized = true;
  return provider;
}

/** Returns the active embedding model. Must be called after first embedding call. */
export function getEmbeddingModel(): string {
  return _model;
}

/** Returns the active embedding dimension. Must be called after first embedding call. */
export function getEmbeddingDimensions(): number {
  return _dimensions;
}

// Legacy exports for backward compat — prefer getEmbeddingModel() / getEmbeddingDimensions().
// Use `let` so they reflect the lazily-initialized values.
export let EMBEDDING_MODEL: string;
export let EMBEDDING_DIMENSIONS: number;

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class EmbeddingError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "EmbeddingError";
  }
}

// ---------------------------------------------------------------------------
// generateEmbedding (singular) — multi-provider, for RAG (lib/ai/rag.ts).
// Inserts into PG vector(1024). OpenAI fallback (1536-dim) will fail at
// insert time — prefer Cohere.
// ---------------------------------------------------------------------------

export async function generateEmbedding(text: string): Promise<number[]> {
  const provider = await initProvider();

  if (provider === "cohere") {
    const cohere = getCohereClient();
    try {
      const response = await cohere.embed({
        model: COHERE_EMBEDDING_MODEL,
        texts: [text],
        inputType: "search_document",
      });
      return (response.embeddings as number[][])[0];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new EmbeddingError(`Cohere embeddings API call failed: ${msg}`, err);
    }
  }

  // OpenAI fallback — produces 1536-dim vectors. Will fail on PG vector(1024)
  // insert unless the column is migrated back.
  const openai = getOpenAIClient();
  try {
    const response = await openai.embeddings.create({
      model: OPENAI_EMBEDDING_MODEL,
      input: text,
    });
    return response.data[0].embedding;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new EmbeddingError(`OpenAI embeddings API call failed: ${msg}`, err);
  }
}

// ---------------------------------------------------------------------------
// generateEmbeddings (plural) — multi-provider, for template pipeline.
// Tries Cohere first, falls back to OpenAI.
// ---------------------------------------------------------------------------

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const provider = await initProvider();

  if (provider === "cohere") {
    const cohere = getCohereClient();
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += COHERE_BATCH_SIZE) {
      const batch = texts.slice(i, i + COHERE_BATCH_SIZE);
      try {
        const response = await cohere.embed({
          model: COHERE_EMBEDDING_MODEL,
          texts: batch,
          inputType: "search_document",
        });
        allEmbeddings.push(...(response.embeddings as number[][]));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const ctx = texts.length > 1
          ? ` (batch ${Math.floor(i / COHERE_BATCH_SIZE) + 1}, chunks ${i}-${Math.min(i + COHERE_BATCH_SIZE, texts.length)})`
          : "";
        throw new EmbeddingError(`Cohere embeddings API call failed${ctx}: ${msg}`, err);
      }
    }
    return allEmbeddings;
  }

  // OpenAI fallback
  const openai = getOpenAIClient();
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += OPENAI_BATCH_SIZE) {
    const batch = texts.slice(i, i + OPENAI_BATCH_SIZE);
    try {
      const response = await openai.embeddings.create({
        model: OPENAI_EMBEDDING_MODEL,
        input: batch,
      });
      allEmbeddings.push(...response.data.map((d) => d.embedding));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const ctx = texts.length > 1
        ? ` (batch ${Math.floor(i / OPENAI_BATCH_SIZE) + 1}, chunks ${i}-${Math.min(i + OPENAI_BATCH_SIZE, texts.length)})`
        : "";
      throw new EmbeddingError(`OpenAI embeddings API call failed${ctx}: ${msg}`, err);
    }
  }

  return allEmbeddings;
}
