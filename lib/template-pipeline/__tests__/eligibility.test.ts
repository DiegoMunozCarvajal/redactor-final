import { describe, expect, it } from "vitest";
import { isTemplateEligible } from "../eligibility";

function cleanV2Template(overrides: Partial<{
  templateStatus: string;
  activeRunId: string | null;
  runStatus: string | null;
  pipelineVersion: string | null;
  originalityPolicyVersion: string | null;
}> = {}) {
  return {
    templateStatus: "ready",
    activeRunId: "run-1",
    runStatus: "clean",
    pipelineVersion: "template-pipeline-v2",
    originalityPolicyVersion: "originality-policy-v2",
    ...overrides,
  };
}

describe("isTemplateEligible", () => {
  it("allows only ready templates with one supported clean active run", () => {
    expect(isTemplateEligible(cleanV2Template())).toBe(true);
    expect(isTemplateEligible(cleanV2Template({ activeRunId: null }))).toBe(
      false,
    );
    expect(
      isTemplateEligible(cleanV2Template({ runStatus: "quarantined" })),
    ).toBe(false);
    expect(
      isTemplateEligible(
        cleanV2Template({ pipelineVersion: "legacy-containment-v1" }),
      ),
    ).toBe(false);
  });

  it("rejects templates that are not ready", () => {
    expect(
      isTemplateEligible(cleanV2Template({ templateStatus: "generating" })),
    ).toBe(false);
    expect(
      isTemplateEligible(cleanV2Template({ templateStatus: "failed" })),
    ).toBe(false);
    expect(
      isTemplateEligible(cleanV2Template({ templateStatus: "quarantined" })),
    ).toBe(false);
  });

  it("rejects unsupported policy version", () => {
    expect(
      isTemplateEligible(
        cleanV2Template({ originalityPolicyVersion: "old-policy" }),
      ),
    ).toBe(false);
  });
});
