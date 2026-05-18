-- Drop old RLS policies that depend on old columns/tables
DROP POLICY IF EXISTS fragments_select ON fragments;
DROP POLICY IF EXISTS chapter_runs_select ON chapter_runs;
DROP POLICY IF EXISTS runs_select ON runs;

-- Drop old FK columns from fragments (after data is migrated / old system is gone)
ALTER TABLE fragments DROP COLUMN IF EXISTS chapter_run_id CASCADE;
ALTER TABLE fragments DROP COLUMN IF EXISTS prompt_id;

-- Make new columns NOT NULL (only if all data backfilled)
ALTER TABLE fragments ALTER COLUMN chapter_generation_id SET NOT NULL;
ALTER TABLE fragments ALTER COLUMN project_prompt_id SET NOT NULL;

-- Drop old index
DROP INDEX IF EXISTS idx_fragments_chapter_run;

-- Drop old tables
DROP TABLE IF EXISTS chapter_runs CASCADE;
DROP TABLE IF EXISTS runs CASCADE;

-- Drop old enums
DROP TYPE IF EXISTS chapter_run_status;
DROP TYPE IF EXISTS run_status;
