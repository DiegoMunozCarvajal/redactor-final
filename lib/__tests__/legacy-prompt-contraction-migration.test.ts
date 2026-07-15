import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../../supabase/migrations/20260714000007_contract_legacy_prompt_storage.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("legacy prompt contraction migration", () => {
  it("freezes every legacy source with a content hash before dropping", () => {
    for (const source of [
      "generation_system_prompts",
      "meta_prompts",
      "prompt_library",
    ]) {
      expect(sql).toContain(`'legacySource', '${source}'`);
      expect(sql).toContain(`FROM ${source}`);
    }
    expect(sql).toContain("'legacySourceHash'");
    expect(sql).toContain("'legacyNonExecutable', true");
  });

  it("gates generation-system parity by imported definition", () => {
    expect(sql).toContain("ppb.kind = 'generation-system'");
    expect(sql).toContain("md5('definition:generation_system_prompts:'");
    expect(sql).toContain("generation-system binding parity failed");
  });

  it("requires executable planner and assembler defaults", () => {
    expect(sql).toContain("IN ('assembly-planner', 'assembly')");
    expect(sql).toContain("assembly defaults parity failed");
  });

  it("drops project columns before referenced tables without cascade", () => {
    const assemblyColumn = sql.indexOf("DROP COLUMN IF EXISTS assembly_prompt_id");
    const libraryTable = sql.indexOf("DROP TABLE IF EXISTS prompt_library");
    expect(assemblyColumn).toBeGreaterThan(-1);
    expect(libraryTable).toBeGreaterThan(assemblyColumn);
    expect(sql).not.toMatch(/DROP TABLE[^;]+CASCADE/i);
  });
});
