const EXA_API_URL = "https://api.exa.ai/search";
const TAVILY_API_URL = "https://api.tavily.com/search";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  provider: "exa" | "tavily" | "semantic-scholar";
  publishedDate?: string;
}

interface ExaResultItem {
  title?: string;
  url?: string;
  text?: string;
  publishedDate?: string;
}

interface TavilyResultItem {
  title?: string;
  url?: string;
  content?: string;
  published_date?: string;
}

interface SSPaper {
  title?: string;
  url?: string;
  abstract?: string;
  paperId?: string;
  publicationDate?: string;
}

async function searchExa(query: string): Promise<SearchResult[]> {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) throw new Error("EXA_API_KEY not set");

  const res = await fetch(EXA_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      query,
      numResults: 3,
      contents: { text: true },
    }),
  });

  if (!res.ok) throw new Error(`Exa search failed: ${res.status}`);
  const data = await res.json();
  return (data.results ?? []).map((r: ExaResultItem) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: (r.text ?? "").slice(0, 600),
    provider: "exa" as const,
    publishedDate: r.publishedDate,
  }));
}

async function searchTavily(query: string): Promise<SearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY not set");

  const res = await fetch(TAVILY_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "basic",
      max_results: 3,
    }),
  });

  if (!res.ok) throw new Error(`Tavily search failed: ${res.status}`);
  const data = await res.json();
  return (data.results ?? []).map((r: TavilyResultItem) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: (r.content ?? "").slice(0, 600),
    provider: "tavily" as const,
    publishedDate: r.published_date,
  }));
}

// Simple in-memory cache to avoid duplicate requests during a single process lifetime.
// Keys are query strings; values live until process restart (serverless-friendly).
const ssCache = new Map<string, SearchResult[]>();

// Rate limiter: Semantic Scholar allows 1 rps with an API key, shares a single
// pool without one. Track the last request time globally so concurrent
// callers (e.g. fillOnePlaceholder + webSearch) don't burst.
let ssLastRequest = 0;

function ssMinInterval(apiKey: string | undefined): number {
  return apiKey ? 1000 : 3000; // ms between requests
}

async function ssWaitForSlot(apiKey: string | undefined): Promise<void> {
  const now = Date.now();
  const elapsed = now - ssLastRequest;
  const min = ssMinInterval(apiKey);
  if (elapsed < min) {
    await new Promise((r) => setTimeout(r, min - elapsed));
  }
  ssLastRequest = Date.now();
}

export async function searchSemanticScholar(query: string): Promise<SearchResult[]> {
  // Cache hit: skip the API call entirely (same query → same results).
  const cached = ssCache.get(query);
  if (cached) return cached;

  const apiKey = process.env.SEMANTIC_SCHOLAR_API_KEY;
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=3&fields=title,url,abstract,publicationDate`;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;

  let lastStatus = 0;

  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 2s, 4s, 8s, 16s. Works for both authenticated
      // (1 rps individual quota) and unauthenticated (shared pool).
      const wait = 2 ** attempt * 1000;
      console.warn(`[web-search] Semantic Scholar retry ${attempt + 1}/5 after ${wait}ms (status ${lastStatus})`);
      await new Promise((r) => setTimeout(r, wait));
    }

    // Enforce rate limit (1 rps with key, 3s without).
    await ssWaitForSlot(apiKey);

    let res: Response;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20_000);
      res = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(timeout);
    } catch (err) {
      console.warn(`[web-search] Semantic Scholar fetch error (attempt ${attempt + 1}):`, (err as Error).message);
      lastStatus = 0;
      continue;
    }

    lastStatus = res.status;

    if (res.ok) {
      const data = await res.json();
      const results = (data.data ?? []).map((r: SSPaper) => ({
        title: r.title ?? "",
        url: r.url ?? `https://api.semanticscholar.org/CorpusID:${r.paperId}`,
        snippet: (r.abstract ?? "").slice(0, 600),
        provider: "semantic-scholar" as const,
        publishedDate: r.publicationDate,
      }));
      ssCache.set(query, results);
      return results;
    }

    if (res.status === 429) continue; // retry with backoff

    // Non-429, non-2xx → don't retry
    const body = await res.text().catch(() => "");
    console.warn(`[web-search] Semantic Scholar returned ${res.status}: ${body.slice(0, 200)}`);
    return [];
  }

  // Exhausted all retries (all 429s or mixed failures)
  console.warn(`[web-search] Semantic Scholar exhausted retries for query: ${query}`);
  return [];
}

/**
 * Search the web via Exa (primary), falling back to Tavily, with optional Semantic Scholar.
 * Set `semanticScholar: false` for non-academic queries to avoid irrelevant paper results.
 */
export async function webSearch(
  query: string,
  opts?: { semanticScholar?: boolean },
): Promise<SearchResult[]> {
  const includeSS = opts?.semanticScholar ?? true;
  const results: SearchResult[] = [];

  // Exa first (primary)
  try {
    const exaResults = await searchExa(query);
    results.push(...exaResults);
  } catch (err) {
    console.warn("[web-search] Exa failed, falling back to Tavily:", (err as Error).message);
    try {
      const tavilyResults = await searchTavily(query);
      results.push(...tavilyResults);
    } catch (err2) {
      console.warn("[web-search] Tavily also failed:", (err2 as Error).message);
    }
  }

  // Semantic Scholar — skip for non-academic queries to avoid irrelevant results
  if (includeSS) {
    try {
      const ssResults = await searchSemanticScholar(query);
      results.push(...ssResults);
    } catch (err) {
      console.warn("[web-search] Semantic Scholar unavailable:", (err as Error).message);
    }
  }

  return results;
}

/**
 * Search multiple queries in parallel and return results keyed by query.
 */
export async function webSearchBatch(queries: string[]): Promise<Record<string, SearchResult[]>> {
  const results: Record<string, SearchResult[]> = {};
  const settled = await Promise.allSettled(queries.map((q) => webSearch(q)));
  for (let i = 0; i < queries.length; i++) {
    const result = settled[i];
    results[queries[i]] = result.status === "fulfilled" ? result.value : [];
  }
  return results;
}
