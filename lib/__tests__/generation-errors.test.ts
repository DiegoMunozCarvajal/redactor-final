import { describe, expect, it } from "vitest";

import { getLatestGenerationError } from "@/lib/generation-errors";

describe("getLatestGenerationError", () => {
  it("hides old failure after newer successful generation", () => {
    const error = getLatestGenerationError([
      {
        status: "failed",
        error: "401 Authentication Fails, Your api key: ****7431 is invalid",
        createdAt: "2026-05-30T10:00:00.000Z",
      },
      {
        status: "completed",
        error: null,
        createdAt: "2026-05-30T10:05:00.000Z",
      },
    ]);

    expect(error).toBeNull();
  });

  it("shows latest failed generation error", () => {
    const error = getLatestGenerationError([
      {
        status: "completed",
        error: null,
        createdAt: "2026-05-30T10:00:00.000Z",
      },
      {
        status: "failed",
        error: "Generation failed",
        createdAt: "2026-05-30T10:05:00.000Z",
      },
    ]);

    expect(error).toBe("Generation failed");
  });
});
