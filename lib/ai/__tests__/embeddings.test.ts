import { describe, it, expect } from "vitest";
import { mockOpenAI } from "@/lib/__tests__/helpers/ai-mocks";

mockOpenAI({ embedding: [0.1, 0.2, 0.3] });

const { generateEmbedding, generateEmbeddings, EmbeddingError, EMBEDDING_DIMENSIONS } =
  await import("@/lib/ai/embeddings");

describe("embeddings", () => {
  describe("EMBEDDING_DIMENSIONS", () => {
    it("is 1536 for text-embedding-3-small", () => {
      expect(EMBEDDING_DIMENSIONS).toBe(1536);
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
    it("returns the mock embedding vector", async () => {
      const result = await generateEmbedding("test text");
      expect(result).toEqual([0.1, 0.2, 0.3]);
    });
  });

  describe("generateEmbeddings", () => {
    it("returns embeddings for multiple texts", async () => {
      const results = await generateEmbeddings(["text a", "text b"]);
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual([0.1, 0.2, 0.3]);
      expect(results[1]).toEqual([0.1, 0.2, 0.3]);
    });
  });
});
