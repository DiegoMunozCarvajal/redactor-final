-- Re-create fragments_select policy for new chapter_generation_id column.
-- Original policy (001_initial.sql:139) was dropped in cleanup (20260518122545:2)
-- because it referenced old chapter_run_id → chapter_runs → runs path.
-- This replaces it with chapter_generation_id → chapter_generations → projects path.

CREATE POLICY "fragments_select" ON fragments
  FOR SELECT TO authenticated
  USING (
    chapter_generation_id IN (
      SELECT cg.id FROM chapter_generations cg
      JOIN projects p ON cg.project_id = p.id
      WHERE p.user_id = auth.uid()
    )
  );

-- Also add INSERT/UPDATE/DELETE policies since the app writes fragments
CREATE POLICY "fragments_insert" ON fragments
  FOR INSERT TO authenticated
  WITH CHECK (
    chapter_generation_id IN (
      SELECT cg.id FROM chapter_generations cg
      JOIN projects p ON cg.project_id = p.id
      WHERE p.user_id = auth.uid()
    )
  );

CREATE POLICY "fragments_update" ON fragments
  FOR UPDATE TO authenticated
  USING (
    chapter_generation_id IN (
      SELECT cg.id FROM chapter_generations cg
      JOIN projects p ON cg.project_id = p.id
      WHERE p.user_id = auth.uid()
    )
  );

CREATE POLICY "fragments_delete" ON fragments
  FOR DELETE TO authenticated
  USING (
    chapter_generation_id IN (
      SELECT cg.id FROM chapter_generations cg
      JOIN projects p ON cg.project_id = p.id
      WHERE p.user_id = auth.uid()
    )
  );
