import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20260712000000_dedup_placeholder_case_variants.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("placeholder case deduplication migration", () => {
  it("carries the winning row fill_metadata into the canonical upsert", () => {
    expect(migration).toMatch(
      /\(array_agg\(definition ORDER BY \(name = lower\(name\) AND definition IS NOT NULL\) DESC, \(definition IS NOT NULL\) DESC, \(name = lower\(name\)\) DESC, ctid\)\)\[1\] AS best_definition/,
    );
    expect(migration).toMatch(
      /\(array_agg\(fill_metadata ORDER BY \(name = lower\(name\) AND definition IS NOT NULL\) DESC, \(definition IS NOT NULL\) DESC, \(name = lower\(name\)\) DESC, ctid\)\)\[1\] AS best_fill_metadata/,
    );
    expect(migration).toContain(
      'INSERT INTO chapter_placeholders (chapter_id, name, definition, "function", notes, fill_metadata)',
    );
    expect(migration).toContain("rec.best_fill_metadata");
    expect(migration).toContain(
      "fill_metadata = coalesce(excluded.fill_metadata, chapter_placeholders.fill_metadata)",
    );
  });
});
