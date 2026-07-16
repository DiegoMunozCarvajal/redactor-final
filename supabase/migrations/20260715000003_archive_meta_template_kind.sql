-- Archive the meta-template prompt definition.
-- The single-pass meta-template kind has been replaced by two new kinds:
--   rhetoric-trace (pass 1) and template-generator (pass 2).
-- Historical llm_prompt_executions rows retain their prompt_revision_id FKs.
-- resolvePromptRevision rejects archived definitions at runtime.

UPDATE prompt_definitions
SET archived_at = NOW()
WHERE kind = 'meta-template' AND archived_at IS NULL;
