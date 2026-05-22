-- Create chapter_placeholders table
CREATE TABLE IF NOT EXISTS chapter_placeholders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id  uuid NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  name        text NOT NULL,
  definition  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chapter_placeholders_unique
  ON chapter_placeholders (chapter_id, name);

-- Make projects.topic nullable
ALTER TABLE projects ALTER COLUMN topic DROP NOT NULL;

-- Migrate [TEMA]/[TOPIC] → {tema} in template prompts
UPDATE prompts
SET content = REPLACE(REPLACE(content, '[TEMA]', '{tema}'), '[TOPIC]', '{tema}')
WHERE content LIKE '%[TEMA]%' OR content LIKE '%[TOPIC]%';

-- Migrate [SUBTÍTULO]/[SUBTITLE] → {subtitulo} in template prompts
UPDATE prompts
SET content = REPLACE(REPLACE(content, '[SUBTÍTULO]', '{subtitulo}'), '[SUBTITLE]', '{subtitulo}')
WHERE content LIKE '%[SUBTÍTULO]%' OR content LIKE '%[SUBTITLE]%';

-- Migrate [TEMA]/[TOPIC] → {tema} in project prompts
UPDATE project_prompts
SET content = REPLACE(REPLACE(content, '[TEMA]', '{tema}'), '[TOPIC]', '{tema}')
WHERE content LIKE '%[TEMA]%' OR content LIKE '%[TOPIC]%';

-- Migrate [SUBTÍTULO]/[SUBTITLE] → {subtitulo} in project prompts
UPDATE project_prompts
SET content = REPLACE(REPLACE(content, '[SUBTÍTULO]', '{subtitulo}'), '[SUBTITLE]', '{subtitulo}')
WHERE content LIKE '%[SUBTÍTULO]%' OR content LIKE '%[SUBTITLE]%';

-- Backfill chapter_placeholders for template chapters (detect {name} from prompts)
INSERT INTO chapter_placeholders (chapter_id, name, definition)
SELECT DISTINCT p.chapter_id, ph.name, NULL
FROM prompts p
CROSS JOIN LATERAL (
  SELECT unnest(regexp_matches(p.content, '\{([a-zA-Z_][a-zA-Z0-9_]*)\}', 'g')) AS name
) ph
WHERE NOT EXISTS (
  SELECT 1 FROM chapter_placeholders cp
  WHERE cp.chapter_id = p.chapter_id AND cp.name = ph.name
);

-- Backfill chapter_placeholders for project chapters: {tema} from projects.topic
INSERT INTO chapter_placeholders (chapter_id, name, definition)
SELECT c.id, 'tema', p.topic
FROM chapters c
JOIN projects p ON p.id = c.project_id
WHERE c.project_id IS NOT NULL
  AND p.topic IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM chapter_placeholders cp WHERE cp.chapter_id = c.id AND cp.name = 'tema'
  );

-- Backfill chapter_placeholders for project chapters: {subtitulo} from projects.subtitle
INSERT INTO chapter_placeholders (chapter_id, name, definition)
SELECT c.id, 'subtitulo', p.subtitle
FROM chapters c
JOIN projects p ON p.id = c.project_id
WHERE c.project_id IS NOT NULL
  AND p.subtitle IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM chapter_placeholders cp WHERE cp.chapter_id = c.id AND cp.name = 'subtitulo'
  );

-- Backfill other detected placeholders for project chapters
INSERT INTO chapter_placeholders (chapter_id, name, definition)
SELECT DISTINCT pp.chapter_id, ph.name, NULL
FROM project_prompts pp
CROSS JOIN LATERAL (
  SELECT unnest(regexp_matches(pp.content, '\{([a-zA-Z_][a-zA-Z0-9_]*)\}', 'g')) AS name
) ph
WHERE NOT EXISTS (
  SELECT 1 FROM chapter_placeholders cp
  WHERE cp.chapter_id = pp.chapter_id AND cp.name = ph.name
);
