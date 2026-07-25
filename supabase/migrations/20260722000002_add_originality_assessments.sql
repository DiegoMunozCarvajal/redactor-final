ALTER TYPE generation_status ADD VALUE IF NOT EXISTS 'quarantined';

CREATE TABLE originality_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL,
  pipeline_run_id uuid REFERENCES template_pipeline_runs(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_id uuid REFERENCES chapters(id) ON DELETE CASCADE,
  chapter_generation_id uuid REFERENCES chapter_generations(id) ON DELETE CASCADE,
  execution_id uuid REFERENCES llm_prompt_executions(id) ON DELETE RESTRICT,
  stage text NOT NULL,
  candidate_hash text NOT NULL,
  source_profile_set_hash text NOT NULL,
  originality_policy_version text NOT NULL,
  decision text NOT NULL,
  signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  accepted_entity_type text,
  accepted_entity_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_originality_scope
    CHECK (scope IN ('template', 'source-free')),
  CONSTRAINT chk_originality_decision
    CHECK (decision IN ('clean', 'suspect', 'contaminated')),
  CONSTRAINT chk_originality_scope_run CHECK (
    (scope = 'template' AND pipeline_run_id IS NOT NULL)
    OR (scope = 'source-free' AND pipeline_run_id IS NULL)
  ),
  CONSTRAINT chk_originality_accepted_pair CHECK (
    (accepted_entity_type IS NULL) = (accepted_entity_id IS NULL)
  )
);

CREATE INDEX idx_originality_assessments_project
  ON originality_assessments(project_id, created_at DESC);
CREATE INDEX idx_originality_assessments_generation
  ON originality_assessments(chapter_generation_id, created_at);
CREATE INDEX idx_originality_assessments_candidate
  ON originality_assessments(candidate_hash, originality_policy_version);

ALTER TABLE originality_assessments ENABLE ROW LEVEL SECURITY;

ALTER TABLE chapter_placeholders
  ADD COLUMN definition_origin text NOT NULL DEFAULT 'legacy',
  ADD CONSTRAINT chk_placeholder_definition_origin
    CHECK (definition_origin IN ('legacy', 'manual', 'ai'));
