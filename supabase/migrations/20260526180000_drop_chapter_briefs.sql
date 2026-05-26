-- Drop chapter_briefs table and associated trigger/function.
-- The chapter brief feature is being removed — the structured prompts
-- from real book chapters already provide sufficient chapter-level context.

DROP TRIGGER IF EXISTS trg_chapter_briefs_updated_at ON chapter_briefs;
DROP FUNCTION IF EXISTS update_chapter_briefs_updated_at();
DROP TABLE IF EXISTS chapter_briefs CASCADE;
