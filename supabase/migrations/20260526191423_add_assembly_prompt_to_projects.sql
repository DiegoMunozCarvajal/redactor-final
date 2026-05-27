ALTER TABLE projects ADD COLUMN assembly_prompt_id uuid REFERENCES assembly_prompts(id) ON DELETE SET NULL;
