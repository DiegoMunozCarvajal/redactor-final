import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
  executeVersionedPrompt: vi.fn(),
  finalizeTemplateRun: vi.fn(),
  buildSourceProfile: vi.fn(),
}));

vi.mock("@trigger.dev/sdk", () => ({
  task: (config: unknown) => config,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: (...args: unknown[]) => mocks.select(...args),
    update: (...args: unknown[]) => mocks.update(...args),
  },
}));

vi.mock("@/lib/prompts/executor", () => ({
  executeVersionedPrompt: (...args: unknown[]) => mocks.executeVersionedPrompt(...args),
}));

vi.mock("@/lib/ai/providers", () => ({
  DEFAULT_GENERATION_MODEL: "test-model",
}));

vi.mock("@/lib/ai/originality-check", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/originality-check")>("@/lib/ai/originality-check");
  return {
    ...actual,
  };
});

vi.mock("@/lib/template-pipeline/source-profile", () => ({
  buildSourceProfile: (...args: unknown[]) => mocks.buildSourceProfile(...args),
}));

vi.mock("@/lib/template-pipeline/artifacts", () => ({
  saveRunArtifact: vi.fn().mockResolvedValue({ id: "art-1" }),
  finalizeTemplateRun: (...args: unknown[]) => mocks.finalizeTemplateRun(...args),
}));

import { generateTemplate } from "@/trigger/generate-template";

type GenerateTemplateRunner = {
  run: (payload: {
    templateId: string;
    pipelineRunId: string;
    rhetoricTraceRevisionId: string;
    sourceProfilerRevisionId: string;
    chapters: Array<{
      chapterId: string;
      title: string;
      contentMd: string;
      position: number;
    }>;
    model?: string;
  }) => Promise<void>;
};

function selectResult<T>(rows: T[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
      }),
    }),
  };
}

describe("generateTemplate (v2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.select.mockReturnValueOnce(
      selectResult([{ status: "generating" }]),
    );

    mocks.update.mockImplementation(() => ({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }));

    mocks.finalizeTemplateRun.mockResolvedValue(undefined);

    // Mock source profile
    mocks.buildSourceProfile.mockResolvedValue({
      sourceHash: "abc123",
      sourceLanguage: "es",
      profileVersion: "source-profile-v1",
      profileHash: "profile-hash",
      chunks: [
        {
          chunkIndex: 0,
          contentHash: "chunk-hash",
          lexicalFingerprint: {
            shingles5: ["a".repeat(64)],
            shingles8: ["b".repeat(64)],
          },
          embedding: Array(1536).fill(0),
          tokenCount: 10,
        },
      ],
      elements: [],
    });

    // Mock rhetoric trace (returns valid v2 TraceIr)
    mocks.executeVersionedPrompt.mockResolvedValue({
      result: {
        data: {
          moves: [
            {
              position: 0,
              recipeId: "opening_case",
              resourceClass: "case",
              discourseRelation: "open",
              readerEffect: "curiosity",
              dependencies: [],
            },
          ],
        },
        usage: {
          promptTokens: 1,
          completionTokens: 1,
          totalTokens: 2,
          costUsd: 0.001,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
        },
      },
      executionId: "exec-rt",
      revision: {
        id: "rev-rt-1",
        definitionId: "def-rt-1",
        kind: "rhetoric-trace",
        name: "Rhetoric Trace v2",
        revisionNumber: 1,
        versionLabel: "2.0",
        systemTemplate: "",
        userTemplate: "",
        requiredMarkers: ["{{CAPITULO_FUENTE}}", "{{OUTPUT_SCHEMA}}"],
        outputContract: "trace-ir-v2",
        configuration: { pipelineContract: "trace-ir-v2" },
      },
    });
  });

  it("calls executeVersionedPrompt with kind rhetoric-trace and redaction", async () => {
    await (generateTemplate as unknown as GenerateTemplateRunner).run({
      templateId: "template-1",
      pipelineRunId: "run-1",
      rhetoricTraceRevisionId: "rev-rt-1",
      sourceProfilerRevisionId: "rev-prof-1",
      chapters: [
        {
          chapterId: "chapter-1",
          title: "Título",
          contentMd: "Texto fuente",
          position: 0,
        },
      ],
      model: "test-model",
    });

    expect(mocks.executeVersionedPrompt).toHaveBeenCalled();
    const callArg = mocks.executeVersionedPrompt.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.kind).toBe("rhetoric-trace");
    expect(callArg.stage).toBe("template-generation");
    expect((callArg.messagePersistence as Record<string, unknown>)?.mode).toBe("redact-sensitive-markers");
  });

  it("does NOT call template-generator kind", async () => {
    await (generateTemplate as unknown as GenerateTemplateRunner).run({
      templateId: "template-1",
      pipelineRunId: "run-1",
      rhetoricTraceRevisionId: "rev-rt-1",
      sourceProfilerRevisionId: "rev-prof-1",
      chapters: [
        {
          chapterId: "chapter-1",
          title: "Título",
          contentMd: "Texto fuente",
          position: 0,
        },
      ],
      model: "test-model",
    });

    for (const call of mocks.executeVersionedPrompt.mock.calls) {
      const arg = call[0] as Record<string, unknown>;
      expect(arg.kind).not.toBe("template-generator");
    }
  });

  it("calls finalizeTemplateRun on success", async () => {
    await (generateTemplate as unknown as GenerateTemplateRunner).run({
      templateId: "template-1",
      pipelineRunId: "run-1",
      rhetoricTraceRevisionId: "rev-rt-1",
      sourceProfilerRevisionId: "rev-prof-1",
      chapters: [
        {
          chapterId: "chapter-1",
          title: "Título",
          contentMd: "Texto fuente",
          position: 0,
        },
      ],
      model: "test-model",
    });

    expect(mocks.finalizeTemplateRun).toHaveBeenCalledWith("run-1");
  });

  it("calls buildSourceProfile for each chapter", async () => {
    await (generateTemplate as unknown as GenerateTemplateRunner).run({
      templateId: "template-1",
      pipelineRunId: "run-1",
      rhetoricTraceRevisionId: "rev-rt-1",
      sourceProfilerRevisionId: "rev-prof-1",
      chapters: [
        {
          chapterId: "chapter-1",
          title: "Ch 1",
          contentMd: "Texto 1",
          position: 0,
        },
        {
          chapterId: "chapter-2",
          title: "Ch 2",
          contentMd: "Texto 2",
          position: 1,
        },
      ],
      model: "test-model",
    });

    expect(mocks.buildSourceProfile).toHaveBeenCalledTimes(2);
  });

  it("returns early on already-ready template", async () => {
    mocks.select.mockReset();
    mocks.select.mockReturnValueOnce(
      selectResult([{ status: "ready" }]),
    );

    await (generateTemplate as unknown as GenerateTemplateRunner).run({
      templateId: "template-1",
      pipelineRunId: "run-1",
      rhetoricTraceRevisionId: "rev-rt-1",
      sourceProfilerRevisionId: "rev-prof-1",
      chapters: [
        {
          chapterId: "chapter-1",
          title: "Título",
          contentMd: "Texto fuente",
          position: 0,
        },
      ],
      model: "test-model",
    });

    // Should not call any downstream services
    expect(mocks.executeVersionedPrompt).not.toHaveBeenCalled();
    expect(mocks.buildSourceProfile).not.toHaveBeenCalled();
  });
});
