-- Add is_critique column to prompts and project_prompts
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS is_critique BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE project_prompts ADD COLUMN IF NOT EXISTS is_critique BOOLEAN NOT NULL DEFAULT false;
