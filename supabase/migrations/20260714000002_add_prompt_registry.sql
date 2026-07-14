BEGIN;

CREATE TABLE prompt_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN (
    'generation-system','meta-template','assembly-planner','assembly',
    'critique','corrector','title','placeholder-fill','editorial-brief-extractor'
  )),
  name text NOT NULL,
  description text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE prompt_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_definition_id uuid NOT NULL REFERENCES prompt_definitions(id) ON DELETE RESTRICT,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  version_label text NOT NULL CHECK (length(btrim(version_label)) > 0),
  system_template text NOT NULL,
  user_template text NOT NULL,
  required_markers jsonb NOT NULL DEFAULT '[]'::jsonb,
  output_contract text,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (prompt_definition_id, revision_number),
  UNIQUE (prompt_definition_id, version_label)
);

CREATE TABLE prompt_defaults (
  kind text PRIMARY KEY CHECK (kind IN (
    'generation-system','meta-template','assembly-planner','assembly',
    'critique','corrector','title','placeholder-fill','editorial-brief-extractor'
  )),
  prompt_revision_id uuid NOT NULL REFERENCES prompt_revisions(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE project_prompt_bindings (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN (
    'generation-system','meta-template','assembly-planner','assembly',
    'critique','corrector','title','placeholder-fill','editorial-brief-extractor'
  )),
  prompt_revision_id uuid NOT NULL REFERENCES prompt_revisions(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, kind)
);

CREATE TABLE llm_prompt_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  book_template_id uuid REFERENCES book_templates(id) ON DELETE CASCADE,
  chapter_id uuid REFERENCES chapters(id) ON DELETE CASCADE,
  chapter_generation_id uuid REFERENCES chapter_generations(id) ON DELETE CASCADE,
  stage text NOT NULL,
  prompt_revision_id uuid REFERENCES prompt_revisions(id) ON DELETE RESTRICT,
  chapter_prompt_revision_id uuid REFERENCES prompt_versions(id) ON DELETE RESTRICT,
  model text NOT NULL,
  provider text NOT NULL,
  messages jsonb NOT NULL,
  data_manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_contract text,
  technical_policies jsonb NOT NULL DEFAULT '[]'::jsonb,
  provider_payload_manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'started' CHECK (status IN ('started','completed','failed')),
  usage jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX idx_prompt_definitions_kind ON prompt_definitions(kind) WHERE archived_at IS NULL;
CREATE INDEX idx_prompt_revisions_definition ON prompt_revisions(prompt_definition_id, revision_number DESC);
CREATE INDEX idx_llm_prompt_executions_generation ON llm_prompt_executions(chapter_generation_id, created_at);
CREATE INDEX idx_llm_prompt_executions_template ON llm_prompt_executions(book_template_id, created_at);

CREATE FUNCTION reject_prompt_revision_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'prompt revisions are immutable';
END;
$$;
CREATE TRIGGER prompt_revisions_immutable
BEFORE UPDATE OR DELETE ON prompt_revisions
FOR EACH ROW EXECUTE FUNCTION reject_prompt_revision_mutation();

CREATE FUNCTION enforce_prompt_binding_kind() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE revision_kind text;
BEGIN
  SELECT pd.kind INTO revision_kind
  FROM prompt_revisions pr
  JOIN prompt_definitions pd ON pd.id = pr.prompt_definition_id
  WHERE pr.id = NEW.prompt_revision_id;
  IF revision_kind IS NULL OR revision_kind <> NEW.kind THEN
    RAISE EXCEPTION 'prompt revision kind % does not match binding kind %', revision_kind, NEW.kind;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER prompt_defaults_kind_guard
BEFORE INSERT OR UPDATE ON prompt_defaults
FOR EACH ROW EXECUTE FUNCTION enforce_prompt_binding_kind();
CREATE TRIGGER project_prompt_bindings_kind_guard
BEFORE INSERT OR UPDATE ON project_prompt_bindings
FOR EACH ROW EXECUTE FUNCTION enforce_prompt_binding_kind();

-- Namespaced deterministic IDs prevent collisions between legacy tables and
-- make migration retries harmless.
INSERT INTO prompt_definitions (id, kind, name, description)
SELECT md5('definition:generation_system_prompts:' || id::text)::uuid,
       'generation-system', name, description FROM generation_system_prompts
ON CONFLICT (id) DO NOTHING;
INSERT INTO prompt_revisions (
  id, prompt_definition_id, revision_number, version_label,
  system_template, user_template, required_markers, output_contract, configuration
)
SELECT md5('revision:generation_system_prompts:' || id::text)::uuid,
       md5('definition:generation_system_prompts:' || id::text)::uuid,
       1, 'imported-1', content, '', '[]'::jsonb, NULL,
       jsonb_build_object(
         'legacySource', 'generation_system_prompts',
         'legacyNonExecutable', true
       )
FROM generation_system_prompts
ON CONFLICT (id) DO NOTHING;

INSERT INTO prompt_definitions (id, kind, name, description)
SELECT md5('definition:meta_prompts:' || id::text)::uuid,
       'meta-template', name, description FROM meta_prompts
ON CONFLICT (id) DO NOTHING;
INSERT INTO prompt_revisions (
  id, prompt_definition_id, revision_number, version_label,
  system_template, user_template, required_markers, output_contract, configuration
)
SELECT md5('revision:meta_prompts:' || id::text)::uuid,
       md5('definition:meta_prompts:' || id::text)::uuid,
       1, 'imported-1', content, coalesce(user_prompt, ''),
       '["{{CAPITULO_FUENTE}}"]'::jsonb, 'meta-prompt-output',
       jsonb_build_object('legacySource', 'meta_prompts', 'legacyNonExecutable', true)
FROM meta_prompts
ON CONFLICT (id) DO NOTHING;

INSERT INTO prompt_definitions (id, kind, name, description)
SELECT md5('definition:prompt_library:' || id::text)::uuid,
       category, name, description FROM prompt_library
ON CONFLICT (id) DO NOTHING;
INSERT INTO prompt_revisions (
  id, prompt_definition_id, revision_number, version_label,
  system_template, user_template, required_markers, output_contract, configuration
)
SELECT md5('revision:prompt_library:' || id::text)::uuid,
       md5('definition:prompt_library:' || id::text)::uuid,
       1, 'imported-1', content, coalesce(user_prompt, ''), '[]'::jsonb, NULL,
       jsonb_build_object('legacySource', 'prompt_library', 'legacyNonExecutable', true)
FROM prompt_library
ON CONFLICT (id) DO NOTHING;

INSERT INTO prompt_defaults (kind, prompt_revision_id)
SELECT 'generation-system', md5('revision:generation_system_prompts:' || id::text)::uuid
FROM generation_system_prompts WHERE is_default = true
ON CONFLICT (kind) DO NOTHING;

-- Preserve explicit per-project generation-system choices. Assembly bindings
-- intentionally do not migrate: plan 2 replaces legacy assembly behavior with
-- planner + Assembly v1.3.
INSERT INTO project_prompt_bindings (project_id, kind, prompt_revision_id)
SELECT p.id, 'generation-system',
       md5('revision:generation_system_prompts:' || p.generation_system_prompt_id::text)::uuid
FROM projects p
WHERE p.generation_system_prompt_id IS NOT NULL
ON CONFLICT (project_id, kind) DO NOTHING;

ALTER TABLE prompt_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_prompt_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_prompt_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY prompt_definitions_read ON prompt_definitions FOR SELECT TO authenticated USING (true);
CREATE POLICY prompt_revisions_read ON prompt_revisions FOR SELECT TO authenticated USING (true);
CREATE POLICY prompt_defaults_read ON prompt_defaults FOR SELECT TO authenticated USING (true);
CREATE POLICY prompt_definitions_admin ON prompt_definitions FOR ALL TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
CREATE POLICY prompt_revisions_admin ON prompt_revisions FOR INSERT TO authenticated
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
CREATE POLICY prompt_defaults_admin ON prompt_defaults FOR ALL TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
CREATE POLICY project_prompt_bindings_owner ON project_prompt_bindings FOR ALL TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = (select auth.uid())))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = (select auth.uid())));
CREATE POLICY llm_prompt_executions_owner_read ON llm_prompt_executions FOR SELECT TO authenticated
  USING (
    project_id IN (SELECT id FROM projects WHERE user_id = (select auth.uid()))
    OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

COMMIT;
