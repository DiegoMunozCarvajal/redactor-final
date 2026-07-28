CREATE TABLE placeholder_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  placeholder_id UUID NOT NULL REFERENCES chapter_placeholders(id) ON DELETE CASCADE,
  definition TEXT,
  fill_metadata JSONB,
  chapter_generation_id UUID REFERENCES chapter_generations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_placeholder_versions_placeholder
  ON placeholder_versions(placeholder_id, created_at DESC);

ALTER TABLE chapter_placeholders
  ADD COLUMN active_version_id UUID REFERENCES placeholder_versions(id) ON DELETE SET NULL;

-- Backfill: create version rows for all existing definitions
INSERT INTO placeholder_versions (placeholder_id, definition, fill_metadata, created_at)
SELECT
  cp.id AS placeholder_id,
  cp.definition,
  cp.fill_metadata,
  COALESCE(cp.created_at, NOW()) AS created_at
FROM chapter_placeholders cp
WHERE cp.definition IS NOT NULL;

-- Set active_version_id for backfilled rows
UPDATE chapter_placeholders cp
SET active_version_id = pv.id
FROM placeholder_versions pv
WHERE pv.placeholder_id = cp.id
  AND cp.definition IS NOT NULL;
