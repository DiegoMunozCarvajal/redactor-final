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

-- Reconcile automatic names created by the original base migration. New
-- installs already use canonical names; this block repairs databases where the
-- base migration ran before those names were made explicit.
DO $$
DECLARE
  constraint_mapping record;
BEGIN
  FOR constraint_mapping IN
    SELECT *
    FROM (VALUES
      ('editorial_briefs'::regclass, 'editorial_briefs_version_check', 'chk_editorial_briefs_version'),
      ('editorial_briefs'::regclass, 'editorial_briefs_content_hash_check', 'chk_editorial_briefs_content_hash'),
      ('chapter_editorial_contracts'::regclass, 'chapter_editorial_contracts_content_hash_check', 'chk_contracts_content_hash'),
      ('chapter_editorial_contracts'::regclass, 'chapter_editorial_contracts_editorial_brief_id_chapter_id_key', 'uq_chapter_editorial_contracts_brief_chapter'),
      ('editorial_brief_sources'::regclass, 'editorial_brief_sources_editorial_brief_id_source_id_key', 'uq_editorial_brief_sources_brief_source')
    ) AS mappings(table_oid, legacy_name, canonical_name)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = constraint_mapping.table_oid
        AND conname = constraint_mapping.legacy_name
    ) AND NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = constraint_mapping.table_oid
        AND conname = constraint_mapping.canonical_name
    ) THEN
      EXECUTE format(
        'ALTER TABLE %s RENAME CONSTRAINT %I TO %I',
        constraint_mapping.table_oid,
        constraint_mapping.legacy_name,
        constraint_mapping.canonical_name
      );
    END IF;
  END LOOP;
END $$;
