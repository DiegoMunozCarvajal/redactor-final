ALTER TABLE prompts ADD COLUMN user_prompt TEXT;
ALTER TABLE project_prompts ADD COLUMN user_prompt TEXT;
ALTER TABLE prompt_versions ADD COLUMN user_prompt TEXT;
