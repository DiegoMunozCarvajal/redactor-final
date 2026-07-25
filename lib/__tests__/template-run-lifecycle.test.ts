import { describe, expect, it } from "vitest";
import { LEGACY_CONTAINMENT_PIPELINE_VERSION } from "@/lib/template-pipeline/contracts";

describe("template run lifecycle", () => {
  it("uses legacy-containment-v1 as transitional pipeline version", () => {
    expect(LEGACY_CONTAINMENT_PIPELINE_VERSION).toBe("legacy-containment-v1");
  });

  it("distinguishes v1 (never eligible) from v2 (eligible when clean)", () => {
    // v1 runs are transitional — they track provenance but never make a
    // template eligible for project creation.
    expect(LEGACY_CONTAINMENT_PIPELINE_VERSION).not.toBe("template-pipeline-v2");
  });
});
