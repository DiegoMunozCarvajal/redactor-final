-- Add is_assembly column
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS is_assembly boolean NOT NULL DEFAULT false;
ALTER TABLE project_prompts ADD COLUMN IF NOT EXISTS is_assembly boolean NOT NULL DEFAULT false;

-- Backfill: mark assembly prompts based on current type
UPDATE prompts SET is_assembly = true WHERE type = 'ensamblaje';
UPDATE project_prompts SET is_assembly = true WHERE type = 'ensamblaje';

-- Drop old type column
ALTER TABLE prompts DROP COLUMN IF EXISTS type;
ALTER TABLE project_prompts DROP COLUMN IF EXISTS type;

-- Drop enum type
DROP TYPE IF EXISTS prompt_type;

-- Enforce single assembly prompt per chapter
CREATE UNIQUE INDEX IF NOT EXISTS idx_prompts_one_assembly_per_chapter
  ON prompts (chapter_id) WHERE is_assembly = true;

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_prompts_one_assembly_per_chapter
  ON project_prompts (chapter_id, project_id) WHERE is_assembly = true;

-- Version history for assembly prompts (no FK — stores both prompts.id and project_prompts.id)
CREATE TABLE IF NOT EXISTS prompt_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id uuid NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prompt_versions_prompt_id ON prompt_versions (prompt_id);
