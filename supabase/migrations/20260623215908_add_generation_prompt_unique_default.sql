-- Enforce at most one default generation system prompt at the database level.
-- Complements the application-level transaction in the API routes.
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_default_generation_prompt
  ON generation_system_prompts ((1))
  WHERE is_default = true;
