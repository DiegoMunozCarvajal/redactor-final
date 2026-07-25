CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE template_pipeline_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_template_id uuid NOT NULL REFERENCES book_templates(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'running',
  pipeline_version text NOT NULL,
  compiler_version text,
  compiler_hash text,
  recipe_catalog_hash text,
  rhetoric_trace_revision_id uuid REFERENCES prompt_revisions(id) ON DELETE RESTRICT,
  source_profile_version text,
  originality_policy_version text NOT NULL,
  failure_stage text,
  report jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT chk_template_pipeline_run_status
    CHECK (status IN ('running', 'clean', 'quarantined', 'failed')),
  CONSTRAINT chk_template_pipeline_failure_stage CHECK (
    failure_stage IS NULL OR failure_stage IN (
      'source_profile', 'trace_classification', 'trace_validation',
      'template_compilation', 'template_validation', 'finalization'
    )
  )
);

CREATE TABLE template_source_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_run_id uuid NOT NULL REFERENCES template_pipeline_runs(id) ON DELETE RESTRICT,
  chapter_id uuid NOT NULL REFERENCES chapters(id) ON DELETE RESTRICT,
  source_hash text NOT NULL,
  source_language text NOT NULL,
  profile_version text NOT NULL,
  distinctive_elements jsonb NOT NULL DEFAULT '[]'::jsonb,
  profile_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pipeline_run_id, chapter_id)
);

CREATE TABLE template_source_profile_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_profile_id uuid NOT NULL REFERENCES template_source_profiles(id) ON DELETE RESTRICT,
  chunk_index integer NOT NULL,
  content_hash text NOT NULL,
  lexical_fingerprint jsonb NOT NULL,
  embedding vector(1536) NOT NULL,
  token_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_profile_id, chunk_index)
);

CREATE TABLE template_run_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_run_id uuid NOT NULL REFERENCES template_pipeline_runs(id) ON DELETE RESTRICT,
  chapter_id uuid NOT NULL REFERENCES chapters(id) ON DELETE RESTRICT,
  trace_ir jsonb NOT NULL,
  compiled_template jsonb NOT NULL,
  artifact_hash text NOT NULL,
  validation_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pipeline_run_id, chapter_id)
);

ALTER TABLE book_templates
  ADD COLUMN active_pipeline_run_id uuid
  REFERENCES template_pipeline_runs(id) ON DELETE RESTRICT;
ALTER TABLE book_templates
  ADD CONSTRAINT chk_template_operational_status
  CHECK (status IN ('generating', 'ready', 'quarantined', 'failed'));

ALTER TABLE prompts
  ADD COLUMN template_pipeline_run_id uuid
    REFERENCES template_pipeline_runs(id) ON DELETE RESTRICT,
  ADD COLUMN template_artifact_hash text;

ALTER TABLE chapter_placeholders
  ADD COLUMN template_pipeline_run_id uuid
    REFERENCES template_pipeline_runs(id) ON DELETE RESTRICT,
  ADD COLUMN template_artifact_hash text,
  ADD COLUMN dependency_names text[] NOT NULL DEFAULT ARRAY[]::text[];

CREATE INDEX idx_template_pipeline_runs_template
  ON template_pipeline_runs(book_template_id, created_at DESC);
CREATE INDEX idx_template_profiles_run
  ON template_source_profiles(pipeline_run_id);
CREATE INDEX idx_template_profile_chunks_profile
  ON template_source_profile_chunks(source_profile_id, chunk_index);

ALTER TABLE template_pipeline_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_source_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_source_profile_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_run_artifacts ENABLE ROW LEVEL SECURITY;
