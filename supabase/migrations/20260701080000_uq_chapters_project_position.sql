-- Add unique constraint on (project_id, position) to prevent duplicate
-- positions within a project. NULL project_ids (template chapters) are
-- excluded by PostgreSQL's default NULL != NULL behavior for unique indexes.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_chapters_project_position"
  ON "chapters" ("project_id", "position");
