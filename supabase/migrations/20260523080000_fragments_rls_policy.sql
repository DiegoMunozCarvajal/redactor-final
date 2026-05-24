-- Re-create fragments policies for new chapter_generation_id column.
-- Original policy (001_initial.sql:139) was dropped in cleanup (20260518122545:2)
-- because it referenced old chapter_run_id → chapter_runs → runs path.
-- These replace it with chapter_generation_id → chapter_generations → projects path.
-- Uses DO blocks so the migration is idempotent.

DO $$ BEGIN
  CREATE POLICY "fragments_select" ON fragments
    FOR SELECT TO authenticated
    USING (
      chapter_generation_id IN (
        SELECT cg.id FROM chapter_generations cg
        JOIN projects p ON cg.project_id = p.id
        WHERE p.user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "fragments_insert" ON fragments
    FOR INSERT TO authenticated
    WITH CHECK (
      chapter_generation_id IN (
        SELECT cg.id FROM chapter_generations cg
        JOIN projects p ON cg.project_id = p.id
        WHERE p.user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "fragments_update" ON fragments
    FOR UPDATE TO authenticated
    USING (
      chapter_generation_id IN (
        SELECT cg.id FROM chapter_generations cg
        JOIN projects p ON cg.project_id = p.id
        WHERE p.user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "fragments_delete" ON fragments
    FOR DELETE TO authenticated
    USING (
      chapter_generation_id IN (
        SELECT cg.id FROM chapter_generations cg
        JOIN projects p ON cg.project_id = p.id
        WHERE p.user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
