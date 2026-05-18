-- Drop the auto-generated FK (from inline CREATE TABLE) which still has ON DELETE CASCADE
ALTER TABLE chapters DROP CONSTRAINT IF EXISTS chapters_book_template_id_fkey;
