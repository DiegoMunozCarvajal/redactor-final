-- Enums
CREATE TYPE prompt_type AS ENUM (
  'apertura', 'modelo', 'contraste', 'amplificacion',
  'anecdota', 'acumulacion', 'proceso', 'cierre', 'ensamblaje'
);

CREATE TYPE run_status AS ENUM ('pending', 'running', 'completed', 'failed');

CREATE TYPE chapter_run_status AS ENUM (
  'pending', 'generating_fragments', 'assembling', 'completed', 'failed'
);

-- Book Templates
CREATE TABLE book_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Chapters
CREATE TABLE chapters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_template_id uuid NOT NULL REFERENCES book_templates(id) ON DELETE CASCADE,
  position integer NOT NULL,
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_chapters_template ON chapters(book_template_id, position);

-- Prompts
CREATE TABLE prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id uuid NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  position integer NOT NULL,
  type prompt_type NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  style_rules text,
  knowledge_areas text,
  suggested_length text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_prompts_chapter ON prompts(chapter_id, position);

-- Projects
CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  topic text NOT NULL,
  book_template_id uuid NOT NULL REFERENCES book_templates(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_projects_user ON projects(user_id);

-- Runs
CREATE TABLE runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status run_status NOT NULL DEFAULT 'pending',
  language text NOT NULL DEFAULT 'es',
  title text,
  subtitle text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX idx_runs_project ON runs(project_id);

-- Chapter Runs
CREATE TABLE chapter_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  chapter_id uuid NOT NULL REFERENCES chapters(id) ON DELETE RESTRICT,
  position integer NOT NULL,
  status chapter_run_status NOT NULL DEFAULT 'pending',
  assembled_content text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_chapter_runs_run ON chapter_runs(run_id);

-- Fragments
CREATE TABLE fragments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_run_id uuid NOT NULL REFERENCES chapter_runs(id) ON DELETE CASCADE,
  prompt_id uuid NOT NULL REFERENCES prompts(id) ON DELETE RESTRICT,
  position integer NOT NULL,
  content text,
  metadata jsonb,
  model_used text,
  tokens_used integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_fragments_chapter_run ON fragments(chapter_run_id);

-- Enable RLS
ALTER TABLE book_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE chapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE chapter_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE fragments ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- book_templates: readable by all authenticated, writable by admin
CREATE POLICY "book_templates_read" ON book_templates FOR SELECT TO authenticated USING (true);

-- chapters: readable by all authenticated
CREATE POLICY "chapters_read" ON chapters FOR SELECT TO authenticated USING (true);

-- prompts: readable by all authenticated
CREATE POLICY "prompts_read" ON prompts FOR SELECT TO authenticated USING (true);

-- projects: owner-only
CREATE POLICY "projects_select" ON projects FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "projects_insert" ON projects FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "projects_delete" ON projects FOR DELETE TO authenticated USING (user_id = auth.uid());

-- runs: accessible via project ownership
CREATE POLICY "runs_select" ON runs FOR SELECT TO authenticated USING (
  project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
);

-- chapter_runs: accessible via project ownership
CREATE POLICY "chapter_runs_select" ON chapter_runs FOR SELECT TO authenticated USING (
  run_id IN (SELECT r.id FROM runs r JOIN projects p ON r.project_id = p.id WHERE p.user_id = auth.uid())
);

-- fragments: accessible via project ownership
CREATE POLICY "fragments_select" ON fragments FOR SELECT TO authenticated USING (
  chapter_run_id IN (
    SELECT cr.id FROM chapter_runs cr
    JOIN runs r ON cr.run_id = r.id
    JOIN projects p ON r.project_id = p.id
    WHERE p.user_id = auth.uid()
  )
);
