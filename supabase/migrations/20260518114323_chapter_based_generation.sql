-- Create enums
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'generation_status') THEN
    CREATE TYPE generation_status AS ENUM ('generating', 'completed', 'failed');
  END IF;
END
$$;

-- Create project_prompts table
CREATE TABLE IF NOT EXISTS project_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_id uuid NOT NULL REFERENCES chapters(id) ON DELETE RESTRICT,
  position integer NOT NULL,
  type prompt_type NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  style_rules text,
  knowledge_areas text,
  suggested_length text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create chapter_generations table
CREATE TABLE IF NOT EXISTS chapter_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_id uuid NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  status generation_status NOT NULL DEFAULT 'generating',
  assembled_content text,
  error text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS idx_chapter_generations_project ON chapter_generations(project_id, chapter_id);

-- Add title/subtitle to projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS subtitle text;

-- Relax old FK columns to nullable (ORM no longer enforces NOT NULL)
ALTER TABLE fragments ALTER COLUMN chapter_run_id DROP NOT NULL;
ALTER TABLE fragments ALTER COLUMN prompt_id DROP NOT NULL;

-- Add new FK columns to fragments (nullable for transition)
ALTER TABLE fragments ADD COLUMN IF NOT EXISTS chapter_generation_id uuid REFERENCES chapter_generations(id) ON DELETE CASCADE;
ALTER TABLE fragments ADD COLUMN IF NOT EXISTS project_prompt_id uuid REFERENCES project_prompts(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_fragments_chapter_generation ON fragments(chapter_generation_id);

-- Backfill project_prompts for existing projects
INSERT INTO project_prompts (project_id, chapter_id, position, type, title, content, style_rules, knowledge_areas, suggested_length)
SELECT
  p.id AS project_id,
  ch.id AS chapter_id,
  pr.position,
  pr.type,
  pr.title,
  pr.content,
  pr.style_rules,
  pr.knowledge_areas,
  pr.suggested_length
FROM projects p
JOIN chapters ch ON ch.book_template_id = p.book_template_id
JOIN prompts pr ON pr.chapter_id = ch.id;

-- Backfill project titles from latest completed run
UPDATE projects p SET
  title = r.title,
  subtitle = r.subtitle
FROM (
  SELECT DISTINCT ON (project_id) project_id, title, subtitle
  FROM runs
  WHERE status = 'completed' AND title IS NOT NULL
  ORDER BY project_id, completed_at DESC
) r
WHERE p.id = r.project_id;
