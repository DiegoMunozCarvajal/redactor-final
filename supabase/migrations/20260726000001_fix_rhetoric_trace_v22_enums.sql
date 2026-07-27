-- Create Rhetoric Trace v2.2 with explicit enum values inline.
-- v2.1 fixed field names (camelCase) but LLMs invented values like ANECDOTE, NARRATIVE
-- because "(enum)" didn't list the allowed options. v2.2 enumerates every allowed value.

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
  4,
  '2.2',
  'Classify discourse architecture without retaining source substance.
Return only JSON matching OUTPUT_SCHEMA exactly.

Allowed recipeId values: opening_case, rhetorical_bridge, claim_presentation,
claim_contrast, quantitative_illustration, analogy_explanation, parallel_comparison,
definition, evidence_support, objection, response, application, transition,
synthesis_close.

Allowed resourceClass values: case, concept, claim.

Allowed discourseRelation values: open, sequence, elaborate, contrast, support, close.

Allowed readerEffect values: curiosity, clarity, tension, conviction, insight, closure.

Allowed dependency relation values: supports, contrasts, extends, exemplifies.
Allowed dependency slotType values: concept, claim, example, question, objection,
response, evidence, application.

Do not emit names, quotations, summaries, descriptions, notes, claims,
examples, metaphors, figures, entities, coined terms, or custom fields.
Do not invent new enum values. Use ONLY the values listed above.',
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
  WHERE pd.kind = 'rhetoric-trace' AND pr.version_label = '2.2'
);

-- Update the default to point to v2.2
INSERT INTO prompt_defaults (kind, prompt_revision_id, updated_at)
SELECT
  'rhetoric-trace',
  pr.id,
  now()
FROM prompt_revisions pr
JOIN prompt_definitions pd ON pd.id = pr.prompt_definition_id
WHERE pd.kind = 'rhetoric-trace' AND pr.version_label = '2.2'
ON CONFLICT (kind) DO UPDATE
SET prompt_revision_id = EXCLUDED.prompt_revision_id,
    updated_at = EXCLUDED.updated_at;
