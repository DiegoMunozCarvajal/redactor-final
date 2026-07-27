-- Add source-risk-profiler and source-leakage-review to the CHECK constraints
-- created in previous migrations. These kinds were added to the TypeScript schema
-- but the SQL CHECK constraints were never updated to allow them.
--
-- Uses dynamic SQL to find auto-generated constraint names since inline
-- CHECK constraints get DB-generated names.

DO $$
DECLARE
  _tables text[] := ARRAY['prompt_definitions', 'prompt_defaults', 'project_prompt_bindings'];
  _allowed text[] := ARRAY[
    'generation-system','meta-template','assembly-planner','assembly',
    'critique','corrector','title','placeholder-fill','editorial-brief-extractor',
    'rhetoric-trace','template-generator','source-risk-profiler','source-leakage-review'
  ];
  _allowed_str text;
  _tbl text;
  _con_name text;
BEGIN
  _allowed_str := array_to_string(
    ARRAY(SELECT quote_literal(unnest(_allowed))), ','
  );

  FOREACH _tbl IN ARRAY _tables LOOP
    SELECT con.conname INTO _con_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = _tbl
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%kind%';

    IF _con_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', _tbl, _con_name);
    END IF;

    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (kind IN (%s))',
      _tbl,
      _tbl || '_kind_check',
      _allowed_str
    );
  END LOOP;
END;
$$;
