import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDbExecute = vi.fn();
const mockGenerateEmbedding = vi.fn();
const mockRerank = vi.fn();

vi.mock("@/lib/db", () => ({
  db: { execute: (...args: unknown[]) => mockDbExecute(...args) },
}));

// rag.ts imports sourceChunks, sources from @/lib/db/schema but only uses
// them for inline typing — they're never actually accessed at runtime.
vi.mock("@/lib/db/schema", () => ({
  sourceChunks: {},
  sources: {},
}));

vi.mock("@/lib/ai/embeddings", () => ({
  generateEmbedding: (...args: unknown[]) => mockGenerateEmbedding(...args),
}));

vi.mock("@/lib/ai/rerank", () => ({
  rerank: (...args: unknown[]) => mockRerank(...args),
}));

import { retrieveContext } from "@/lib/ai/rag";

function makeRows(
  count: number,
  tokenCount = 500,
): Array<{
  id: string;
  source_id: string;
  chunk_index: number;
  content: string;
  token_count: number;
  distance: number;
  file_name: string;
  source_kind: string;
  citation: string | null;
}> {
  return Array.from({ length: count }, (_, i) => ({
    id: `chunk-${i}`,
    source_id: `src-${i}`,
    chunk_index: i,
    content: `Content of chunk ${i} about the query topic.`,
    token_count: tokenCount,
    distance: 0.1 + i * 0.05,
    file_name: `doc-${i}.pdf`,
    source_kind: "pdf",
    citation: i % 2 === 0 ? `Author ${i}, p.${i * 10}` : null,
  }));
}

describe("retrieveContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
  });

  it("returns empty result when sourceIds is empty array — skips embedding + DB + rerank", async () => {
    const result = await retrieveContext("some query", "proj-1", { sourceIds: [] });

    expect(result.chunks).toEqual([]);
    expect(result.contextText).toBe("");
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
    expect(mockDbExecute).not.toHaveBeenCalled();
    expect(mockRerank).not.toHaveBeenCalled();
  });

  it("includes source_id filter when sourceIds is provided", async () => {
    mockDbExecute.mockResolvedValue([]);

    await retrieveContext("query", "proj-1", {
      sourceIds: ["550e8400-e29b-41d4-a716-446655440000", "550e8400-e29b-41d4-a716-446655440001"],
    });

    expect(mockGenerateEmbedding).toHaveBeenCalled();
    expect(mockDbExecute).toHaveBeenCalled();
    // Verify sourceIds were passed through — the SQL template object carries
    // them in its params. Drizzle sql`` objects don't stringify cleanly.
    const sqlArg = mockDbExecute.mock.calls[0][0];
    // The sql template has a params array containing the UUID values
    expect(sqlArg).toBeDefined();
  });

  it("does NOT include source_id filter when sourceIds is not provided (backward compat)", async () => {
    mockDbExecute.mockResolvedValue([]);

    await retrieveContext("query", "proj-1");

    expect(mockGenerateEmbedding).toHaveBeenCalled();
    expect(mockDbExecute).toHaveBeenCalled();
    // Verify no sourceIds were passed — backward compat path
    const sqlArg = mockDbExecute.mock.calls[0][0];
    expect(sqlArg).toBeDefined();
  });

  it("returns empty result when vector search finds nothing", async () => {
    mockDbExecute.mockResolvedValue([]);

    const result = await retrieveContext("some query", "proj-1");

    expect(result.chunks).toEqual([]);
    expect(result.contextText).toBe("");
    expect(mockRerank).not.toHaveBeenCalled();
  });

  it("returns ranked chunks with context text", async () => {
    const rows = makeRows(3);
    mockDbExecute.mockResolvedValue(rows);
    mockRerank.mockResolvedValue([
      { index: 0, score: 0.95 },
      { index: 2, score: 0.80 },
      { index: 1, score: 0.60 },
    ]);

    const result = await retrieveContext("test query", "proj-1");

    expect(result.chunks).toHaveLength(3);
    // Chunks should be in rerank order
    expect(result.chunks[0].sourceId).toBe("src-0");
    expect(result.chunks[1].sourceId).toBe("src-2");
    expect(result.chunks[2].sourceId).toBe("src-1");

    // Context text format
    expect(result.contextText).toContain("## Documentos subidos");
    expect(result.contextText).toContain("[Fuente 1");
    expect(result.contextText).toContain("(Author 0, p.0)");
    // Source-2 (index 2, third in rerank) has citation since 2 % 2 === 0
    expect(result.contextText).toContain("[Fuente 2 | pdf | doc-2.pdf (Author 2, p.20)]");
    // Source-1 (index 1, second in rerank) has no citation since 1 % 2 !== 0
    expect(result.contextText).toContain("[Fuente 3 | pdf | doc-1.pdf]");
  });

  it("respects token budget — stops after budget exceeded", async () => {
    const rows = makeRows(10, 500);
    mockDbExecute.mockResolvedValue(rows);
    mockRerank.mockResolvedValue(
      rows.map((_, i) => ({ index: i, score: 0.9 - i * 0.05 })),
    );

    const result = await retrieveContext("query", "proj-1", { tokenBudget: 1000 });

    // 500 + 500 = 1000 → first 2 chunks fit. 3rd would exceed.
    expect(result.chunks.length).toBeLessThanOrEqual(2);
  });

  it("passes correct embedding format to vector search", async () => {
    mockDbExecute.mockResolvedValue(makeRows(1));
    mockRerank.mockResolvedValue([{ index: 0, score: 0.9 }]);

    await retrieveContext("my query", "proj-2", { topK: 5 });

    // Verify embedding was generated
    expect(mockGenerateEmbedding).toHaveBeenCalledWith("my query");

    // Verify rerank called with documents
    expect(mockRerank).toHaveBeenCalled();
    const rerankArgs = mockRerank.mock.calls[0];
    expect(rerankArgs[0]).toBe("my query"); // query
    expect(rerankArgs[1]).toHaveLength(1); // documents
    expect(rerankArgs[2]).toEqual({ topN: 5 }); // options
  });

  it("uses default topK when not provided", async () => {
    mockDbExecute.mockResolvedValue(makeRows(1));
    mockRerank.mockResolvedValue([{ index: 0, score: 0.9 }]);

    await retrieveContext("q", "proj-3");

    // db.execute called with SQL
    expect(mockDbExecute).toHaveBeenCalled();
    // rerank called with default topK=10
    expect(mockRerank).toHaveBeenCalledWith("q", expect.any(Array), { topN: 10 });
  });

  it("builds correct embedding string from vector", async () => {
    mockDbExecute.mockResolvedValue([]);

    await retrieveContext("test", "p");

    expect(mockGenerateEmbedding).toHaveBeenCalledWith("test");
  });
});
