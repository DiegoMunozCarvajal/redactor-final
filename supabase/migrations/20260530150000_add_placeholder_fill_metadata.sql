ALTER TABLE chapter_placeholders
ADD COLUMN IF NOT EXISTS fill_metadata jsonb;

DELETE FROM chapter_placeholders
WHERE name = 'SECCIONES_GENERADAS'
  AND definition IS NULL
  AND function IS NULL
  AND notes IS NULL;
