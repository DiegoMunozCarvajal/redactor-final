-- Enforce mutual exclusivity of prompt role flags.
-- A prompt can be at most one of: assembly, critique, corrector.
ALTER TABLE prompts ADD CONSTRAINT chk_prompts_role_exclusive
  CHECK ((is_assembly::int + is_critique::int + is_corrector::int) <= 1);
