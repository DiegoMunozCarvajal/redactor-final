-- Add missing updated_at column to book_templates
-- Drizzle schema declares it but initial migration never created it
ALTER TABLE book_templates
ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
