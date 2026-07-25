-- Seed v2 safe template pipeline prompt definitions and revisions.
-- Source-risk-profiler and Rhetoric Trace v2 replace the creative
-- Template Generator (v1) with closed classifiers. Template Generator
-- definitions/revisions remain queryable for history but never execute
-- in the v2 creation path.

-- Source profiler: classifies distinctive source elements without retaining source text.
INSERT INTO prompt_definitions (id, kind, name, description, created_at)
VALUES (
  gen_random_uuid(),
  'source-risk-profiler',
  'Source Risk Profiler v1',
  'Classifies distinctive source elements for private leak detection. Returns structured risk profile.',
  now()
)
ON CONFLICT DO NOTHING;

WITH profiler_def AS (
  SELECT id FROM prompt_definitions
  WHERE kind = 'source-risk-profiler'
  ORDER BY created_at ASC
  LIMIT 1
)
INSERT INTO prompt_revisions (
  id,
  prompt_definition_id,
  revision_number,
  version_label,
  system_template,
  user_template,
  required_markers,
  output_contract,
  configuration,
  created_at
)
SELECT
  gen_random_uuid(),
  profiler_def.id,
  1,
  '1.0',
  'Classify distinctive source elements for private leak detection.
Return only JSON matching OUTPUT_SCHEMA.
Do not summarize the chapter. Do not provide recommendations.
Each label and alias must be at most 120 characters.
confidence and distinctiveness must be numbers from 0 through 1.
Use kinds allowed by the schema. Prefer omission over generic labels.
Never copy a long source passage.',
  'SOURCE_CHAPTER:
{{CAPITULO_FUENTE}}

OUTPUT_SCHEMA:
{{OUTPUT_SCHEMA}}',
  '["{{CAPITULO_FUENTE}}", "{{OUTPUT_SCHEMA}}"]'::jsonb,
  'source-profile-v1',
  '{"pipelineContract": "source-profile-v1", "sensitiveMarkers": ["{{CAPITULO_FUENTE}}"]}'::jsonb,
  now()
FROM profiler_def
WHERE NOT EXISTS (
  SELECT 1 FROM prompt_revisions pr
  JOIN prompt_definitions pd ON pd.id = pr.prompt_definition_id
  WHERE pd.kind = 'source-risk-profiler' AND pr.revision_number = 1
);

-- Rhetoric Trace v2: closed structural trace without source substance.
INSERT INTO prompt_definitions (id, kind, name, description, created_at)
VALUES (
  gen_random_uuid(),
  'rhetoric-trace',
  'Rhetoric Trace v2',
  'Classifies discourse architecture without retaining source substance. Returns closed IR.',
  now()
)
ON CONFLICT DO NOTHING;

WITH trace_def AS (
  SELECT id FROM prompt_definitions
  WHERE kind = 'rhetoric-trace'
  ORDER BY created_at DESC
  LIMIT 1
)
INSERT INTO prompt_revisions (
  id,
  prompt_definition_id,
  revision_number,
  version_label,
  system_template,
  user_template,
  required_markers,
  output_contract,
  configuration,
  created_at
)
SELECT
  gen_random_uuid(),
  trace_def.id,
  1,
  '2.0',
  'Classify discourse architecture without retaining source substance.
Return only JSON matching OUTPUT_SCHEMA.
Use only listed enum values and integer positions.
Do not emit names, quotations, summaries, descriptions, notes, claims,
examples, metaphors, figures, entities, coined terms, or custom fields.
Preserve broad move categories, order, abstract dependencies, resource class,
discourse relation, and reader effect only.',
  'SOURCE_CHAPTER:
{{CAPITULO_FUENTE}}

OUTPUT_SCHEMA:
{{OUTPUT_SCHEMA}}',
  '["{{CAPITULO_FUENTE}}", "{{OUTPUT_SCHEMA}}"]'::jsonb,
  'trace-ir-v2',
  '{"pipelineContract": "trace-ir-v2", "sensitiveMarkers": ["{{CAPITULO_FUENTE}}"]}'::jsonb,
  now()
FROM trace_def
WHERE NOT EXISTS (
  SELECT 1 FROM prompt_revisions pr
  JOIN prompt_definitions pd ON pd.id = pr.prompt_definition_id
  WHERE pd.kind = 'rhetoric-trace' AND pr.version_label = '2.0'
);

-- Set Rhetoric Trace v2 as the default for rhetoric-trace kind.
-- The template-generator default is intentionally NOT set — v2 path
-- compiles traces deterministically instead of calling a creative LLM.
INSERT INTO prompt_defaults (kind, prompt_revision_id, updated_at)
SELECT
  'rhetoric-trace',
  pr.id,
  now()
FROM prompt_revisions pr
JOIN prompt_definitions pd ON pd.id = pr.prompt_definition_id
WHERE pd.kind = 'rhetoric-trace' AND pr.version_label = '2.0'
ON CONFLICT (kind) DO UPDATE
SET prompt_revision_id = EXCLUDED.prompt_revision_id,
    updated_at = EXCLUDED.updated_at;
