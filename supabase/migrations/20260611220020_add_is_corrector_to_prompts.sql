-- Add is_corrector column to prompts and project_prompts
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS is_corrector BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE project_prompts ADD COLUMN IF NOT EXISTS is_corrector BOOLEAN NOT NULL DEFAULT false;
