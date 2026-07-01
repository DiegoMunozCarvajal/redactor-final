-- ============================================================
-- Prompt consolidation: 5 tables → 2 tables
--   assembly_prompts + critique_prompts + corrector_prompts → prompt_library
--   prompts + project_prompts → prompts (with nullable project_id)
-- ============================================================

-- ============================================================
-- PHASE 1: Create prompt_library + migrate library data
-- ============================================================

CREATE TABLE IF NOT EXISTS prompt_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  name text NOT NULL,
  description text,
  content text NOT NULL,
  user_prompt text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prompt_library_category ON prompt_library (category);

-- Migrate assembly_prompts (created WITHOUT user_prompt initially; added later)
INSERT INTO prompt_library (id, category, name, description, content, user_prompt, created_at, updated_at)
SELECT id, 'assembly', name, description, content, user_prompt, created_at, updated_at
FROM assembly_prompts;

-- Migrate critique_prompts
INSERT INTO prompt_library (id, category, name, description, content, user_prompt, created_at, updated_at)
SELECT id, 'critique', name, description, content, user_prompt, created_at, updated_at
FROM critique_prompts;

-- Migrate corrector_prompts
INSERT INTO prompt_library (id, category, name, description, content, user_prompt, created_at, updated_at)
SELECT id, 'corrector', name, description, content, user_prompt, created_at, updated_at
FROM corrector_prompts;

-- ============================================================
-- PHASE 2: Fix projects FK → prompt_library
-- ============================================================

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'projects'
    AND con.contype = 'f'
    AND con.confrelid = 'assembly_prompts'::regclass;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE projects DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE projects ADD CONSTRAINT projects_assembly_prompt_id_prompt_library_id_fk
  FOREIGN KEY (assembly_prompt_id) REFERENCES prompt_library (id) ON DELETE SET NULL;

-- ============================================================
-- PHASE 3: Drop old library tables
-- ============================================================

DROP TABLE IF EXISTS corrector_prompts;
DROP TABLE IF EXISTS critique_prompts;
DROP TABLE IF EXISTS assembly_prompts;

-- ============================================================
-- PHASE 4: Add project_id to prompts
-- ============================================================

ALTER TABLE prompts ADD COLUMN IF NOT EXISTS project_id uuid;
ALTER TABLE prompts ADD CONSTRAINT prompts_project_id_projects_id_fk
  FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE;

-- ============================================================
-- PHASE 5: Drop old FKs pointing to project_prompts
-- ============================================================

-- Drop FK on fragments.project_prompt_id → project_prompts.id
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
  END IF;
END $$;

-- Drop any FK on prompt_versions.prompt_id → project_prompts.id (if exists)
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'prompt_versions'
    AND con.contype = 'f'
    AND con.confrelid = 'project_prompts'::regclass;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE prompt_versions DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

-- Drop any FK on prompt_versions.prompt_id → prompts.id (old one, if exists)
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'prompt_versions'
    AND con.contype = 'f'
    AND con.confrelid = 'prompts'::regclass;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE prompt_versions DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

-- ============================================================
-- PHASE 6: Migrate project_prompts data into prompts
-- ============================================================

INSERT INTO prompts (id, project_id, chapter_id, position, is_assembly, is_critique, is_corrector, title, content, user_prompt, function, notes, source_context, created_at)
SELECT id, project_id, chapter_id, position, is_assembly, is_critique, is_corrector, title, content, user_prompt, function, notes, source_context, created_at
FROM project_prompts;

-- ============================================================
-- PHASE 7: Re-add FKs pointing to unified prompts table
-- ============================================================

ALTER TABLE fragments ADD CONSTRAINT fragments_project_prompt_id_prompts_id_fk
  FOREIGN KEY (project_prompt_id) REFERENCES prompts (id) ON DELETE CASCADE;

ALTER TABLE prompt_versions ADD CONSTRAINT prompt_versions_prompt_id_prompts_id_fk
  FOREIGN KEY (prompt_id) REFERENCES prompts (id) ON DELETE CASCADE;

-- ============================================================
-- PHASE 8: Drop project_prompts
-- ============================================================

DROP INDEX IF EXISTS idx_project_prompts_chapter_position;
DROP INDEX IF EXISTS idx_project_prompts_one_assembly_per_chapter;
DROP TABLE IF EXISTS project_prompts;

-- ============================================================
-- PHASE 9: Enable RLS on prompt_library
-- ============================================================

ALTER TABLE prompt_library ENABLE ROW LEVEL SECURITY;

-- Admin-only: all operations on prompt_library
DROP POLICY IF EXISTS prompt_library_admin_all ON prompt_library;

-- Check if the user has admin role via app_metadata
CREATE POLICY prompt_library_admin_all ON prompt_library
  FOR ALL TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
