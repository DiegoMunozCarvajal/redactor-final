-- Change embedding dimensions from 1536 (OpenAI) to 1024 (Cohere).
-- Existing 1536-dim vectors are incompatible — drop and recreate.
-- Data loss is acceptable: original sources can be re-indexed.

-- 1. source_chunks (RAG)
ALTER TABLE source_chunks DROP COLUMN embedding;
ALTER TABLE source_chunks ADD COLUMN embedding vector(1024);
UPDATE source_chunks SET embedding = array_fill(0::real, ARRAY[1024])::vector WHERE embedding IS NULL;
ALTER TABLE source_chunks ALTER COLUMN embedding SET NOT NULL;

-- 2. template_source_profile_chunks (template pipeline)
ALTER TABLE template_source_profile_chunks DROP COLUMN embedding;
ALTER TABLE template_source_profile_chunks ADD COLUMN embedding vector(1024);
UPDATE template_source_profile_chunks SET embedding = array_fill(0::real, ARRAY[1024])::vector WHERE embedding IS NULL;
ALTER TABLE template_source_profile_chunks ALTER COLUMN embedding SET NOT NULL;
