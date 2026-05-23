DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'fragments'
    AND con.contype = 'f'
    AND con.confrelid = 'project_prompts'::regclass;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE fragments DROP CONSTRAINT %I', constraint_name);
    EXECUTE format('ALTER TABLE fragments ADD CONSTRAINT %I FOREIGN KEY (project_prompt_id) REFERENCES project_prompts(id) ON DELETE CASCADE', constraint_name);
  END IF;
END $$;
