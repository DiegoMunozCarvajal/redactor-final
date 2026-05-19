-- Drop style_rules, knowledge_areas, suggested_length from prompts and project_prompts.
-- These fields are being merged into content; the AI no longer uses them separately.
ALTER TABLE prompts DROP COLUMN IF EXISTS style_rules;
ALTER TABLE prompts DROP COLUMN IF EXISTS knowledge_areas;
ALTER TABLE prompts DROP COLUMN IF EXISTS suggested_length;
ALTER TABLE project_prompts DROP COLUMN IF EXISTS style_rules;
ALTER TABLE project_prompts DROP COLUMN IF EXISTS knowledge_areas;
ALTER TABLE project_prompts DROP COLUMN IF EXISTS suggested_length;
