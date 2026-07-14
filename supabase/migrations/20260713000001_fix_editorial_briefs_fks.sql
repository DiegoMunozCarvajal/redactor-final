-- Fix FK constraints and indexes from 20260713000000_add_editorial_briefs.sql
--
-- 1. Change chapter_editorial_contracts.chapter_id FK from CASCADE to RESTRICT.
--    CASCADE would silently remove contracts from an approved brief when a
--    chapter is deleted, corrupting the brief's contract list.
-- 2. Drop redundant single-column indexes that are already covered by the
--    leftmost prefix of composite unique constraints.
-- 3. Name the table-level UNIQUE constraint on editorial_briefs to match
--    the Drizzle schema (uq_editorial_briefs_project_version).

-- Step 1: Fix chapter FK from CASCADE to RESTRICT
ALTER TABLE chapter_editorial_contracts
  DROP CONSTRAINT IF EXISTS chapter_editorial_contracts_chapter_id_chapters_id_fk;

ALTER TABLE chapter_editorial_contracts
  ADD CONSTRAINT chapter_editorial_contracts_chapter_id_chapters_id_fk
  FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE RESTRICT;

-- Step 2: Drop redundant indexes (covered by composite unique index leftmost prefix)
DROP INDEX IF EXISTS idx_chapter_editorial_contracts_brief;
DROP INDEX IF EXISTS idx_editorial_brief_sources_brief;

-- Step 3: Rename the unnamed UNIQUE constraint to match Drizzle
-- PostgreSQL auto-names unnamed constraints. Find and rename it.
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'editorial_briefs'
    AND con.contype = 'u'
    AND con.conname LIKE '%project_id%version%';

  IF constraint_name IS NOT NULL AND constraint_name != 'uq_editorial_briefs_project_version' THEN
    EXECUTE format(
      'ALTER TABLE editorial_briefs RENAME CONSTRAINT %I TO uq_editorial_briefs_project_version',
      constraint_name
    );
  END IF;
END $$;
