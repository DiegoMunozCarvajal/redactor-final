-- Create Rhetoric Trace v2.1 revision with corrected system prompt.
-- v2.0 used "order, resource class, discourse relation, reader effect" phrasing
-- which biased LLMs toward snake_case output keys. v2.1 uses explicit camelCase
-- field names matching OUTPUT_SCHEMA exactly.

-- First, find the prompt_definition_id for rhetoric-trace
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
  3,
  '2.1',
  'Classify discourse architecture without retaining source substance.
Return only JSON matching OUTPUT_SCHEMA exactly — same field names, same types.
Use "position" (integer starting at 0), "recipeId" (enum), "resourceClass" (enum),
"discourseRelation" (enum), "readerEffect" (enum), and "dependencies" (array of
{fromPosition, relation, slotType} objects).
Do not emit names, quotations, summaries, descriptions, notes, claims,
examples, metaphors, figures, entities, coined terms, or custom fields.
Do not use snake_case keys. Use camelCase exactly as shown in OUTPUT_SCHEMA.',
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
  WHERE pd.kind = 'rhetoric-trace' AND pr.version_label = '2.1'
);

-- Update the default to point to v2.1
INSERT INTO prompt_defaults (kind, prompt_revision_id, updated_at)
SELECT
  'rhetoric-trace',
  pr.id,
  now()
FROM prompt_revisions pr
JOIN prompt_definitions pd ON pd.id = pr.prompt_definition_id
WHERE pd.kind = 'rhetoric-trace' AND pr.version_label = '2.1'
ON CONFLICT (kind) DO UPDATE
SET prompt_revision_id = EXCLUDED.prompt_revision_id,
    updated_at = EXCLUDED.updated_at;
