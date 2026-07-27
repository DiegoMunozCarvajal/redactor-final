// Chunking defaults
export const CHUNK_SIZE_TOKENS = 1000;
export const CHUNK_OVERLAP_TOKENS = 200;

// Adaptive chunk sizes by file type — denser formats get smaller chunks
export const CHUNK_SIZE_BY_FILE_TYPE: Record<
  string,
  { size: number; overlap: number }
> = {
  pdf: { size: 800, overlap: 160 },
  txt: { size: 1200, overlap: 200 },
  markdown: { size: 1200, overlap: 200 },
  docx: { size: 1000, overlap: 200 },
};

// Anecdote sources get smaller chunks so individual stories aren't merged.
// A typical Reddit comment / field note is 75–300 tokens; at 350 tokens per
// chunk at most 2 short stories share a chunk, keeping embeddings clean.
export const ANECDOTE_CHUNK_SIZE: { size: number; overlap: number } = {
  size: 350,
  overlap: 0, // no overlap — anecdotes shouldn't bleed into each other
};

// RAG defaults (Phase 2.5: Increased for better context and diversity)
export const RAG_TOP_K = 25;
export const RAG_TOKEN_BUDGET = 8000;

// Embedding batch size (OpenAI allows up to 2048)
export const EMBEDDING_BATCH_SIZE = 100;

// File upload limits
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
export const ACCEPTED_FILE_TYPES = [
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

// UUID v4 format validation
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Stale timeout for generation cleanup — 30 minutes.
// Used by rate-limit, trigger tasks, and API routes.
export const STALE_TIMEOUT_MS = 30 * 60 * 1000;

