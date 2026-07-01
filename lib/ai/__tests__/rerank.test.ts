import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { rerank } from "@/lib/ai/rerank";

describe("rerank", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    // Suppress console.warn during tests
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // ---------------------------------------------------------------------------
  // No API key — graceful fallback
  // ---------------------------------------------------------------------------

  it("returns null scores when COHERE_API_KEY is not set", async () => {
    delete (process.env as Record<string, string>).COHERE_API_KEY;

    const result = await rerank("test query", ["doc a", "doc b"]);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ index: 0, score: null });
    expect(result[1]).toEqual({ index: 1, score: null });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Successful API response
  // ---------------------------------------------------------------------------

  it("returns scored results on successful rerank", async () => {
    process.env.COHERE_API_KEY = "test-key";
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [
            { index: 1, relevance_score: 0.95 },
            { index: 0, relevance_score: 0.3 },
          ],
        }),
    });

    const result = await rerank("q", ["first", "second"]);

    expect(result).toHaveLength(2);
    expect(result[0].index).toBe(1);
    expect(result[0].score).toBe(0.95);
    expect(result[1].index).toBe(0);
    expect(result[1].score).toBe(0.3);
  });

  // ---------------------------------------------------------------------------
  // API error — graceful fallback
  // ---------------------------------------------------------------------------

  it("returns null scores on API error response", async () => {
    process.env.COHERE_API_KEY = "test-key";
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: () => Promise.resolve("rate limited"),
    });

    const result = await rerank("q", ["doc a", "doc b"]);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ index: 0, score: null });
    expect(result[1]).toEqual({ index: 1, score: null });
  });

  it("returns null scores on network error", async () => {
    process.env.COHERE_API_KEY = "test-key";
    mockFetch.mockRejectedValueOnce(new Error("connection refused"));

    const result = await rerank("q", ["doc"]);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ index: 0, score: null });
  });

  // ---------------------------------------------------------------------------
  // Passes correct request params
  // ---------------------------------------------------------------------------

  it("passes correct request body and headers", async () => {
    process.env.COHERE_API_KEY = "test-key";
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ results: [] }),
    });

    await rerank("my query", ["d1", "d2"], { topN: 2, model: "custom-model" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.cohere.com/v1/rerank");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer test-key",
      "Content-Type": "application/json",
    });

    const body = JSON.parse(init.body);
    expect(body.query).toBe("my query");
    expect(body.documents).toEqual(["d1", "d2"]);
    expect(body.top_n).toBe(2);
    expect(body.model).toBe("custom-model");
  });

  it("defaults topN to documents.length", async () => {
    process.env.COHERE_API_KEY = "test-key";
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ results: [] }),
    });

    await rerank("q", ["a", "b", "c"]);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.top_n).toBe(3);
  });
});
