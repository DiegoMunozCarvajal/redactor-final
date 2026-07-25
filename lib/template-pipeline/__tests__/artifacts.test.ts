import { describe, expect, it } from "vitest";
import type { ArtifactIdentity } from "../artifacts";

describe("artifact types", () => {
  it("ArtifactIdentity requires all fields", () => {
    const valid: ArtifactIdentity = {
      pipelineRunId: "run-1",
      chapterId: "ch-1",
      sourceHash: "abc123",
      rhetoricRevisionId: "rev-1",
      compilerHash: "comp-hash",
    };
    expect(valid.pipelineRunId).toBe("run-1");
  });
});
