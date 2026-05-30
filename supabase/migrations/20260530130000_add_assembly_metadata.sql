ALTER TABLE chapter_generations
ADD COLUMN IF NOT EXISTS assembly_metadata jsonb;
