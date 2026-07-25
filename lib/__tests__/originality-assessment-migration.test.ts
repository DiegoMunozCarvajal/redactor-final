import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../../supabase/migrations/20260722000002_add_originality_assessments.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("originality assessment migration", () => {
  it("stores decisions without candidate prose", () => {
    expect(sql).toContain("CREATE TABLE originality_assessments");
    expect(sql).toContain("candidate_hash text NOT NULL");
    expect(sql).toContain("signals jsonb NOT NULL");
    expect(sql).not.toContain("candidate_text");
    expect(sql).not.toContain("source_text");
  });

  it("enforces source-free versus template lineage", () => {
    expect(sql).toContain("scope IN ('template', 'source-free')");
    expect(sql).toContain("pipeline_run_id IS NOT NULL");
    expect(sql).toContain("pipeline_run_id IS NULL");
  });

  it("adds quarantined generation status and definition_origin column", () => {
    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'quarantined'");
    expect(sql).toContain("decision IN ('clean', 'suspect', 'contaminated')");
    expect(sql).toContain("definition_origin text NOT NULL DEFAULT 'legacy'");
  });
});
