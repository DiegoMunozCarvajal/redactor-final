-- Drop old FK with ON DELETE CASCADE and recreate with ON DELETE SET NULL.
-- This prevents deleting a book template from cascade-deleting project-scoped
-- chapters that reference it.
ALTER TABLE chapters DROP CONSTRAINT IF EXISTS chapters_book_template_id_book_templates_id_fk;
ALTER TABLE chapters ADD CONSTRAINT chapters_book_template_id_book_templates_id_fk
  FOREIGN KEY (book_template_id) REFERENCES book_templates(id) ON DELETE SET NULL;
