BEGIN;

-- Drop NOT NULL on prompts.current_revision_id so new prompts can be created
-- without an immediate revision. The revision is created on first edit.
ALTER TABLE prompts ALTER COLUMN current_revision_id DROP NOT NULL;

-- Drop NOT NULL on fragments.prompt_revision_id so fragments can reference
-- prompts that lack a revision yet.
ALTER TABLE fragments ALTER COLUMN prompt_revision_id DROP NOT NULL;

COMMIT;
