-- Protect editorial-brief records from direct cross-project reads. Application
-- mutations use the privileged server connection; authenticated clients only
-- receive owner-scoped read access.

ALTER TABLE editorial_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE chapter_editorial_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE editorial_brief_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS editorial_briefs_owner_select ON editorial_briefs;
CREATE POLICY editorial_briefs_owner_select ON editorial_briefs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM projects p
      WHERE p.id = editorial_briefs.project_id
        AND p.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS chapter_editorial_contracts_owner_select
  ON chapter_editorial_contracts;
CREATE POLICY chapter_editorial_contracts_owner_select
  ON chapter_editorial_contracts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM editorial_briefs eb
      JOIN projects p ON p.id = eb.project_id
      WHERE eb.id = chapter_editorial_contracts.editorial_brief_id
        AND p.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS editorial_brief_sources_owner_select
  ON editorial_brief_sources;
CREATE POLICY editorial_brief_sources_owner_select ON editorial_brief_sources
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM editorial_briefs eb
      JOIN projects p ON p.id = eb.project_id
      WHERE eb.id = editorial_brief_sources.editorial_brief_id
        AND p.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS sources_owner_select ON sources;
CREATE POLICY sources_owner_select ON sources
  FOR SELECT
  TO authenticated
  USING (
    project_id IN (
      SELECT p.id
      FROM projects p
      WHERE p.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS source_chunks_owner_select ON source_chunks;
CREATE POLICY source_chunks_owner_select ON source_chunks
  FOR SELECT
  TO authenticated
  USING (
    project_id IN (
      SELECT p.id
      FROM projects p
      WHERE p.user_id = (select auth.uid())
    )
  );

REVOKE ALL PRIVILEGES ON TABLE
  editorial_briefs,
  chapter_editorial_contracts,
  editorial_brief_sources,
  sources,
  source_chunks
FROM anon;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE
  editorial_briefs,
  chapter_editorial_contracts,
  editorial_brief_sources,
  sources,
  source_chunks
FROM authenticated;

GRANT SELECT ON TABLE
  editorial_briefs,
  chapter_editorial_contracts,
  editorial_brief_sources,
  sources,
  source_chunks
TO authenticated;

-- The original table declaration created PostgreSQL's automatic `_fkey`
-- constraint. A later migration added a second constraint under the Drizzle
-- name without reliably removing the first. Remove every chapter FK discovered
-- through the catalog, then install one stable RESTRICT constraint.
DO $$
DECLARE
  fk record;
BEGIN
  FOR fk IN
    SELECT DISTINCT con.conname
    FROM pg_constraint con
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid
     AND att.attnum = ANY(con.conkey)
    WHERE con.contype = 'f'
      AND con.conrelid = 'chapter_editorial_contracts'::regclass
      AND con.confrelid = 'chapters'::regclass
      AND att.attname = 'chapter_id'
  LOOP
    EXECUTE format(
      'ALTER TABLE chapter_editorial_contracts DROP CONSTRAINT %I',
      fk.conname
    );
  END LOOP;
END $$;

ALTER TABLE chapter_editorial_contracts
  ADD CONSTRAINT chapter_editorial_contracts_chapter_id_restrict_fk
  FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE RESTRICT;

DO $$
DECLARE
  chapter_fk_count integer;
  restrict_fk_count integer;
BEGIN
  SELECT
    count(DISTINCT con.oid),
    count(DISTINCT con.oid) FILTER (WHERE con.confdeltype = 'r')
  INTO chapter_fk_count, restrict_fk_count
  FROM pg_constraint con
  JOIN pg_attribute att
    ON att.attrelid = con.conrelid
   AND att.attnum = ANY(con.conkey)
  WHERE con.contype = 'f'
    AND con.conrelid = 'chapter_editorial_contracts'::regclass
    AND con.confrelid = 'chapters'::regclass
    AND att.attname = 'chapter_id';

  IF chapter_fk_count != 1 THEN
    RAISE EXCEPTION
      'Expected exactly one chapter_editorial_contracts.chapter_id foreign key, found %',
      chapter_fk_count;
  END IF;

  IF restrict_fk_count != 1 THEN
    RAISE EXCEPTION
      'Expected chapter_editorial_contracts.chapter_id foreign key to use RESTRICT';
  END IF;
END $$;
