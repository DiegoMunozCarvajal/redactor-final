-- Backfill currentRevisionId for prompts that have none.
-- P0 fix: copied prompts must have an immutable revision before generation starts.
-- Self-healing in generate-chapter.ts handles any stragglers, but this migration
-- catches the bulk in one pass.
BEGIN;

WITH new_versions AS (
  INSERT INTO prompt_versions (prompt_id, revision_number, title, content, user_prompt, snapshot)
  SELECT
    p.id,
    COALESCE(
      (SELECT MAX(pv.revision_number) FROM prompt_versions pv WHERE pv.prompt_id = p.id),
      0
    ) + 1,
    p.title,
    p.content,
    p.user_prompt,
    jsonb_build_object(
      'title', p.title,
      'content', p.content,
      'userPrompt', p.user_prompt,
      'position', p.position,
      'isAssembly', COALESCE(p.is_assembly, false),
      'isCritique', COALESCE(p.is_critique, false),
      'isCorrector', COALESCE(p.is_corrector, false),
      'function', p.function,
      'notes', p.notes,
      'sourceContext', p.source_context,
      'legacyIncomplete', false
    )
  FROM prompts p
  WHERE p.current_revision_id IS NULL
  RETURNING id, prompt_id
)
UPDATE prompts p
SET current_revision_id = nv.id
FROM new_versions nv
WHERE p.id = nv.prompt_id;

COMMIT;
