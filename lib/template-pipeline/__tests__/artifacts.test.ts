import { describe, expect, it } from "vitest";
import type { SaveArtifactInput } from "../artifacts";
import { COMPILER_VERSION, COMPILER_HASH } from "../compiler";

describe("artifact types", () => {
  it("SaveArtifactInput requires core fields", () => {
    const valid: SaveArtifactInput = {
      pipelineRunId: "run-1",
      chapterId: "ch-1",
      traceIr: { moves: [{ position: 0, recipeId: "opening_case", resourceClass: "case", discourseRelation: "open", readerEffect: "curiosity", dependencies: [] }] },
      compiledTemplate: [{ name: "test", content: "content", userPrompt: "prompt", placeholders: [] }],
      artifactHash: "abc123",
    };
    expect(valid.pipelineRunId).toBe("run-1");
    expect(valid.traceIr.moves).toHaveLength(1);
  });

  it("COMPILER_VERSION and COMPILER_HASH are exported", () => {
    expect(COMPILER_VERSION).toBe("template-compiler-v1");
    expect(COMPILER_HASH).toMatch(/^[a-f0-9]{64}$/);
  });
});
