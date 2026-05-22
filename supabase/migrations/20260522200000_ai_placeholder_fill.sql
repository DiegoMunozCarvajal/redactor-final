-- Add project description
ALTER TABLE projects ADD COLUMN IF NOT EXISTS description text;

-- Create chapter_briefs
CREATE TABLE IF NOT EXISTS chapter_briefs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id uuid NOT NULL UNIQUE REFERENCES chapters(id) ON DELETE CASCADE,
  content    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Create chapter_config_prompts
CREATE TABLE IF NOT EXISTS chapter_config_prompts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id uuid NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  type       text NOT NULL,
  content    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_config_prompts_unique
  ON chapter_config_prompts (chapter_id, type);
