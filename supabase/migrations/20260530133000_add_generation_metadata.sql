ALTER TABLE chapter_generations
ADD COLUMN IF NOT EXISTS generation_metadata jsonb;
