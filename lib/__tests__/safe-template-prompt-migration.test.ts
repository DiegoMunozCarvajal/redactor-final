import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  "supabase/migrations/20260722000001_seed_safe_template_pipeline.sql",
  "utf-8",
);

describe("safe template pipeline migration", () => {
  it("declares the source-risk-profiler kind", () => {
    expect(sql).toContain("'source-risk-profiler'");
  });

  it("declares the trace-ir-v2 pipeline contract", () => {
    expect(sql).toContain("'trace-ir-v2'");
  });

  it("seeds a source profiler revision with sensitive marker", () => {
    expect(sql).toContain("{{CAPITULO_FUENTE}}");
  });

  it("does not reference the old template-generator marker in v2 paths", () => {
    // {{RHETORIC_TRACE}} is the v1 template-generator marker — v2 seed should not use it
    const v2Section = sql.substring(
      sql.indexOf("source-risk-profiler"),
      sql.lastIndexOf("trace-ir-v2") + 20,
    );
    expect(v2Section).not.toContain("{{RHETORIC_TRACE}}");
  });

  it("declares source-profile-v1 pipeline contract", () => {
    expect(sql).toContain("'source-profile-v1'");
  });
});
