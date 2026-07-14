import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecute = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(),
);

vi.mock("@/lib/prompts/executor", () => ({
  executeVersionedPrompt: mockExecute,
}));

import { generateTitle } from "../generate";

function makeMockResult(overrides?: {
  title?: string;
  subtitle?: string;
  executionId?: string;
  revisionId?: string;
}) {
  return {
    result: {
      data: {
        title: overrides?.title ?? "Titulo del libro",
        subtitle: overrides && "subtitle" in overrides ? overrides.subtitle : "Subtitulo del libro",
      },
      usage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        costUsd: 0.002,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      },
      durationMs: 500,
    },
    executionId: overrides?.executionId ?? "exec-title-1",
    revision: {
      id: overrides?.revisionId ?? "rev-title-1",
      definitionId: "def-title-1",
      kind: "title",
      name: "Title v1",
      revisionNumber: 1,
      versionLabel: "v1.0",
      systemTemplate: "",
      userTemplate: "",
      requiredMarkers: [
        "{{EDITORIAL_CONTEXT}}",
        "{{PROJECT_TOPIC}}",
        "{{OUTPUT_SCHEMA}}",
      ],
      outputContract: null,
      configuration: {},
    },
  };
}

const defaultInput = {
  projectId: "proj-1",
  editorialContext:
    "<editorial_context><market>...</market></editorial_context>",
  projectTopic: "Habitos Atomicos",
};

beforeEach(() => {
  mockExecute.mockClear();
});

describe("generateTitle", () => {
  it('calls executeVersionedPrompt with kind "title"', async () => {
    mockExecute.mockResolvedValue(makeMockResult());
    await generateTitle(defaultInput);

    const callArg = mockExecute.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.kind).toBe("title");
  });

  it("passes exact markers: EDITORIAL_CONTEXT, PROJECT_TOPIC, OUTPUT_SCHEMA", async () => {
    mockExecute.mockResolvedValue(makeMockResult());
    await generateTitle(defaultInput);

    const callArg = mockExecute.mock.calls[0][0] as Record<string, unknown>;
    const markerValues = callArg.markerValues as Record<string, string>;
    expect(markerValues["{{EDITORIAL_CONTEXT}}"]).toBe(
      defaultInput.editorialContext,
    );
    expect(markerValues["{{PROJECT_TOPIC}}"]).toBe(defaultInput.projectTopic);
    expect(markerValues["{{OUTPUT_SCHEMA}}"]).toBeTruthy();
  });

  it('passes stage "title"', async () => {
    mockExecute.mockResolvedValue(makeMockResult());
    await generateTitle(defaultInput);

    const callArg = mockExecute.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.stage).toBe("title");
  });

  it("passes title schema", async () => {
    mockExecute.mockResolvedValue(makeMockResult());
    await generateTitle(defaultInput);

    const callArg = mockExecute.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.schema).toBeDefined();
  });

  it("returns title, subtitle, executionId, and revisionId", async () => {
    mockExecute.mockResolvedValue(
      makeMockResult({
        title: "Mi Libro",
        subtitle: "Un Subtitulo",
        executionId: "exec-id",
        revisionId: "rev-id",
      }),
    );

    const result = await generateTitle(defaultInput);
    expect(result.title).toBe("Mi Libro");
    expect(result.subtitle).toBe("Un Subtitulo");
    expect(result.executionId).toBe("exec-id");
    expect(result.revisionId).toBe("rev-id");
  });

  it("defaults subtitle to empty string when missing", async () => {
    mockExecute.mockResolvedValue(
      makeMockResult({ title: "Solo Titulo", subtitle: undefined }),
    );

    const result = await generateTitle(defaultInput);
    expect(result.title).toBe("Solo Titulo");
    expect(result.subtitle).toBe("");
  });

  it("passes model when provided", async () => {
    mockExecute.mockResolvedValue(makeMockResult());
    await generateTitle({ ...defaultInput, model: "gpt-5.5" });

    const callArg = mockExecute.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.model).toBe("gpt-5.5");
  });

  it("defaults to DEFAULT_GENERATION_MODEL when model not provided", async () => {
    mockExecute.mockResolvedValue(makeMockResult());
    // Import DEFAULT_GENERATION_MODEL to verify it matches
    const { DEFAULT_GENERATION_MODEL } = await import("@/lib/ai/providers");
    await generateTitle(defaultInput);

    const callArg = mockExecute.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.model).toBe(DEFAULT_GENERATION_MODEL);
  });
});
