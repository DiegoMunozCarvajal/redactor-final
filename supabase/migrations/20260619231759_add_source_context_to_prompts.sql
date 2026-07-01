-- Add source_context column to prompts and project_prompts
-- Stores the original content summary of the source chapter unit
-- that each prompt was derived from. Used by meta-prompt v1.6.

ALTER TABLE prompts ADD COLUMN IF NOT EXISTS source_context TEXT;
ALTER TABLE project_prompts ADD COLUMN IF NOT EXISTS source_context TEXT;
