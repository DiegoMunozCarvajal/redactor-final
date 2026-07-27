import { describe, expect, it, vi } from "vitest";
import { EMPTY_SOURCE_PROFILE_SET_HASH } from "../hash";

// ---------------------------------------------------------------------------
// We test assertTemplateGenerationAllowed by mocking its dependency —
// loadProjectPipeline — rather than the DB.
// ---------------------------------------------------------------------------

const mockLoadProjectPipeline = vi.fn();

vi.mock("../repository", () => ({
  loadProjectPipeline: mockLoadProjectPipeline,
}));

// Dynamic import after mock registration — vitest hoists vi.mock above imports.
const { assertTemplateGenerationAllowed } =
  await import("../authorization");

function fixtureTemplatePipeline(overrides: Record<string, unknown> = {}) {
  return {
    projectId: "project-1",
    bookTemplateId: "tpl-1",
    templateStatus: "ready",
    run: {
      id: "run-1",
      status: "clean",
      pipelineVersion: "template-pipeline-v2",
      originalityPolicyVersion: "originality-policy-v2",
    },
    profiles: [
      {
        id: "profile-1",
        chapterId: "ch-1",
        sourceHash: "abc123",
      },
    ],
    ...overrides,
  };
}

describe("assertTemplateGenerationAllowed", () => {
  it("allows a project without template as source-free", async () => {
    mockLoadProjectPipeline.mockResolvedValue({
      projectId: "project-1",
      bookTemplateId: null,
    });
    await expect(
      assertTemplateGenerationAllowed("project-1"),
    ).resolves.toEqual({
      scope: "source-free",
      pipelineRunId: null,
      sourceProfileSetHash: EMPTY_SOURCE_PROFILE_SET_HASH,
      originalityPolicyVersion: "originality-policy-v2",
    });
  });

  it.each([
    ["quarantined", "template_quarantined"],
    ["failed", "template_failed"],
  ])("blocks %s templates", async (status, reason) => {
    mockLoadProjectPipeline.mockResolvedValue(
      fixtureTemplatePipeline({ templateStatus: status }),
    );
    await expect(
      assertTemplateGenerationAllowed("project-1"),
    ).rejects.toMatchObject({ name: "GenerationBlockedError", reason });
  });

  it("returns degraded authorization when clean run has no profiles (legacy)", async () => {
    mockLoadProjectPipeline.mockResolvedValue(
      fixtureTemplatePipeline({ profiles: [] }),
    );
    await expect(
      assertTemplateGenerationAllowed("project-1"),
    ).resolves.toEqual({
      scope: "template",
      pipelineRunId: "run-1",
      sourceProfileSetHash: EMPTY_SOURCE_PROFILE_SET_HASH,
      originalityPolicyVersion: "originality-policy-v2",
    });
  });

  it("blocks when profiles are missing and run is not clean", async () => {
    mockLoadProjectPipeline.mockResolvedValue(
      fixtureTemplatePipeline({
        profiles: [],
        run: {
          id: "run-2",
          status: "running",
          pipelineVersion: "template-pipeline-v2",
          originalityPolicyVersion: "originality-policy-v2",
        },
      }),
    );
    await expect(
      assertTemplateGenerationAllowed("project-2"),
    ).rejects.toMatchObject({ reason: "template_unverified" });
  });

  it("blocks when no active run exists", async () => {
    mockLoadProjectPipeline.mockResolvedValue(
      fixtureTemplatePipeline({ run: null }),
    );
    await expect(
      assertTemplateGenerationAllowed("project-1"),
    ).rejects.toMatchObject({ reason: "template_unverified" });
  });

  it("blocks when run is not clean", async () => {
    mockLoadProjectPipeline.mockResolvedValue(
      fixtureTemplatePipeline({
        run: {
          id: "run-1",
          status: "running",
          pipelineVersion: "template-pipeline-v2",
          originalityPolicyVersion: "originality-policy-v2",
        },
      }),
    );
    await expect(
      assertTemplateGenerationAllowed("project-1"),
    ).rejects.toMatchObject({ reason: "template_unverified" });
  });

  it("blocks unsupported pipeline version", async () => {
    mockLoadProjectPipeline.mockResolvedValue(
      fixtureTemplatePipeline({
        run: {
          id: "run-1",
          status: "clean",
          pipelineVersion: "legacy-containment-v1",
          originalityPolicyVersion: "originality-policy-v2",
        },
      }),
    );
    await expect(
      assertTemplateGenerationAllowed("project-1"),
    ).rejects.toMatchObject({ reason: "unsupported_pipeline" });
  });

  it("blocks unsupported policy version", async () => {
    mockLoadProjectPipeline.mockResolvedValue(
      fixtureTemplatePipeline({
        run: {
          id: "run-1",
          status: "clean",
          pipelineVersion: "template-pipeline-v2",
          originalityPolicyVersion: "old-policy-v1",
        },
      }),
    );
    await expect(
      assertTemplateGenerationAllowed("project-1"),
    ).rejects.toMatchObject({ reason: "unsupported_policy" });
  });

  it("returns authorization for a clean template pipeline", async () => {
    mockLoadProjectPipeline.mockResolvedValue(fixtureTemplatePipeline());
    await expect(
      assertTemplateGenerationAllowed("project-1"),
    ).resolves.toEqual({
      scope: "template",
      pipelineRunId: "run-1",
      sourceProfileSetHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      originalityPolicyVersion: "originality-policy-v2",
    });
  });

  it("throws when project is not found", async () => {
    mockLoadProjectPipeline.mockResolvedValue(null);
    await expect(
      assertTemplateGenerationAllowed("project-1"),
    ).rejects.toThrow("Project not found");
  });
});
