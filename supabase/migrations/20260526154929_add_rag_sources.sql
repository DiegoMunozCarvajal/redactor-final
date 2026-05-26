-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create source_kind enum
DO $$ BEGIN
  CREATE TYPE source_kind AS ENUM ('reference', 'example', 'mixed', 'unknown');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Create sources table
CREATE TABLE sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL DEFAULT 'markdown',
  source_kind source_kind NOT NULL DEFAULT 'unknown',
  extracted_text TEXT NOT NULL,
  citation TEXT,
  processed BOOLEAN NOT NULL DEFAULT false,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sources_project_id ON sources(project_id);

-- Create source_chunks table
CREATE TABLE source_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  embedding vector(1536) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_source_chunks_project_id ON source_chunks(project_id);
CREATE INDEX idx_source_chunks_source_id ON source_chunks(source_id);

-- HNSW vector index for fast similarity search
CREATE INDEX idx_source_chunks_embedding_hnsw
  ON source_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
