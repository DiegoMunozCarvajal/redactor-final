-- Add function and notes columns to prompts
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS function TEXT;
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS notes TEXT;

-- Add function and notes columns to project_prompts
ALTER TABLE project_prompts ADD COLUMN IF NOT EXISTS function TEXT;
ALTER TABLE project_prompts ADD COLUMN IF NOT EXISTS notes TEXT;

-- Add function and notes columns to chapter_placeholders
ALTER TABLE chapter_placeholders ADD COLUMN IF NOT EXISTS function TEXT;
ALTER TABLE chapter_placeholders ADD COLUMN IF NOT EXISTS notes TEXT;

-- Add awaiting_assembly status to generation_status enum
ALTER TYPE generation_status ADD VALUE IF NOT EXISTS 'awaiting_assembly';

-- Create meta_prompts table
CREATE TABLE IF NOT EXISTS meta_prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create assembly_prompts table
CREATE TABLE IF NOT EXISTS assembly_prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
