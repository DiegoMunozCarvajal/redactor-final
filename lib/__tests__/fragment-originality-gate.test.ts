// ---------------------------------------------------------------------------
// Fragment Originality Gate Tests
//
// Tests the runOriginalityGate function with fragment-specific callbacks.
// Verifies that fragment generation, evaluation, and persistence work
// correctly under all originality decisions.
//
// Mocks: db (insert, update, transaction), evaluateOriginality,
//        loadOriginalityProfileSet
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from "vitest";
import { sha256Text } from "@/lib/template-pipeline/hash";
import {
  OriginalityContaminationError,
  OriginalityDetectorUnavailableError,
} from "@/lib/originality/contracts";
import type { OriginalitySignal } from "@/lib/originality/contracts";
import type { GenerationAuthorization } from "@/lib/template-pipeline/contracts";

// ---------------------------------------------------------------------------
// Hoisted mock variables
// ---------------------------------------------------------------------------

const {
  mockDbInsert,
  mockDbUpdate,
  mockDbTransaction,
  mockEvaluateOriginality,
  mockLoadProfileSet,
} = vi.hoisted(() => ({
  mockDbInsert: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockDbTransaction: vi.fn(),
  mockEvaluateOriginality: vi.fn(),
  mockLoadProfileSet: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/db", () => ({
  db: {
    insert: mockDbInsert,
    update: mockDbUpdate,
    transaction: mockDbTransaction,
  },
}));

vi.mock("@/lib/originality/evaluate", () => ({
  evaluateOriginality: mockEvaluateOriginality,
}));

vi.mock("@/lib/originality/profile-loader", () => ({
  loadOriginalityProfileSet: mockLoadProfileSet,
}));

// ---------------------------------------------------------------------------
// Import gate under test
// ---------------------------------------------------------------------------

import { runOriginalityGate } from "@/lib/originality/gate";
import type { OriginalityGateInput, GeneratedCandidate } from "@/lib/originality/gate";
import type { GenerateResult } from "@/lib/generate";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GENERIC_FEEDBACK =
  "Use a materially different illustration, argument, and formulation.";

const TEMPLATE_AUTH: GenerationAuthorization = {
  scope: "template",
  pipelineRunId: "frag-run-1",
  sourceProfileSetHash: "source-profile-set-hash",
  originalityPolicyVersion: "originality-policy-v2",
};

const SOURCE_FREE_AUTH: GenerationAuthorization = {
  scope: "source-free",
  pipelineRunId: null,
  sourceProfileSetHash: "source-free-hash",
  originalityPolicyVersion: "originality-policy-v2",
};

const TEST_PROFILE_SET = {
  scope: "template" as const,
  pipelineRunId: "frag-run-1",
  profileSetHash: "profile-set-hash",
  profiles: [],
};

const SOURCE_FREE_PROFILE_SET = {
  scope: "source-free" as const,
  pipelineRunId: null,
  profileSetHash: "sf-profile-hash",
  profiles: [],
};

// ---------------------------------------------------------------------------
// Fragment-specific helpers
// ---------------------------------------------------------------------------

function makeSignal(
  overrides: Partial<OriginalitySignal> = {},
): OriginalitySignal {
  return {
    detector: "hashed_ngram",
    strength: "probabilistic",
    riskElementIds: [],
    fieldPath: "content",
    ...overrides,
  };
}

function makeContext(
  overrides: Partial<OriginalityGateInput<GenerateResult>["context"]> = {},
): OriginalityGateInput<GenerateResult>["context"] {
  return {
    projectId: "proj-frag",
    chapterId: "chap-frag-1",
    chapterGenerationId: "gen-frag-1",
    stage: "fragment",
    fieldPath: "fragment.content",
    authorization: TEMPLATE_AUTH,
    templateArtifactHash: "template-art-hash-frag",
    model: "claude-sonnet-5",
    ...overrides,
  };
}

function makeGenerateResult(
  overrides: Partial<GenerateResult> = {},
): GenerateResult {
  return {
    text: "Generated fragment content for testing",
    model: "claude-sonnet-4-20250514",
    provider: "anthropic",
    durationMs: 1200,
    usage: {
      inputTokens: 200,
      outputTokens: 80,
      costUsd: 0.003,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    },
    executionId: "exec-frag-1",
    promptRevisions: {
      "chapter-content": "prompt-rev-1",
      "generation-system": "sys-rev-1",
    },
    ...overrides,
  };
}

