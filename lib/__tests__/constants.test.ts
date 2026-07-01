import { describe, it, expect } from "vitest";
import {
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  CHUNK_SIZE_TOKENS,
  CHUNK_OVERLAP_TOKENS,
  CHUNK_SIZE_BY_FILE_TYPE,
  ANECDOTE_CHUNK_SIZE,
  RAG_TOP_K,
  RAG_TOKEN_BUDGET,
  EMBEDDING_BATCH_SIZE,
  MAX_FILE_SIZE_BYTES,
  ACCEPTED_FILE_TYPES,
  UUID_RE,
} from "@/lib/constants";

describe("constants", () => {
  describe("embeddings", () => {
    it("EMBEDDING_MODEL is a non-empty string", () => {
      expect(typeof EMBEDDING_MODEL).toBe("string");
      expect(EMBEDDING_MODEL.length).toBeGreaterThan(0);
    });

    it("EMBEDDING_DIMENSIONS is a positive number", () => {
      expect(EMBEDDING_DIMENSIONS).toBeGreaterThan(0);
    });

    it("EMBEDDING_BATCH_SIZE is within OpenAI limit", () => {
      expect(EMBEDDING_BATCH_SIZE).toBeGreaterThan(0);
      expect(EMBEDDING_BATCH_SIZE).toBeLessThanOrEqual(2048);
    });
  });

  describe("chunking", () => {
    it("CHUNK_SIZE_TOKENS > CHUNK_OVERLAP_TOKENS", () => {
      expect(CHUNK_SIZE_TOKENS).toBeGreaterThan(CHUNK_OVERLAP_TOKENS);
    });

    it("CHUNK_SIZE_BY_FILE_TYPE covers known formats", () => {
      expect(CHUNK_SIZE_BY_FILE_TYPE).toHaveProperty("pdf");
      expect(CHUNK_SIZE_BY_FILE_TYPE).toHaveProperty("txt");
      expect(CHUNK_SIZE_BY_FILE_TYPE).toHaveProperty("markdown");
      expect(CHUNK_SIZE_BY_FILE_TYPE).toHaveProperty("docx");
    });

    it("ANECDOTE_CHUNK_SIZE has no overlap", () => {
      expect(ANECDOTE_CHUNK_SIZE.overlap).toBe(0);
      expect(ANECDOTE_CHUNK_SIZE.size).toBeGreaterThan(0);
    });
  });

  describe("RAG", () => {
    it("RAG_TOP_K is positive", () => {
      expect(RAG_TOP_K).toBeGreaterThan(0);
    });

    it("RAG_TOKEN_BUDGET is positive", () => {
      expect(RAG_TOKEN_BUDGET).toBeGreaterThan(0);
    });
  });

  describe("file upload", () => {
    it("MAX_FILE_SIZE_BYTES is 50MB", () => {
      expect(MAX_FILE_SIZE_BYTES).toBe(50 * 1024 * 1024);
    });

    it("ACCEPTED_FILE_TYPES includes expected MIME types", () => {
      expect(ACCEPTED_FILE_TYPES).toContain("application/pdf");
      expect(ACCEPTED_FILE_TYPES).toContain("text/plain");
    });
  });

  describe("UUID_RE", () => {
    it("matches valid UUID v4", () => {
      expect(UUID_RE.test("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    });

    it("matches UUID in uppercase", () => {
      expect(UUID_RE.test("550E8400-E29B-41D4-A716-446655440000")).toBe(true);
    });

    it("rejects non-UUID strings", () => {
      expect(UUID_RE.test("not-a-uuid")).toBe(false);
      expect(UUID_RE.test("")).toBe(false);
      expect(UUID_RE.test("550e8400-e29b-41d4-a716")).toBe(false);
    });

    it("rejects UUID with extra characters", () => {
      expect(UUID_RE.test("550e8400-e29b-41d4-a716-446655440000-extra")).toBe(false);
    });
  });
});
