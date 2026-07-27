import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockExecuteVersionedPrompt, mockGenerateEmbeddings } = vi.hoisted(() => ({
  mockExecuteVersionedPrompt: vi.fn(),
  mockGenerateEmbeddings: vi.fn(),
}));

vi.mock("@/lib/prompts/executor", () => ({
  executeVersionedPrompt: mockExecuteVersionedPrompt,
}));
vi.mock("@/lib/ai/embeddings", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/embeddings")>("@/lib/ai/embeddings");
  return { ...actual, generateEmbeddings: mockGenerateEmbeddings };
});

import { buildSourceProfile, splitText, hashShingles, type SourceProfileInput } from "../source-profile";

function fixtureInput(overrides: Partial<SourceProfileInput> = {}): SourceProfileInput {
  return {
    pipelineRunId: "run-1",
    chapterId: "chapter-1",
    bookTemplateId: "tpl-1",
    title: "Test Chapter",
    contentMd: "Distinct source material repeated across a deterministic fixture.",
    profilerRevisionId: "profile-rev-1",
    model: "test-model",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExecuteVersionedPrompt.mockResolvedValue({
    result: {
      data: {
        elements: [
          {
            id: "risk_1",
            kind: "metaphor",
            canonicalLabel: "melting ice",
            aliases: [],
            sourceChunkIndexes: [0],
            confidence: 0.9,
            distinctiveness: 0.95,
          },
        ],
      },
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, costUsd: 0.01, cacheCreationTokens: 0, cacheReadTokens: 0 },
      durationMs: 1000,
    },
    executionId: "exec-1",
    revision: { id: "rev-1", kind: "source-risk-profiler" } as unknown as import("@/lib/prompts/executor").ExecuteVersionedPromptInput extends { schema?: infer _ } ? never : never,
  } as never);
  mockGenerateEmbeddings.mockImplementation(async (texts: string[]) =>
    texts.map(() => Array(1536).fill(0.1)),
  );
});

describe("splitText", () => {
  it("splits text into overlapping chunks", () => {
    const text = Array(100).fill("word").join(" ");
    const chunks = splitText(text, 50, 10);
    expect(chunks.length).toBeGreaterThan(1);
    // Every chunk should be non-empty
    for (const chunk of chunks) {
      expect(chunk.length).toBeGreaterThan(0);
    }
  });

  it("returns single chunk for short text", () => {
    const chunks = splitText("short text", 700, 100);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe("short text");
  });
});

describe("hashShingles", () => {
  it("returns sorted hex hashes", () => {
    const hashes = hashShingles("the quick brown fox jumps over the lazy dog", 5);
    expect(hashes.length).toBeGreaterThan(0);
    for (const h of hashes) {
      expect(h).toMatch(/^[a-f0-9]{64}$/);
    }
    // Must be sorted
    const sorted = [...hashes].sort();
    expect(hashes).toEqual(sorted);
  });

  it("returns single hash for insufficient words", () => {
    // computeWordShingles returns all words as one shingle when text < n
    const hashes = hashShingles("one two", 5);
    expect(hashes).toHaveLength(1);
    expect(hashes[0]).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("buildSourceProfile", () => {
  it("stores hashes, hashed shingles, embeddings, and no source text", async () => {
    const profile = await buildSourceProfile(fixtureInput());

    expect(profile.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(profile.chunks[0].contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(profile.chunks[0].lexicalFingerprint.shingles5[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(profile)).not.toContain("Distinct source material");
  });

  it("rejects invalid canonicalLabel length", async () => {
    mockExecuteVersionedPrompt.mockResolvedValue({
      result: {
        data: {
          elements: [{
            id: "risk_1",
            kind: "metaphor",
            canonicalLabel: "x".repeat(121),
            aliases: [],
            sourceChunkIndexes: [0],
            confidence: 0.9,
            distinctiveness: 0.95,
          }],
        },
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
        durationMs: 0,
      },
      executionId: "exec-1",
      revision: {},
    } as never);

    await expect(buildSourceProfile(fixtureInput())).rejects.toThrow("canonicalLabel");
  });

  it("stores zero vectors when embedding count mismatches chunk count", async () => {
    // Embedding generation is best-effort — mismatch stores zero vectors instead of throwing.
    const longText = Array(800).fill("palabra").join(" ");
    mockGenerateEmbeddings.mockResolvedValue([Array(1024).fill(0.1)]); // only 1, but will be 2 chunks

    const profile = await buildSourceProfile(fixtureInput({ contentMd: longText }));
    // Should succeed with zero vectors
    expect(profile.chunks).toHaveLength(2);
    expect(profile.chunks[0].embedding.every((v: number) => v === 0)).toBe(true);
    expect(profile.chunks[1].embedding.every((v: number) => v === 0)).toBe(true);
  });

  it("computes stable profile hash", async () => {
    const a = await buildSourceProfile(fixtureInput());
    const b = await buildSourceProfile(fixtureInput());
    expect(a.profileHash).toBe(b.profileHash);
  });

  it("clamps out-of-range chunk indexes instead of rejecting", async () => {
    mockExecuteVersionedPrompt.mockResolvedValue({
      result: {
        data: {
          elements: [{
            id: "risk_1",
            kind: "metaphor",
            canonicalLabel: "test",
            aliases: [],
            sourceChunkIndexes: [99], // out of range — clamped to 0
            confidence: 0.9,
            distinctiveness: 0.95,
          }],
        },
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
        durationMs: 0,
      },
      executionId: "exec-1",
      revision: {},
    } as never);

    const result = await buildSourceProfile(fixtureInput());
    // Chunk index 99 clamped to 0 (single chunk for single-word text)
    expect(result.elements[0].sourceChunkIndexes).toEqual([0]);
  });
});
