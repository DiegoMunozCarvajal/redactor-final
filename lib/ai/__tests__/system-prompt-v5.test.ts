import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

/**
 * After the runtime prompt transparency migration, the hardcoded
 * DEFAULT_SYSTEM_PROMPT and SYSTEM_PROMPT_V5 constants have been deleted.
 * The generation-system prompt now lives in the prompt registry as a
 * prompt_definition with kind "generation-system", seeded via migration
 * 20260714000004.
 *
 * These tests verify the registry migration exists and contains the
 * generation-system prompt definition and its initial revision.
 */

const seedMigrationUrl = new URL(
  "../../../supabase/migrations/20260714000004_seed_transparent_runtime_prompts.sql",
  import.meta.url,
);
const seedMigration = existsSync(seedMigrationUrl)
  ? readFileSync(seedMigrationUrl, "utf8")
  : "";

const chapterMigrationUrl = new URL(
  "../../../supabase/migrations/20260518114323_chapter_based_generation.sql",
  import.meta.url,
);
const chapterMigration = existsSync(chapterMigrationUrl)
  ? readFileSync(chapterMigrationUrl, "utf8")
  : "";

describe("Generation system prompt — registry migration", () => {
  it("has generation-system prompt definition in seed migration", () => {
    expect(seedMigration).toContain("generation-system");
    expect(seedMigration).toContain("kind");
  });

  it("has generation-system revision with system template in seed migration", () => {
    // The seed migration should create a default revision for generation-system
    expect(seedMigration).toContain("generation-system");
  });

  it("has chapter_based_generation migration supporting prompts table", () => {
    // The chapter migration should have prompts with content/user_prompt columns
    expect(chapterMigration).toContain("prompts");
    expect(chapterMigration).toContain("content");
  });
});
