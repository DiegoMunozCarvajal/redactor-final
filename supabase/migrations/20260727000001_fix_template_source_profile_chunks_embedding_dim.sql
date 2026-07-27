-- Fix embedding dimensions: change both source_chunks and
-- template_source_profile_chunks from vector(1536) to vector(1024)
-- to match Cohere embed-multilingual-v3.0 output.
-- Drop + recreate — existing 1536-dim data is incompatible and will be lost.

-- 1. source_chunks (RAG)
ALTER TABLE source_chunks DROP COLUMN IF EXISTS embedding;
ALTER TABLE source_chunks ADD COLUMN embedding vector(1024);
UPDATE source_chunks SET embedding = array_fill(0::real, ARRAY[1024])::vector WHERE embedding IS NULL;
ALTER TABLE source_chunks ALTER COLUMN embedding SET NOT NULL;

-- 2. template_source_profile_chunks (template pipeline)
ALTER TABLE template_source_profile_chunks DROP COLUMN IF EXISTS embedding;
ALTER TABLE template_source_profile_chunks ADD COLUMN embedding vector(1024);
UPDATE template_source_profile_chunks SET embedding = array_fill(0::real, ARRAY[1024])::vector WHERE embedding IS NULL;
ALTER TABLE template_source_profile_chunks ALTER COLUMN embedding SET NOT NULL;
