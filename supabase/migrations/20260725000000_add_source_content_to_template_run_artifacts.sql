-- Add source_content column to template_run_artifacts so --allow-execution-source
-- regeneration can recover the original source chapter content instead of reading
-- compiledTemplate (which is contaminated prompt blocks).
ALTER TABLE template_run_artifacts
ADD COLUMN IF NOT EXISTS source_content text;
