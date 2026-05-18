-- Enable RLS on new tables
ALTER TABLE chapter_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_prompts ENABLE ROW LEVEL SECURITY;

-- chapter_generations: accessible via project ownership
CREATE POLICY "chapter_generations_select" ON chapter_generations
  FOR SELECT TO authenticated
  USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

-- project_prompts: accessible via project ownership
CREATE POLICY "project_prompts_select" ON project_prompts
  FOR SELECT TO authenticated
  USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

-- Also add RLS for the updated chapters table (project-scoped chapters)
-- Original policy allowed all authenticated to read all chapters.
-- Project chapters should be scoped to project ownership.
DROP POLICY IF EXISTS "chapters_read" ON chapters;
CREATE POLICY "chapters_read" ON chapters
  FOR SELECT TO authenticated
  USING (
    project_id IS NULL  -- template chapters (public to all authenticated)
    OR project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())  -- project chapters (owner only)
  );

-- prompts: keep original policy (template prompts are public to authenticated)
-- DO NOT drop the original "prompts_read" policy
