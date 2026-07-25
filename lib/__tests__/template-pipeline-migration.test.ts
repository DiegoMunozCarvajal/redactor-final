import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../../supabase/migrations/20260722000000_add_template_pipeline_lineage.sql",
    import.meta.url,
  ),
  "utf8",
);

// Collapse whitespace so multi-line SQL matches string.contains checks.
const collapsed = sql.replace(/\s+/g, " ");

describe("template pipeline lineage migration", () => {
  it("creates immutable run, profile, chunk, and artifact storage", () => {
    for (const table of [
      "template_pipeline_runs",
      "template_source_profiles",
      "template_source_profile_chunks",
      "template_run_artifacts",
    ]) {
      expect(collapsed).toContain(`CREATE TABLE ${table}`);
      expect(collapsed).toContain(
        `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`,
      );
    }
    expect(collapsed).toContain("UNIQUE (pipeline_run_id, chapter_id)");
    expect(collapsed).toContain("vector(1536)");
  });

  it("adds nullable lineage for legacy rows", () => {
    expect(collapsed).toContain(
      "book_templates ADD COLUMN active_pipeline_run_id",
    );
    expect(collapsed).toContain(
      "prompts ADD COLUMN template_pipeline_run_id",
    );
    expect(collapsed).toContain(
      "ADD COLUMN template_artifact_hash",
    );
    expect(collapsed).toContain(
      "chapter_placeholders ADD COLUMN template_pipeline_run_id",
    );
    expect(collapsed).toContain(
      "ADD COLUMN dependency_names",
    );
  });

  it("restricts deletion of active lineage", () => {
    expect(collapsed).toContain("ON DELETE RESTRICT");
    expect(collapsed).toContain("chk_template_pipeline_run_status");
    expect(collapsed).toContain("chk_template_operational_status");
  });
});
