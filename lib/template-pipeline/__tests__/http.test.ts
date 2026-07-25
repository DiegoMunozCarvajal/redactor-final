import { describe, expect, it } from "vitest";
import { GenerationBlockedError } from "../contracts";
import { generationBlockedResponse } from "../http";

describe("generationBlockedResponse", () => {
  it.each([
    "template_unverified",
    "template_quarantined",
    "template_failed",
    "missing_source_profile",
    "unsupported_pipeline",
    "unsupported_policy",
  ] as const)("maps %s to 409 JSON", async (reason) => {
    const error = new GenerationBlockedError(reason, "project-1");
    const response = generationBlockedResponse(error);
    expect(response).not.toBeNull();
    expect(response!.status).toBe(409);
    const body = await response!.json();
    expect(body).toEqual({ error: "generation blocked", code: reason });
  });

  it("returns null for non-GenerationBlockedError", () => {
    expect(generationBlockedResponse(new Error("boom"))).toBeNull();
    expect(generationBlockedResponse("string")).toBeNull();
    expect(generationBlockedResponse(null)).toBeNull();
  });
});
