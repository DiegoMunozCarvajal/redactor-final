-- Contract legacy prompt storage.
-- 1. Snapshot every legacy row as immutable frozen revisions.
-- 2. Verify parity gates pass.
-- 3. Drop legacy columns and tables in FK order.
BEGIN;

-- Block concurrent writes to legacy tables so no row is inserted, updated,
-- or deleted after snapshots and before the final DROP.
LOCK TABLE generation_system_prompts IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE meta_prompts IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE prompt_library IN SHARE ROW EXCLUSIVE MODE;
-- Also block writes to the legacy FK columns on projects.
LOCK TABLE projects IN SHARE ROW EXCLUSIVE MODE;

-- ---------------------------------------------------------------------------
-- Reject unsupported categories
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM prompt_library
    WHERE category NOT IN ('assembly', 'critique', 'corrector')
  ) THEN
    RAISE EXCEPTION 'unsupported prompt_library category';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Catch-up definitions (idempotent — any created after original backfill)
-- ---------------------------------------------------------------------------
INSERT INTO prompt_definitions (id, kind, name, description)
SELECT md5('definition:generation_system_prompts:' || id::text)::uuid,
       'generation-system', name, description
FROM generation_system_prompts
ON CONFLICT (id) DO NOTHING;

INSERT INTO prompt_definitions (id, kind, name, description)
SELECT md5('definition:meta_prompts:' || id::text)::uuid,
       'meta-template', name, description
FROM meta_prompts
ON CONFLICT (id) DO NOTHING;

INSERT INTO prompt_definitions (id, kind, name, description)
SELECT md5('definition:prompt_library:' || id::text)::uuid,
       category, name, description
FROM prompt_library
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Frozen revisions: generation_system_prompts
-- ---------------------------------------------------------------------------
WITH frozen AS (
  SELECT
    gsp.*,
    md5(concat_ws(E'\x1f', gsp.id::text, gsp.name,
      coalesce(gsp.description, ''), gsp.content, gsp.is_default::text)) AS source_hash
  FROM generation_system_prompts gsp
)
INSERT INTO prompt_revisions (
  id, prompt_definition_id, revision_number, version_label,
  system_template, user_template, required_markers, output_contract, configuration
)
SELECT
  md5('legacy-cutover:generation_system_prompts:' || id::text || ':' || source_hash)::uuid,
  md5('definition:generation_system_prompts:' || id::text)::uuid,
  (SELECT coalesce(max(pr.revision_number), 0) + 1
   FROM prompt_revisions pr
   WHERE pr.prompt_definition_id = md5('definition:generation_system_prompts:' || frozen.id::text)::uuid),
  'legacy-cutover-' || source_hash,
  content,
  '',
  '[]'::jsonb,
  NULL,
  jsonb_build_object(
    'legacySource', 'generation_system_prompts',
    'legacyNonExecutable', true,
    'legacyCutover', true,
    'legacySourceHash', source_hash,
    'legacyName', name,
    'legacyDescription', description
  )
FROM frozen
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Frozen revisions: meta_prompts
-- ---------------------------------------------------------------------------
WITH frozen AS (
  SELECT
    mp.*,
    md5(concat_ws(E'\x1f', mp.id::text, mp.name,
      coalesce(mp.description, ''), mp.content,
      coalesce(mp.user_prompt, ''))) AS source_hash
  FROM meta_prompts mp
)
INSERT INTO prompt_revisions (
  id, prompt_definition_id, revision_number, version_label,
  system_template, user_template, required_markers, output_contract, configuration
)
SELECT
  md5('legacy-cutover:meta_prompts:' || id::text || ':' || source_hash)::uuid,
  md5('definition:meta_prompts:' || id::text)::uuid,
  (SELECT coalesce(max(pr.revision_number), 0) + 1
   FROM prompt_revisions pr
   WHERE pr.prompt_definition_id = md5('definition:meta_prompts:' || frozen.id::text)::uuid),
  'legacy-cutover-' || source_hash,
  content,
  coalesce(user_prompt, ''),
  '[]'::jsonb,
  NULL,
  jsonb_build_object(
    'legacySource', 'meta_prompts',
    'legacyNonExecutable', true,
    'legacyCutover', true,
    'legacySourceHash', source_hash,
    'legacyName', name,
    'legacyDescription', description
  )
