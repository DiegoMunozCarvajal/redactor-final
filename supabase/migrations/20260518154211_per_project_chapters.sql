-- Add project_id to chapters for per-project chapter customization
ALTER TABLE chapters
  ADD COLUMN project_id uuid REFERENCES projects(id) ON DELETE CASCADE;

CREATE INDEX idx_chapters_project ON chapters(project_id);

-- Make book_template_id nullable (project chapters can exist without a template)
ALTER TABLE chapters
  ALTER COLUMN book_template_id DROP NOT NULL;

-- Backfill: copy template chapters as project-scoped chapters for existing projects
DO $$
DECLARE
  proj RECORD;
BEGIN
  FOR proj IN SELECT id, book_template_id FROM projects
  LOOP
    -- Create a temp mapping of old chapter id -> new chapter id for this project
    CREATE TEMP TABLE IF NOT EXISTS _chapter_map (
      old_id uuid PRIMARY KEY,
      new_id uuid NOT NULL
    ) ON COMMIT DROP;

    WITH inserted AS (
      INSERT INTO chapters (book_template_id, project_id, position, title)
      SELECT ch.book_template_id, proj.id, ch.position, ch.title
      FROM chapters ch
      WHERE ch.book_template_id = proj.book_template_id
        AND ch.project_id IS NULL
      ORDER BY ch.position
      RETURNING id, position
    ),
    old_chapters AS (
      SELECT ch.id, ch.position
      FROM chapters ch
      WHERE ch.book_template_id = proj.book_template_id
        AND ch.project_id IS NULL
    )
    INSERT INTO _chapter_map (old_id, new_id)
    SELECT oc.id, ins.id
    FROM old_chapters oc
    JOIN inserted ins ON ins.position = oc.position;

    -- Update project_prompts to point to new project chapters
    UPDATE project_prompts pp
    SET chapter_id = m.new_id
    FROM _chapter_map m
    WHERE pp.project_id = proj.id
      AND pp.chapter_id = m.old_id;

    -- Update chapter_generations to point to new project chapters
    UPDATE chapter_generations cg
    SET chapter_id = m.new_id
    FROM _chapter_map m
    WHERE cg.project_id = proj.id
      AND cg.chapter_id = m.old_id;

    DROP TABLE IF EXISTS _chapter_map;
  END LOOP;
END;
$$;
