import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * After the runtime prompt transparency migration, SYSTEM_PROMPT_V5 has been
 * deleted from code. The generation-system prompt now lives in the prompt
 * registry (seed migration 20260714000004). The old v5 migration
 * (20260714000001) still exists as historical record — this test verifies it
 * is structurally sound and that the newer seed migration supersedes it.
 */

const v5MigrationUrl = new URL(
  "../../supabase/migrations/20260714000001_add_system_prompt_v5.sql",
  import.meta.url,
);
const v5Migration = existsSync(v5MigrationUrl)
  ? readFileSync(v5MigrationUrl, "utf8")
  : "";

const seedMigrationUrl = new URL(
  "../../supabase/migrations/20260714000004_seed_transparent_runtime_prompts.sql",
  import.meta.url,
);
const seedMigration = existsSync(seedMigrationUrl)
  ? readFileSync(seedMigrationUrl, "utf8")
  : "";

describe("System Prompt migration chain", () => {
  it("has the historical v5 migration that switches default", () => {
    const unsetIndex = v5Migration.indexOf(
      "UPDATE generation_system_prompts SET is_default = false",
    );
    const insertIndex = v5Migration.indexOf(
      "INSERT INTO generation_system_prompts",
    );
    expect(unsetIndex).toBeGreaterThanOrEqual(0);
    expect(insertIndex).toBeGreaterThan(unsetIndex);
  });

  it("retains previous prompt rows in v5 migration", () => {
    expect(v5Migration).not.toMatch(/DELETE\s+FROM\s+generation_system_prompts/i);
  });

  it("is superseded by seed migration with generation-system prompt definition", () => {
    // The seed migration creates prompt_definitions + prompt_revisions for
    // generation-system, replacing the old generation_system_prompts table.
    expect(seedMigration).toContain("generation-system");
    expect(seedMigration).toContain("prompt_revisions");
  });
});