FROM frozen
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Frozen revisions: prompt_library
-- ---------------------------------------------------------------------------
WITH frozen AS (
  SELECT
    pl.*,
    md5(concat_ws(E'\x1f', pl.id::text, pl.category, pl.name,
      coalesce(pl.description, ''), pl.content,
      coalesce(pl.user_prompt, ''))) AS source_hash
  FROM prompt_library pl
)
INSERT INTO prompt_revisions (
  id, prompt_definition_id, revision_number, version_label,
  system_template, user_template, required_markers, output_contract, configuration
)
SELECT
  md5('legacy-cutover:prompt_library:' || id::text || ':' || source_hash)::uuid,
  md5('definition:prompt_library:' || id::text)::uuid,
  (SELECT coalesce(max(pr.revision_number), 0) + 1
   FROM prompt_revisions pr
   WHERE pr.prompt_definition_id = md5('definition:prompt_library:' || frozen.id::text)::uuid),
  'legacy-cutover-' || source_hash,
  content,
  coalesce(user_prompt, ''),
  '[]'::jsonb,
  NULL,
  jsonb_build_object(
    'legacySource', 'prompt_library',
    'legacyNonExecutable', true,
    'legacyCutover', true,
    'legacySourceHash', source_hash,
    'legacyName', name,
    'legacyDescription', description,
    'legacyCategory', category
  )
FROM frozen
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Parity gate 1: generation-system project bindings
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM projects p
    LEFT JOIN project_prompt_bindings ppb
      ON ppb.project_id = p.id AND ppb.kind = 'generation-system'
    LEFT JOIN prompt_revisions pr ON pr.id = ppb.prompt_revision_id
    LEFT JOIN prompt_definitions pd ON pd.id = pr.prompt_definition_id
    WHERE p.generation_system_prompt_id IS NOT NULL
      AND (
        ppb.project_id IS NULL
        OR pd.id IS DISTINCT FROM md5(
          'definition:generation_system_prompts:' || p.generation_system_prompt_id::text
        )::uuid
        OR pd.archived_at IS NOT NULL
        OR coalesce(pr.configuration->>'legacyNonExecutable', 'false') = 'true'
      )
  ) THEN
    RAISE EXCEPTION 'generation-system binding parity failed';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Parity gate 2: assembly defaults exist and are executable
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF (
    SELECT count(DISTINCT defaults.kind)
    FROM prompt_defaults defaults
    JOIN prompt_revisions revisions ON revisions.id = defaults.prompt_revision_id
    JOIN prompt_definitions definitions ON definitions.id = revisions.prompt_definition_id
    WHERE defaults.kind IN ('assembly-planner', 'assembly')
      AND definitions.kind = defaults.kind
      AND definitions.archived_at IS NULL
      AND coalesce(revisions.configuration->>'legacyNonExecutable', 'false') <> 'true'
  ) <> 2 THEN
    RAISE EXCEPTION 'assembly defaults parity failed';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Parity gate 3: all legacy rows preserved as frozen revisions
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    WITH expected AS (
      SELECT
        md5('definition:generation_system_prompts:' || gsp.id::text)::uuid AS definition_id,
        'generation-system'::text AS expected_kind,
        md5(concat_ws(E'\x1f', gsp.id::text, gsp.name,
          coalesce(gsp.description, ''), gsp.content, gsp.is_default::text)) AS source_hash
      FROM generation_system_prompts gsp
      UNION ALL
      SELECT
        md5('definition:meta_prompts:' || mp.id::text)::uuid,
        'meta-template'::text,
        md5(concat_ws(E'\x1f', mp.id::text, mp.name,
          coalesce(mp.description, ''), mp.content, coalesce(mp.user_prompt, '')))
      FROM meta_prompts mp
      UNION ALL
      SELECT
        md5('definition:prompt_library:' || pl.id::text)::uuid,
        pl.category,
        md5(concat_ws(E'\x1f', pl.id::text, pl.category, pl.name,
          coalesce(pl.description, ''), pl.content, coalesce(pl.user_prompt, '')))
      FROM prompt_library pl
    )
    SELECT 1
    FROM expected e
    LEFT JOIN prompt_definitions pd ON pd.id = e.definition_id
    WHERE pd.id IS NULL
       OR pd.kind IS DISTINCT FROM e.expected_kind
       OR NOT EXISTS (
         SELECT 1
         FROM prompt_revisions pr
         WHERE pr.prompt_definition_id = e.definition_id
           AND pr.configuration->>'legacySourceHash' = e.source_hash
           AND pr.configuration->>'legacyNonExecutable' = 'true'
       )
  ) THEN
    RAISE EXCEPTION 'legacy prompt snapshot parity failed';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Drop legacy columns and tables (FK order: columns before tables)
-- ---------------------------------------------------------------------------
ALTER TABLE projects
  DROP COLUMN IF EXISTS assembly_prompt_id,
  DROP COLUMN IF EXISTS generation_system_prompt_id;

DROP TABLE IF EXISTS prompt_library;
DROP TABLE IF EXISTS meta_prompts;
DROP TABLE IF EXISTS generation_system_prompts;

COMMIT;
