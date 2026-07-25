import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../../supabase/migrations/20260722000003_add_remediation_lineage.sql",
    import.meta.url,
  ),
  "utf8",
);

const collapsed = sql.replace(/\s+/g, " ");

const rlsSql = readFileSync(
  new URL(
    "../../supabase/migrations/20260722000004_add_maintenance_operations_rls_policy.sql",
    import.meta.url,
  ),
  "utf8",
);

const rlsCollapsed = rlsSql.replace(/\s+/g, " ");

describe("remediation lineage migration", () => {
  it("creates immutable idempotency ledger", () => {
    expect(collapsed).toContain("CREATE TABLE pipeline_maintenance_operations");
    expect(collapsed).toContain("input_hash text NOT NULL");
    expect(collapsed).toContain("kind IN ('template_regeneration', 'project_clone')");
    expect(collapsed).toContain("status IN ('running', 'completed', 'failed')");
  });

  it("links a replacement project without cascading deletion", () => {
    expect(collapsed).toContain("ALTER TABLE projects ADD COLUMN supersedes_project_id");
    expect(collapsed).toContain("REFERENCES projects(id) ON DELETE RESTRICT");
    expect(collapsed).toContain("UNIQUE INDEX uq_projects_supersedes_project");
  });

  it("grants service role full access via RLS policy", () => {
    expect(rlsCollapsed).toContain("CREATE POLICY service_role_all");
    expect(rlsCollapsed).toContain("TO service_role");
    expect(rlsCollapsed).toContain("FOR ALL");
  });
});
