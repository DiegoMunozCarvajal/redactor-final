import { describe, expect, it } from "vitest";

import {
  getActivePromptGenerationByPromptId,
  getActiveGeneration,
  isInFlightGeneration,
} from "@/lib/generation-status";

describe("generation status helpers", () => {
  const now = new Date("2026-05-30T12:00:00.000Z").getTime();

  it("treats assembling generations as active", () => {
    expect(
      isInFlightGeneration(
        {
          id: "assembly-1",
          status: "assembling",
          createdAt: "2026-05-30T11:59:00.000Z",
        },
        now,
      ),
    ).toBe(true);
  });

  it("returns the newest fresh in-flight generation", () => {
    const active = getActiveGeneration(
      [
        {
          id: "old-failed",
          status: "failed",
          createdAt: "2026-05-30T11:58:00.000Z",
        },
        {
          id: "current-assembly",
          status: "assembling",
          createdAt: "2026-05-30T11:59:00.000Z",
        },
        {
          id: "stale-generating",
          status: "generating",
          createdAt: "2026-05-30T11:00:00.000Z",
        },
      ],
      now,
    );

    expect(active?.id).toBe("current-assembly");
  });

  it("maps active prompt generation by prompt id", () => {
    const activeByPrompt = getActivePromptGenerationByPromptId(
      [
        {
          id: "prompt-generation",
          status: "generating",
          createdAt: "2026-05-30T11:59:00.000Z",
          generationMetadata: {
            type: "prompt",
            promptId: "prompt-1",
            promptTitle: "Opening hook",
          },
        },
      ],
      now,
    );

    expect(activeByPrompt.get("prompt-1")?.id).toBe("prompt-generation");
  });
});
