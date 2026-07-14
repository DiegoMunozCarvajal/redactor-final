CREATE TYPE editorial_brief_status AS ENUM ('draft', 'approved', 'archived');

CREATE TABLE editorial_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version integer NOT NULL
    CONSTRAINT chk_editorial_briefs_version CHECK (version > 0),
  status editorial_brief_status NOT NULL DEFAULT 'draft',
  content jsonb NOT NULL,
  content_hash text NOT NULL
    CONSTRAINT chk_editorial_briefs_content_hash
    CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_editorial_briefs_project_version UNIQUE (project_id, version)
);

CREATE UNIQUE INDEX uq_editorial_briefs_project_draft
  ON editorial_briefs(project_id) WHERE status = 'draft';
CREATE UNIQUE INDEX uq_editorial_briefs_project_approved
  ON editorial_briefs(project_id) WHERE status = 'approved';

CREATE TABLE chapter_editorial_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  editorial_brief_id uuid NOT NULL REFERENCES editorial_briefs(id) ON DELETE CASCADE,
  chapter_id uuid NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  content jsonb NOT NULL,
  content_hash text NOT NULL
    CONSTRAINT chk_contracts_content_hash
    CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_chapter_editorial_contracts_brief_chapter
    UNIQUE (editorial_brief_id, chapter_id)
);

CREATE INDEX idx_chapter_editorial_contracts_brief
  ON chapter_editorial_contracts(editorial_brief_id);

CREATE TABLE editorial_brief_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  editorial_brief_id uuid NOT NULL REFERENCES editorial_briefs(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  use_for_extraction boolean NOT NULL DEFAULT true,
  use_for_evidence boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_editorial_brief_sources_brief_source
    UNIQUE (editorial_brief_id, source_id)
);

ALTER TABLE editorial_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE chapter_editorial_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE editorial_brief_sources ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_editorial_brief_sources_brief
  ON editorial_brief_sources(editorial_brief_id);
