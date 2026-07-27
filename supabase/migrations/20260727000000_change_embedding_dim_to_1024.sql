-- Change source_chunks embedding dimension from 1536 (OpenAI) to 1024 (Cohere).
-- Existing 1536-dim vectors are incompatible — drop and recreate.
-- Data loss is acceptable: original sources can be re-indexed.

-- 1. Drop old column
ALTER TABLE source_chunks DROP COLUMN embedding;

-- 2. Add new column (allow nulls initially for existing rows)
ALTER TABLE source_chunks ADD COLUMN embedding vector(1024);

-- 3. Fill existing rows with zero vectors
UPDATE source_chunks SET embedding = array_fill(0::real, ARRAY[1024])::vector WHERE embedding IS NULL;

-- 4. Enforce NOT NULL
ALTER TABLE source_chunks ALTER COLUMN embedding SET NOT NULL;
