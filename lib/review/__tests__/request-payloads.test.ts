import { describe, expect, it } from "vitest";
import { buildCorrectionRequestBody, buildCritiqueRequestBody } from "@/lib/review/request-payloads";

describe("review request payloads", () => {
  it("builds critique payload with exact revision ID", () => {
    expect(buildCritiqueRequestBody("critique-rev", "gpt-5.5")).toEqual({
      critiquePromptRevisionId: "critique-rev",
      model: "gpt-5.5",
    });
  });

  it("builds correction payload with exact revision and critique IDs", () => {
    expect(buildCorrectionRequestBody("corrector-rev", "critique-gen", "gpt-5.5")).toEqual({
      correctorPromptRevisionId: "corrector-rev",
      critiqueGenerationId: "critique-gen",
      model: "gpt-5.5",
    });
  });
});
