import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readMigration = (name: string) =>
  readFileSync(
    new URL(`../../supabase/migrations/${name}`, import.meta.url),
    "utf8",
  );

const base = readMigration("20260713000000_add_editorial_briefs.sql");
const fix = readMigration("20260713000001_fix_editorial_briefs_fks.sql");
const secure = readMigration("20260714000000_secure_editorial_briefs.sql");

describe("pending migration hardening", () => {
  it("enables RLS in the same migration that creates editorial tables", () => {
    for (const table of [
      "editorial_briefs",
      "chapter_editorial_contracts",
      "editorial_brief_sources",
    ]) {
      expect(base).toMatch(
        new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`, "i"),
      );
    }
  });

  it("uses canonical Drizzle constraint names", () => {
    for (const name of [
      "chk_editorial_briefs_version",
      "chk_editorial_briefs_content_hash",
      "uq_editorial_briefs_project_version",
      "chk_contracts_content_hash",
      "uq_chapter_editorial_contracts_brief_chapter",
      "uq_editorial_brief_sources_brief_source",
    ]) {
      expect(base).toContain(`CONSTRAINT ${name}`);
    }
  });

  it("reconciles legacy automatic constraint names", () => {
    for (const legacy of [
      "editorial_briefs_version_check",
      "editorial_briefs_content_hash_check",
      "chapter_editorial_contracts_content_hash_check",
      "chapter_editorial_contracts_editorial_brief_id_chapter_id_key",
      "editorial_brief_sources_editorial_brief_id_source_id_key",
    ]) {
      expect(fix).toContain(legacy);
    }
  });

  it("protects source documents and chunks with owner-scoped RLS", () => {
    for (const table of ["sources", "source_chunks"]) {
      expect(secure).toMatch(
        new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`, "i"),
      );
      expect(secure).toMatch(
        new RegExp(`CREATE POLICY ${table}_owner_select ON ${table}`, "i"),
      );
    }
    expect(secure.match(/project_id\s+IN\s*\(/gi)).toHaveLength(2);
  });

  it("uses least privilege grants for public API roles", () => {
    expect(secure).toMatch(/REVOKE ALL[\s\S]+FROM anon/i);
    expect(secure).toMatch(
      /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER[\s\S]+FROM authenticated/i,
    );
    expect(secure).toMatch(/GRANT SELECT[\s\S]+TO authenticated/i);
  });

  it("caches auth.uid once per statement", () => {
    expect(secure).not.toMatch(/=\s*auth\.uid\(\)/i);
    expect(secure.match(/\(select auth\.uid\(\)\)/gi)?.length).toBeGreaterThanOrEqual(
      5,
    );
  });
});
