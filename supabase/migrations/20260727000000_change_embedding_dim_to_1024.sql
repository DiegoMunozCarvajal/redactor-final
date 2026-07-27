-- Change source_chunks embedding dimension from 1536 (OpenAI) to 1024 (Cohere).
-- pgvector allows ALTER COLUMN TYPE for dimension changes.
-- Existing data (if any) will be truncated/padded — re-index after migration.

ALTER TABLE source_chunks
  ALTER COLUMN embedding TYPE vector(1024);
