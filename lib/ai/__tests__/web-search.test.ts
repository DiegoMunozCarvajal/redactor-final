import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// searchSemanticScholar has module-level ssCache — resetModules prevents test pollution.
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("EXA_API_KEY", "exa-key-123");
  vi.stubEnv("TAVILY_API_KEY", "tavily-key-456");
  vi.stubEnv("SEMANTIC_SCHOLAR_API_KEY", "ss-key-789");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function stubFetch(
  ...responses: Array<{ ok: boolean; status?: number; json: () => unknown } | Error>
) {
  let callCount = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => {
      const r = responses[callCount] ?? responses[responses.length - 1];
      callCount++;
      if (r instanceof Error) return Promise.reject(r);
      return Promise.resolve({
        ok: r.ok,
        status: r.status ?? 200,
        json: r.json,
        text: () => Promise.resolve(""),
      });
    }),
  );
}

function exaOk(items: Array<{ title: string; url: string; text: string }>) {
  return { ok: true, json: () => Promise.resolve({ results: items }) };
}
function tavilyOk(items: Array<{ title: string; url: string; content: string }>) {
  return { ok: true, json: () => Promise.resolve({ results: items }) };
}
function ssOk(papers: Array<{ title: string; abstract: string; paperId: string }>) {
  return { ok: true, json: () => Promise.resolve({ data: papers }) };
}
const err500 = { ok: false, status: 500, json: () => Promise.resolve({}) };
const emptySS = { ok: true, json: () => Promise.resolve({ data: [] }) };

describe("webSearch", () => {
  it("returns Exa results on success (primary)", async () => {
    stubFetch(
      exaOk([{ title: "R1", url: "https://ex.com/1", text: "content" }]),
      emptySS,
    );
    const { webSearch } = await import("@/lib/ai/web-search");
    const results = await webSearch("q1");
    expect(results).toHaveLength(1);
    expect(results[0].provider).toBe("exa");
  });

  it("falls back to Tavily when Exa fails", async () => {
    stubFetch(
      err500,
      tavilyOk([{ title: "Tav", url: "https://tv.com/1", content: "tavily" }]),
      emptySS,
    );
    const { webSearch } = await import("@/lib/ai/web-search");
    const results = await webSearch("q2");
    expect(results).toHaveLength(1);
    expect(results[0].provider).toBe("tavily");
  });

  it("includes Semantic Scholar alongside Exa by default", async () => {
    stubFetch(
      exaOk([{ title: "Exa", url: "https://a.com", text: "a" }]),
      ssOk([{ title: "Paper", abstract: "academic", paperId: "p1" }]),
    );
    const { webSearch } = await import("@/lib/ai/web-search");
    const results = await webSearch("q3");
    const providers = results.map((r) => r.provider);
    expect(providers).toContain("exa");
    expect(providers).toContain("semantic-scholar");
  });

  it("skips Semantic Scholar when semanticScholar: false", async () => {
    stubFetch(
      exaOk([{ title: "Exa", url: "https://a.com", text: "a" }]),
    );
    const { webSearch } = await import("@/lib/ai/web-search");
    const results = await webSearch("q4", { semanticScholar: false });
    expect(results.every((r) => r.provider !== "semantic-scholar")).toBe(true);
  });

  it("returns empty array when all providers fail", async () => {
    stubFetch(err500, err500, emptySS);
    const { webSearch } = await import("@/lib/ai/web-search");
    const results = await webSearch("q5");
    expect(results).toEqual([]);
  });
});

describe("searchSemanticScholar", () => {
  it("returns parsed papers on success", async () => {
    stubFetch(ssOk([{ title: "Paper A", abstract: "abstract text", paperId: "abc" }]));
    const { searchSemanticScholar } = await import("@/lib/ai/web-search");
    const results = await searchSemanticScholar("ml");
    expect(results).toHaveLength(1);
    expect(results[0].provider).toBe("semantic-scholar");
    expect(results[0].title).toBe("Paper A");
  });

  it("returns empty array on non-429, non-2xx error", async () => {
    stubFetch({ ok: false, status: 400, json: () => Promise.resolve({}) });
    const { searchSemanticScholar } = await import("@/lib/ai/web-search");
    const results = await searchSemanticScholar("bad");
    expect(results).toEqual([]);
  });
});

describe("webSearchBatch", () => {
  it("returns object with all query keys and arrays", async () => {
    stubFetch(
      exaOk([{ title: "A", url: "https://a.com", text: "aa" }]),
      emptySS,
    );
    const { webSearchBatch } = await import("@/lib/ai/web-search");
    const results = await webSearchBatch(["single"]);
    expect(Object.keys(results)).toEqual(["single"]);
    expect(Array.isArray(results["single"])).toBe(true);
  });

  it("returns empty array for failed queries", async () => {
    stubFetch(err500, err500, emptySS);
    const { webSearchBatch } = await import("@/lib/ai/web-search");
    const results = await webSearchBatch(["fail"]);
    expect(results["fail"]).toEqual([]);
  });
});
