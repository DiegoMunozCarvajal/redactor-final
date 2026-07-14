import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../supabase/migrations/20260714000000_secure_editorial_briefs.sql",
  import.meta.url,
);
const migration = existsSync(migrationUrl)
  ? readFileSync(migrationUrl, "utf8")
  : "";

describe("editorial brief security migration", () => {
  it.each([
    "editorial_briefs",
    "chapter_editorial_contracts",
    "editorial_brief_sources",
  ])("enables RLS on %s", (table) => {
    expect(migration).toMatch(
      new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`, "i"),
    );
  });

  it.each([
    "editorial_briefs",
    "chapter_editorial_contracts",
    "editorial_brief_sources",
  ])("grants owner-scoped SELECT access on %s", (table) => {
    expect(migration).toMatch(
      new RegExp(
        `CREATE POLICY [\\s\\S]+? ON ${table}\\s+FOR SELECT\\s+TO authenticated\\s+USING`,
        "i",
      ),
    );
  });

  it("chains every read policy to projects.user_id", () => {
    expect(
      migration.match(/p\.user_id\s*=\s*\(select auth\.uid\(\)\)/gi),
    ).toHaveLength(5);
    expect(migration).toMatch(
      /FROM editorial_briefs eb\s+JOIN projects p ON p\.id = eb\.project_id/gi,
    );
  });

  it("leaves direct authenticated mutations denied by default", () => {
    expect(migration).not.toMatch(/FOR\s+(INSERT|UPDATE|DELETE|ALL)/i);
  });

  it("drops every chapter foreign key before installing one stable RESTRICT key", () => {
    expect(migration).toContain("con.conrelid = 'chapter_editorial_contracts'::regclass");
    expect(migration).toContain("con.confrelid = 'chapters'::regclass");
    expect(migration).toContain("att.attname = 'chapter_id'");
    expect(migration).toMatch(/ALTER TABLE chapter_editorial_contracts DROP CONSTRAINT %I/);
    expect(migration).toMatch(
      /ADD CONSTRAINT chapter_editorial_contracts_chapter_id_restrict_fk[\s\S]+ON DELETE RESTRICT/i,
    );
  });

  it("fails migration unless exactly one RESTRICT chapter key remains", () => {
    expect(migration).toContain("con.confdeltype = 'r'");
    expect(migration).toMatch(/IF restrict_fk_count != 1 THEN/);
    expect(migration).toMatch(/RAISE EXCEPTION/);
  });
});
