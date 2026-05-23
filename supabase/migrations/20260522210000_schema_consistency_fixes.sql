-- Batch 1 schema consistency fixes
-- Issues: enum values, fragment index, audit metadata type, chapter_briefs trigger

-- Issue 10: Add missing generation_status enum values
ALTER TYPE generation_status ADD VALUE IF NOT EXISTS 'pending' BEFORE 'generating';
ALTER TYPE generation_status ADD VALUE IF NOT EXISTS 'assembling' AFTER 'generating';

-- Issue 11: Index on fragments.project_prompt_id for delete-by-prompt queries
CREATE INDEX IF NOT EXISTS idx_fragments_project_prompt ON fragments(project_prompt_id);

-- Issue 20: Change audit_logs.metadata from text to jsonb
ALTER TABLE audit_logs ALTER COLUMN metadata TYPE jsonb USING metadata::jsonb;

-- Issue 21: Auto-update trigger for chapter_briefs.updated_at
CREATE OR REPLACE FUNCTION update_chapter_briefs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_chapter_briefs_updated_at ON chapter_briefs;
CREATE TRIGGER trg_chapter_briefs_updated_at
  BEFORE UPDATE ON chapter_briefs
  FOR EACH ROW
  EXECUTE FUNCTION update_chapter_briefs_updated_at();
