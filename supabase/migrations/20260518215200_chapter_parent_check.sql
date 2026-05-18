ALTER TABLE chapters ADD CONSTRAINT chk_chapter_parent
  CHECK (book_template_id IS NOT NULL OR project_id IS NOT NULL);