function makeInput(
  overrides: Partial<OriginalityGateInput<GenerateResult>> = {},
): OriginalityGateInput<GenerateResult> {
  return {
    context: makeContext(),
    generate: vi.fn().mockResolvedValue({
      value: makeGenerateResult(),
      text: "Generated fragment content for testing",
      executionId: "exec-frag-1",
      promptRevisions: {
        "chapter-content": "prompt-rev-1",
        "generation-system": "sys-rev-1",
      },
    }),
    persistAccepted: vi
      .fn()
      .mockResolvedValue({ entityType: "fragment", entityId: "frag-entity-1" }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Fragment-specific persistAccepted — simulates the route's callback
// ---------------------------------------------------------------------------

async function fragmentPersistAccepted(
  _tx: unknown,
  candidate: GeneratedCandidate<GenerateResult>,
  assessmentId: string,
  lineage: unknown,
): Promise<{ entityType: string; entityId: string }> {
  const r = candidate.value;

  // Simulate fragment insert verification
  expect(r.text).toBeDefined();
  expect(r.executionId).toBeDefined();
  expect(r.model).toBeDefined();
  expect(r.provider).toBeDefined();
  expect(r.usage).toBeDefined();
  expect(r.promptRevisions).toBeDefined();

  return { entityType: "fragment", entityId: "frag-entity-1" };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("fragment originality gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // 1. Contaminated — no fragment, generation quarantined
  // =========================================================================

  it("contaminated fragment -> no fragments row, generation quarantined", async () => {
    mockLoadProfileSet.mockResolvedValue(TEST_PROFILE_SET);
    mockEvaluateOriginality.mockResolvedValue({
      decision: "contaminated",
      signals: [makeSignal({ detector: "hashed_ngram", strength: "strong" })],
    });

    // Non-tx insert (saveAssessment)
    const mockInsertValues = vi.fn().mockResolvedValue(undefined);
    mockDbInsert.mockReturnValue({ values: mockInsertValues });

    // Non-tx update (quarantineGeneration)
    const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
    const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }));
    mockDbUpdate.mockReturnValue({ set: mockUpdateSet });

    const mockPersistAccepted = vi.fn();

    const input = makeInput({ persistAccepted: mockPersistAccepted });

    // Execute & assert throw
    await expect(runOriginalityGate(input)).rejects.toMatchObject({
      name: "OriginalityContaminationError",
      decision: "contaminated",
    });

    // Generate once, no retry
    expect(input.generate).toHaveBeenCalledTimes(1);
    expect(input.generate).toHaveBeenCalledWith({});

    // Evaluate once
    expect(mockEvaluateOriginality).toHaveBeenCalledTimes(1);

    // Assessment saved (non-transactional)
    expect(mockDbInsert).toHaveBeenCalledTimes(1);
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: "contaminated",
        candidateHash: sha256Text("Generated fragment content for testing"),
        projectId: "proj-frag",
        stage: "fragment",
      }),
    );

    // Generation quarantined
    expect(mockUpdateSet).toHaveBeenCalledWith({ status: "quarantined" });

    // No transaction — persistAccepted NOT called (no fragment inserted)
    expect(mockDbTransaction).not.toHaveBeenCalled();
    expect(mockPersistAccepted).not.toHaveBeenCalled();
  });

  // =========================================================================
  // 2. Suspect -> Clean — exactly 2 executor calls, fragment created
  // =========================================================================

  it("suspect -> clean after retry -> exactly 2 executor calls, fragment created", async () => {
    mockLoadProfileSet.mockResolvedValue(TEST_PROFILE_SET);
    mockEvaluateOriginality
      .mockResolvedValueOnce({
        decision: "suspect",
        signals: [
          makeSignal({
            detector: "source_chunk_embedding",
            score: 0.88,
            threshold: 0.88,
          }),
        ],
      })
      .mockResolvedValueOnce({ decision: "clean", signals: [] });

    // Non-tx insert (saveAssessment for first suspect)
    const mockInsertValues = vi.fn().mockResolvedValue(undefined);
    mockDbInsert.mockReturnValue({ values: mockInsertValues });

    // Tx (persistClean)
    const mockTxReturning = vi
      .fn()
      .mockResolvedValue([{ id: "assessment-frag-1" }]);
    const mockTxValues = vi.fn(() => ({ returning: mockTxReturning }));
    const mockTxInsert = vi.fn(() => ({ values: mockTxValues }));
    const mockTxUpdateWhere = vi.fn().mockResolvedValue(undefined);
    const mockTxUpdateSet = vi.fn(() => ({ where: mockTxUpdateWhere }));
    const mockTxUpdate = vi.fn(() => ({ set: mockTxUpdateSet }));
    mockDbTransaction.mockImplementation(async (cb: any) =>
      cb({
        insert: mockTxInsert,
        update: mockTxUpdate,
      }),
    );

    // Generate returns different content on each call
    const firstResult = makeGenerateResult({
      text: "First suspect content",
      executionId: "exec-suspect-1",
      usage: { inputTokens: 200, outputTokens: 80, costUsd: 0.003, cacheCreationTokens: 0, cacheReadTokens: 0 },
    });
    const secondResult = makeGenerateResult({
      text: "Clean content after retry",
      executionId: "exec-clean-2",
      promptRevisions: {
        "chapter-content": "prompt-rev-1",
        "generation-system": "sys-rev-2",
      },
      usage: { inputTokens: 200, outputTokens: 80, costUsd: 0.003, cacheCreationTokens: 0, cacheReadTokens: 0 },
    });

    const mockGenerate = vi
      .fn()
      .mockResolvedValueOnce({
        value: firstResult,
        text: "First suspect content",
        executionId: "exec-suspect-1",
        promptRevisions: {
          "chapter-content": "prompt-rev-1",
          "generation-system": "sys-rev-1",
        },
      })
      .mockResolvedValueOnce({
        value: secondResult,
        text: "Clean content after retry",
        executionId: "exec-clean-2",
        promptRevisions: {
          "chapter-content": "prompt-rev-1",
          "generation-system": "sys-rev-2",
        },
      });

    const input = makeInput({
      generate: mockGenerate,
      persistAccepted: fragmentPersistAccepted,
    });

    // Execute
    const result = await runOriginalityGate(input);

    // Two generate calls: first with no feedback, second with generic feedback
    expect(mockGenerate).toHaveBeenCalledTimes(2);
    expect(mockGenerate.mock.calls[0][0]).toEqual({});
    expect(mockGenerate.mock.calls[1][0]).toEqual({
      feedback: GENERIC_FEEDBACK,
    });

    // Two evaluate calls
    expect(mockEvaluateOriginality).toHaveBeenCalledTimes(2);

    // First suspect assessment saved (non-tx)
    expect(mockDbInsert).toHaveBeenCalledTimes(1);
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "suspect" }),
    );

    // Transaction for persistClean
    expect(mockDbTransaction).toHaveBeenCalledTimes(1);
    expect(mockTxInsert).toHaveBeenCalled();
    expect(mockTxValues).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "clean" }),
    );

    // Verify fragment was created — persistAccepted receives second candidate
    expect(result.value).toBe(secondResult);
    expect(result.assessmentId).toBe("assessment-frag-1");
    expect(result.lineage).toBeDefined();
    expect(result.lineage.scope).toBe("template");
  });

  // =========================================================================
  // 3. Suspect -> Suspect — no fragment, generation quarantined
  // =========================================================================

  it("suspect twice -> no fragment, generation quarantined", async () => {
    mockLoadProfileSet.mockResolvedValue(TEST_PROFILE_SET);
    mockEvaluateOriginality
      .mockResolvedValueOnce({
        decision: "suspect",
        signals: [
          makeSignal({
            detector: "source_chunk_embedding",
            score: 0.88,
            threshold: 0.88,
          }),
        ],
      })
      .mockResolvedValueOnce({
        decision: "suspect",
        signals: [
          makeSignal({
            detector: "source_chunk_embedding",
            score: 0.89,
            threshold: 0.88,
          }),
        ],
      });

    // Non-tx insert (saveAssessment for both suspect results)
    const mockInsertValues = vi.fn().mockResolvedValue(undefined);
    mockDbInsert.mockReturnValue({ values: mockInsertValues });

    // Non-tx update (quarantineGeneration)
    const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
    const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }));
    mockDbUpdate.mockReturnValue({ set: mockUpdateSet });

    const mockPersistAccepted = vi.fn();

    const firstResult = makeGenerateResult({
      text: "First suspect content",
      executionId: "exec-suspect-1",
      usage: { inputTokens: 200, outputTokens: 80, costUsd: 0.003, cacheCreationTokens: 0, cacheReadTokens: 0 },
    });
    const secondResult = makeGenerateResult({
      text: "Still suspect content",
      executionId: "exec-suspect-2",
      promptRevisions: {
        "chapter-content": "prompt-rev-1",
        "generation-system": "sys-rev-2",
      },
      usage: { inputTokens: 200, outputTokens: 80, costUsd: 0.003, cacheCreationTokens: 0, cacheReadTokens: 0 },
    });

    const mockGenerate = vi
      .fn()
      .mockResolvedValueOnce({
        value: firstResult,
        text: "First suspect content",
        executionId: "exec-suspect-1",
        promptRevisions: { "chapter-content": "prompt-rev-1", "generation-system": "sys-rev-1" },
      })
      .mockResolvedValueOnce({
        value: secondResult,
        text: "Still suspect content",
        executionId: "exec-suspect-2",
        promptRevisions: { "chapter-content": "prompt-rev-1", "generation-system": "sys-rev-2" },
      });

    const input = makeInput({
      generate: mockGenerate,
      persistAccepted: mockPersistAccepted,
    });

    // Execute & assert throw
    await expect(runOriginalityGate(input)).rejects.toMatchObject({
      name: "OriginalityContaminationError",
      decision: "suspect",
    });

    // Two generate calls
    expect(mockGenerate).toHaveBeenCalledTimes(2);

    // Two evaluate calls
    expect(mockEvaluateOriginality).toHaveBeenCalledTimes(2);

    // Two suspect assessments saved (one per attempt)
    expect(mockDbInsert).toHaveBeenCalledTimes(2);
    expect(mockInsertValues).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ decision: "suspect" }),
    );
    expect(mockInsertValues).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ decision: "suspect" }),
    );

    // Generation quarantined
    expect(mockUpdateSet).toHaveBeenCalledWith({ status: "quarantined" });

    // No transaction — persistAccepted NOT called (no fragment inserted)
    expect(mockDbTransaction).not.toHaveBeenCalled();
    expect(mockPersistAccepted).not.toHaveBeenCalled();
  });

  // =========================================================================
  // 4. Clean — fragment created with lineage metadata
  // =========================================================================

  it("clean -> fragment created with lineage metadata", async () => {
    mockLoadProfileSet.mockResolvedValue(TEST_PROFILE_SET);
    mockEvaluateOriginality.mockResolvedValue({
      decision: "clean",
      signals: [],
    });

    // Tx (persistClean)
    const mockTxReturning = vi
      .fn()
      .mockResolvedValue([{ id: "assessment-frag-clean" }]);
    const mockTxValues = vi.fn(() => ({ returning: mockTxReturning }));
    const mockTxInsert = vi.fn(() => ({ values: mockTxValues }));
    const mockTxUpdateWhere = vi.fn().mockResolvedValue(undefined);
    const mockTxUpdateSet = vi.fn(() => ({ where: mockTxUpdateWhere }));
    const mockTxUpdate = vi.fn(() => ({ set: mockTxUpdateSet }));
    mockDbTransaction.mockImplementation(async (cb: any) =>
      cb({
        insert: mockTxInsert,
        update: mockTxUpdate,
      }),
    );

    // Non-tx insert should NOT be called (clean doesn't saveAssessment)
    const mockInsertValues = vi.fn().mockResolvedValue(undefined);
    mockDbInsert.mockReturnValue({ values: mockInsertValues });

    const cleanResult = makeGenerateResult({
      text: "Clean fragment content",
      executionId: "exec-clean-1",
      promptRevisions: {
        "chapter-content": "prompt-rev-1",
        "generation-system": "sys-rev-1",
      },
      usage: { inputTokens: 200, outputTokens: 80, costUsd: 0.003, cacheCreationTokens: 0, cacheReadTokens: 0 },
    });

    let capturedCandidate: GeneratedCandidate<GenerateResult> | null = null;
    let capturedAssessmentId: string | null = null;
    let capturedLineage: unknown = null;

    const persistAccepted = async (
      _tx: unknown,
      candidate: GeneratedCandidate<GenerateResult>,
      assessmentId: string,
      lineage: unknown,
    ) => {
      capturedCandidate = candidate;
      capturedAssessmentId = assessmentId;
      capturedLineage = lineage;

      // Verify the candidate value is the GenerateResult
      expect(candidate.value.text).toBe("Clean fragment content");
      expect(candidate.value.executionId).toBe("exec-clean-1");
      expect(candidate.value.model).toBe("claude-sonnet-4-20250514");
      expect(candidate.value.provider).toBe("anthropic");

      // Verify text and executionId are accessible for fragment insert
      expect(candidate.text).toBe("Clean fragment content");
      expect(candidate.executionId).toBe("exec-clean-1");

      return { entityType: "fragment", entityId: "frag-clean-id" };
    };

    const mockGenerate = vi.fn().mockResolvedValue({
      value: cleanResult,
      text: "Clean fragment content",
      executionId: "exec-clean-1",
      promptRevisions: {
        "chapter-content": "prompt-rev-1",
        "generation-system": "sys-rev-1",
      },
    });

    const input = makeInput({
      generate: mockGenerate,
      persistAccepted,
    });

    // Execute
    const result = await runOriginalityGate(input);

    // Generate once
    expect(mockGenerate).toHaveBeenCalledTimes(1);

    // Evaluate once
    expect(mockEvaluateOriginality).toHaveBeenCalledTimes(1);

    // No non-tx assessment save
    expect(mockDbInsert).not.toHaveBeenCalled();

    // Transaction called
    expect(mockDbTransaction).toHaveBeenCalledTimes(1);

    // Inside transaction: insert clean assessment
    expect(mockTxInsert).toHaveBeenCalled();
    expect(mockTxValues).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: "clean",
        candidateHash: sha256Text("Clean fragment content"),
      }),
    );

    // persistAccepted called with correct data
    expect(capturedCandidate).not.toBeNull();
    expect(capturedAssessmentId).toBe("assessment-frag-clean");
    expect(capturedLineage).toBeDefined();

    // Fragment metadata assertions: the GenerateResult contains provider
    // and the fragment would be stored with provenance info
    expect(capturedCandidate!.value.provider).toBe("anthropic");
    expect(capturedCandidate!.value.text).toBe("Clean fragment content");

    // lineage is accessible for fragment metadata
    const lineageObj = capturedLineage as unknown as Record<string, unknown>;
    expect(lineageObj.scope).toBe("template");

    // Result shape
    expect(result.value).toBe(cleanResult);
    expect(result.assessmentId).toBe("assessment-frag-clean");
    expect(result.lineage).toBeDefined();
  });

  // =========================================================================
  // 5. Prompt revision map contains proper keys
  // =========================================================================

  it("prompt revision map contains chapter-content and generation-system keys", async () => {
    mockLoadProfileSet.mockResolvedValue(TEST_PROFILE_SET);
    mockEvaluateOriginality.mockResolvedValue({
      decision: "clean",
      signals: [],
    });

    // Tx (persistClean)
    const mockTxReturning = vi
      .fn()
      .mockResolvedValue([{ id: "assessment-rev-map" }]);
    const mockTxValues = vi.fn(() => ({ returning: mockTxReturning }));
    const mockTxInsert = vi.fn(() => ({ values: mockTxValues }));
    const mockTxUpdateWhere = vi.fn().mockResolvedValue(undefined);
    const mockTxUpdateSet = vi.fn(() => ({ where: mockTxUpdateWhere }));
    const mockTxUpdate = vi.fn(() => ({ set: mockTxUpdateSet }));
    mockDbTransaction.mockImplementation(async (cb: any) =>
      cb({
        insert: mockTxInsert,
        update: mockTxUpdate,
      }),
    );
    mockDbInsert.mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });

    const promptRevisions = {
      "chapter-content": "chapter-prompt-rev-42",
      "generation-system": "gen-sys-rev-99",
    };

    const resultData = makeGenerateResult({
      promptRevisions,
      usage: { inputTokens: 200, outputTokens: 80, costUsd: 0.003, cacheCreationTokens: 0, cacheReadTokens: 0 },
    });

    let capturedPromptRevisions: Record<string, string> | null = null;

    const generate = vi.fn().mockResolvedValue({
      value: resultData,
      text: "Content with revision map",
      executionId: "exec-rev-map",
      promptRevisions,
    });

    const persistAccepted = async (
      _tx: unknown,
      candidate: GeneratedCandidate<GenerateResult>,
    ) => {
      capturedPromptRevisions = candidate.promptRevisions;
      return { entityType: "fragment", entityId: "frag-rev-map" };
    };

    const input = makeInput({
      generate,
      persistAccepted,
    });

    // Execute
    const result = await runOriginalityGate(input);

    // Verify generate returns the correct promptRevisions
    const generateReturn = await generate.mock.results[0].value;
    expect(generateReturn.promptRevisions).toEqual({
      "chapter-content": "chapter-prompt-rev-42",
      "generation-system": "gen-sys-rev-99",
    });

    // Verify persistAccepted received the promptRevisions
    expect(capturedPromptRevisions).toEqual(promptRevisions);

    // Verify the lineage was built using the promptRevisions
    const lineageLineage = result.lineage as unknown as Record<string, unknown>;
    if (lineageLineage.scope === "template") {
      const tl = lineageLineage as { promptRevisions?: Record<string, string> };
      expect(tl.promptRevisions).toEqual(promptRevisions);
    }
  });

  // =========================================================================
  // 6. Source-free scope — fragment generation without templates
  // =========================================================================

  it("source-free scope -> fragment persisted with source-free lineage", async () => {
    mockLoadProfileSet.mockResolvedValue(SOURCE_FREE_PROFILE_SET);
    mockEvaluateOriginality.mockResolvedValue({
      decision: "clean",
      signals: [],
    });

    // Tx (persistClean)
    const mockTxReturning = vi
      .fn()
      .mockResolvedValue([{ id: "assessment-sf" }]);
    const mockTxValues = vi.fn(() => ({ returning: mockTxReturning }));
    const mockTxInsert = vi.fn(() => ({ values: mockTxValues }));
    const mockTxUpdateWhere = vi.fn().mockResolvedValue(undefined);
    const mockTxUpdateSet = vi.fn(() => ({ where: mockTxUpdateWhere }));
    const mockTxUpdate = vi.fn(() => ({ set: mockTxUpdateSet }));
    mockDbTransaction.mockImplementation(async (cb: any) =>
      cb({
        insert: mockTxInsert,
        update: mockTxUpdate,
      }),
    );
    mockDbInsert.mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });

    const sfResult = makeGenerateResult({
      promptRevisions: {
        "chapter-content": "prompt-rev-sf",
        "generation-system": "sys-rev-sf",
      },
      usage: { inputTokens: 200, outputTokens: 80, costUsd: 0.003, cacheCreationTokens: 0, cacheReadTokens: 0 },
    });

    const mockGenerate = vi.fn().mockResolvedValue({
      value: sfResult,
      text: "Source-free fragment content",
      executionId: "exec-sf",
      promptRevisions: {
        "chapter-content": "prompt-rev-sf",
        "generation-system": "sys-rev-sf",
      },
    });

    const input = makeInput({
      context: makeContext({ authorization: SOURCE_FREE_AUTH }),
      generate: mockGenerate,
    });

    const result = await runOriginalityGate(input);

    // Source-free lineage
    expect(result.lineage.scope).toBe("source-free");
    expect(result.lineage).toHaveProperty("pipelineRunId", null);

    // Assessment inserted with source-free scope
    expect(mockTxValues).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "source-free",
        pipelineRunId: null,
      }),
    );

    // Generation still works
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(mockEvaluateOriginality).toHaveBeenCalledTimes(1);
  });
});
