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

async function searchSemanticScholar(query: string): Promise<SearchResult[]> {
  const apiKey = process.env.SEMANTIC_SCHOLAR_API_KEY;
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=3&fields=title,url,abstract,publicationDate`;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    console.warn("[web-search] Semantic Scholar returned non-ok status:", res.status);
    return [];
  }

  const data = await res.json();
  return (data.data ?? []).map((r: SSPaper) => ({
    title: r.title ?? "",
    url: r.url ?? `https://api.semanticscholar.org/CorpusID:${r.paperId}`,
    snippet: (r.abstract ?? "").slice(0, 600),
    provider: "semantic-scholar" as const,
    publishedDate: r.publicationDate,
  }));
}

/**
 * Search the web via Exa (primary), falling back to Tavily, with Semantic Scholar for academic queries.
 */
export async function webSearch(query: string): Promise<SearchResult[]> {
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

  // Semantic Scholar always (for academic queries)
  try {
    const ssResults = await searchSemanticScholar(query);
    results.push(...ssResults);
  } catch (err) {
    console.warn("[web-search] Semantic Scholar unavailable:", (err as Error).message);
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
