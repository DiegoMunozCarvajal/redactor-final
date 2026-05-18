CREATE UNIQUE INDEX IF NOT EXISTS idx_prompts_chapter_position ON prompts(chapter_id, position);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_prompts_chapter_position ON project_prompts(chapter_id, position);
