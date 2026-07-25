CREATE TABLE pipeline_maintenance_operations (
  id uuid PRIMARY KEY,
  kind text NOT NULL,
  input_hash text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  result_template_id uuid REFERENCES book_templates(id) ON DELETE RESTRICT,
  result_project_id uuid REFERENCES projects(id) ON DELETE RESTRICT,
  report jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT chk_pipeline_maintenance_kind
    CHECK (kind IN ('template_regeneration', 'project_clone')),
  CONSTRAINT chk_pipeline_maintenance_status
    CHECK (status IN ('running', 'completed', 'failed')),
  CONSTRAINT chk_pipeline_maintenance_result CHECK (
    (kind = 'template_regeneration' AND result_project_id IS NULL)
    OR (kind = 'project_clone' AND result_template_id IS NULL)
  )
);

ALTER TABLE projects
  ADD COLUMN supersedes_project_id uuid
  REFERENCES projects(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX uq_projects_supersedes_project
  ON projects(supersedes_project_id)
  WHERE supersedes_project_id IS NOT NULL;

ALTER TABLE pipeline_maintenance_operations ENABLE ROW LEVEL SECURITY;
