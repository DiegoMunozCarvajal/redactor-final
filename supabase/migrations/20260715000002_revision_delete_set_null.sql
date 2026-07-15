-- Allow deleting prompt revisions while preserving execution history.
-- Changes llm_prompt_executions.prompt_revision_id FK from ON DELETE RESTRICT
-- to ON DELETE SET NULL so revisions can be removed without losing the audit log.
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'llm_prompt_executions'
    AND con.contype = 'f'
    AND con.confrelid = 'prompt_revisions'::regclass;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE llm_prompt_executions DROP CONSTRAINT %I', constraint_name);
    EXECUTE format('ALTER TABLE llm_prompt_executions ADD CONSTRAINT %I FOREIGN KEY (prompt_revision_id) REFERENCES prompt_revisions(id) ON DELETE SET NULL', constraint_name);
  END IF;
END $$;
