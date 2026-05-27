const COHERE_API_URL = "https://api.cohere.com/v1/rerank";
const RERANK_TIMEOUT_MS = 10_000;

interface CohereRerankResult {
  index: number;
  relevance_score: number;
}

interface CohereRerankResponse {
  results: CohereRerankResult[];
}

export interface RerankedDoc {
  index: number;
  /** 0-1 relevance score, or null if rerank was skipped (no key / API error) */
  score: number | null;
}

/**
 * Rerank documents using Cohere Rerank.
 * Falls back to original vector order on error — never blocks the pipeline.
 */
export async function rerank(
  query: string,
  documents: string[],
  options?: {
    topN?: number;
    model?: string;
  },
): Promise<RerankedDoc[]> {
  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey) {
    console.warn("[rerank] COHERE_API_KEY not set — skipping rerank");
    return documents.map((_, i) => ({ index: i, score: null }));
  }

  const topN = options?.topN ?? documents.length;
  const model = options?.model ?? "rerank-multilingual-v3.0";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RERANK_TIMEOUT_MS);

  try {
    const response = await fetch(COHERE_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        query,
        documents,
        top_n: topN,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(
        `[rerank] Cohere API error ${response.status}: ${await response.text().catch(() => "")}`,
      );
      return documents.map((_, i) => ({ index: i, score: null }));
    }

    const data: CohereRerankResponse = await response.json();
    return data.results.map((r) => ({ index: r.index, score: r.relevance_score }));
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      console.warn("[rerank] Cohere call timed out after", RERANK_TIMEOUT_MS, "ms");
    } else {
      console.warn("[rerank] Cohere call failed:", err);
    }
    return documents.map((_, i) => ({ index: i, score: null }));
  } finally {
    clearTimeout(timeout);
  }
}
