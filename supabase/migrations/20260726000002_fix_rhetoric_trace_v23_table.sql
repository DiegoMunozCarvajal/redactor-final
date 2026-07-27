-- Create Rhetoric Trace v2.3 with table-format field/value mapping.
-- v2.2 listed all values but LLMs confused overlapping enum sets
-- (e.g. "case" used for slotType, "exemplifies" for discourseRelation).
-- v2.3 presents fields in a visual table and always repeats the exact
-- allowed values wherever a field is mentioned.

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
  5,
  '2.3',
  'Classify discourse architecture without retaining source substance.
Return only JSON matching OUTPUT_SCHEMA exactly.

Each move in the "moves" array MUST use these EXACT values:

  position: integer starting at 0
  recipeId: opening_case | rhetorical_bridge | claim_presentation | claim_contrast | quantitative_illustration | analogy_explanation | parallel_comparison | definition | evidence_support | objection | response | application | transition | synthesis_close
  resourceClass: case | concept | claim
  discourseRelation: open | sequence | elaborate | contrast | support | close
  readerEffect: curiosity | clarity | tension | conviction | insight | closure
  dependencies: array of { fromPosition, relation, slotType } objects

Each dependency object MUST use these EXACT values:

  fromPosition: integer (must be less than current position)
  relation: supports | contrasts | extends | exemplifies
  slotType: concept | claim | example | question | objection | response | evidence | application

CRITICAL: "case" is ONLY a resourceClass value. It is NOT a slotType.
CRITICAL: "exemplifies" is ONLY a dependency relation. It is NOT a discourseRelation.
CRITICAL: "open", "sequence", "elaborate", "contrast", "support", "close" are ONLY discourseRelation values. They are NOT dependency relations.

Do not emit names, quotations, summaries, descriptions, notes, claims,
examples, metaphors, figures, entities, coined terms, or custom fields.
Do not invent new values. Use ONLY the values listed under each field above.
If there was a previous validation error, fix it.',
  'SOURCE_CHAPTER:
{{CAPITULO_FUENTE}}

OUTPUT_SCHEMA:
{{OUTPUT_SCHEMA}}

{{#PREVIOUS_ERROR}}
Previous validation error (fix these issues):
{{PREVIOUS_ERROR}}
{{/PREVIOUS_ERROR}}',
  '["{{CAPITULO_FUENTE}}", "{{OUTPUT_SCHEMA}}"]'::jsonb,
  'trace-ir-v2',
  '{"pipelineContract": "trace-ir-v2", "sensitiveMarkers": ["{{CAPITULO_FUENTE}}"]}'::jsonb,
  now()
FROM trace_def
WHERE NOT EXISTS (
  SELECT 1 FROM prompt_revisions pr
  JOIN prompt_definitions pd ON pd.id = pr.prompt_definition_id
  WHERE pd.kind = 'rhetoric-trace' AND pr.version_label = '2.3'
);

-- Update the default to v2.3
INSERT INTO prompt_defaults (kind, prompt_revision_id, updated_at)
SELECT
  'rhetoric-trace',
  pr.id,
  now()
FROM prompt_revisions pr
JOIN prompt_definitions pd ON pd.id = pr.prompt_definition_id
WHERE pd.kind = 'rhetoric-trace' AND pr.version_label = '2.3'
ON CONFLICT (kind) DO UPDATE
SET prompt_revision_id = EXCLUDED.prompt_revision_id,
    updated_at = EXCLUDED.updated_at;
