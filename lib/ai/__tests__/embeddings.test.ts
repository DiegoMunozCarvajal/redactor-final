import { describe, it, expect, beforeAll } from "vitest";
import { mockOpenAI } from "@/lib/__tests__/helpers/ai-mocks";

mockOpenAI({ embedding: [0.1, 0.2, 0.3] });

const { generateEmbedding, generateEmbeddings, EmbeddingError, getEmbeddingDimensions } =
  await import("@/lib/ai/embeddings");

describe("embeddings", () => {
  beforeAll(() => {
    // generateEmbeddings() resolves provider via env vars — set a dummy so it
    // falls through to the mocked OpenAI client.
    process.env.OPENAI_API_KEY = "test-key";
  });
  describe("getEmbeddingDimensions", () => {
    it("defaults to 1024 (Cohere) before initialization", () => {
      // Before any embedding call, defaults to Cohere dimensions
      expect(getEmbeddingDimensions()).toBe(1024);
    });
  });

  describe("EmbeddingError", () => {
    it("is an Error subclass", () => {
      const err = new EmbeddingError("test");
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("EmbeddingError");
    });

    it("stores cause", () => {
      const cause = new Error("upstream");
      const err = new EmbeddingError("wrapper", cause);
      expect(err.cause).toBe(cause);
    });
  });

  describe("generateEmbedding", () => {
    it("returns the mock embedding vector via multi-provider routing", async () => {
      const result = await generateEmbedding("test text");
      expect(result).toEqual([0.1, 0.2, 0.3]);
    });
  });

  describe("generateEmbeddings", () => {
    it("returns embeddings for multiple texts (falls back to OpenAI)", async () => {
      const results = await generateEmbeddings(["text a", "text b"]);
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual([0.1, 0.2, 0.3]);
      expect(results[1]).toEqual([0.1, 0.2, 0.3]);
    });

    it("sets embedding dimensions after initialization", async () => {
      await generateEmbeddings(["text"]);
      // After initialization via OpenAI fallback, dimensions should be 1536
      expect(getEmbeddingDimensions()).toBe(1536);
    });
  });
});
