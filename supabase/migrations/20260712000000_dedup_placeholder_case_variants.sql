-- Deduplicate chapter_placeholders case variants.
-- extractPlaceholders was fixed to lowercase names, but pre-fix data had
-- mixed-case duplicates (e.g., "CITA_O_ANECDOTA" + "cita_o_anecdota").
-- Merge definitions/function/notes into the canonical lowercase row, then
-- delete the non-canonical rows.

DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT
      chapter_id,
      lower(name) AS canonical_name,
      array_agg(name ORDER BY (name = lower(name)) DESC, (definition IS NOT NULL) DESC, ctid) AS names,
      -- Prefer: definition from lowercase row, then from any row with definition
      coalesce(
        max(definition) FILTER (WHERE name = lower(name)),
        max(definition) FILTER (WHERE definition IS NOT NULL)
      ) AS best_definition,
      coalesce(
        max("function") FILTER (WHERE name = lower(name)),
        max("function") FILTER (WHERE "function" IS NOT NULL)
      ) AS best_function,
      coalesce(
        max(notes) FILTER (WHERE name = lower(name)),
        max(notes) FILTER (WHERE notes IS NOT NULL)
      ) AS best_notes
    FROM chapter_placeholders
    GROUP BY chapter_id, lower(name)
    HAVING COUNT(*) > 1
  LOOP
    -- Upsert the canonical lowercase row with merged data
    INSERT INTO chapter_placeholders (chapter_id, name, definition, "function", notes)
    VALUES (rec.chapter_id, rec.canonical_name, rec.best_definition, rec.best_function, rec.best_notes)
    ON CONFLICT (chapter_id, name)
    DO UPDATE SET
      definition = coalesce(excluded.definition, chapter_placeholders.definition),
      "function" = coalesce(excluded."function", chapter_placeholders."function"),
      notes = coalesce(excluded.notes, chapter_placeholders.notes);

    -- Delete all rows in the group (the canonical row was just upserted above)
    DELETE FROM chapter_placeholders
    WHERE chapter_id = rec.chapter_id
      AND lower(name) = rec.canonical_name
      AND name != rec.canonical_name;
  END LOOP;
END $$;
