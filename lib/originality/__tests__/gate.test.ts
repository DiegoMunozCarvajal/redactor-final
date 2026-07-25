// ---------------------------------------------------------------------------
// Gate Tests
//
// Tests the runOriginalityGate function — the atomic originality guard that
// wraps generation -> evaluate -> retry-or-quarantine -> persist.
//
// Mocks: db (insert, update, transaction), evaluateOriginality,
//        loadOriginalityProfileSet
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from "vitest";
import { sha256Text } from "@/lib/template-pipeline/hash";
import {
  OriginalityContaminationError,
  OriginalityDetectorUnavailableError,
} from "../contracts";
import type { OriginalitySignal } from "../contracts";
import type { GenerationAuthorization } from "@/lib/template-pipeline/contracts";

// ---------------------------------------------------------------------------
// Hoisted mock variables — created before vi.mock factories
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

vi.mock("../evaluate", () => ({
  evaluateOriginality: mockEvaluateOriginality,
}));

vi.mock("../profile-loader", () => ({
  loadOriginalityProfileSet: mockLoadProfileSet,
}));

// ---------------------------------------------------------------------------
// Import gate under test
// ---------------------------------------------------------------------------

import { runOriginalityGate } from "../gate";
import type { OriginalityGateInput } from "../gate";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GENERIC_FEEDBACK =
  "Use a materially different illustration, argument, and formulation.";

const TEMPLATE_AUTH: GenerationAuthorization = {
  scope: "template",
  pipelineRunId: "run-1",
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
  pipelineRunId: "run-1",
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
// Fixture helpers
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
  overrides: Partial<OriginalityGateInput<string>["context"]> = {},
): OriginalityGateInput<string>["context"] {
  return {
    projectId: "proj-1",
    chapterId: "chap-1",
    chapterGenerationId: "gen-1",
    stage: "fragment",
    fieldPath: "content",
    authorization: TEMPLATE_AUTH,
    templateArtifactHash: "template-art-hash",
    placeholderFunctionHash: "ph-hash",
    model: "claude-sonnet-5",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Generic input builder (tests fill in generate/persistAccepted)
// ---------------------------------------------------------------------------

function buildInput(
  overrides: Partial<OriginalityGateInput<string>> = {},
): OriginalityGateInput<string> {
  return {
    context: makeContext(),
    generate: vi.fn().mockResolvedValue({
      value: "default",
      text: "default content",
      executionId: "exec-0",
      promptRevisions: {},
    }),
    persistAccepted: vi.fn().mockResolvedValue({ entityType: "fragment", entityId: "entity-1" }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runOriginalityGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // 1. Contaminated
  // =========================================================================

  it("contaminated — saves assessment, quarantines, throws", async () => {
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

    const mockGenerate = vi.fn().mockResolvedValue({
      value: "output",
      text: "contaminated content",
      executionId: "exec-1",
      promptRevisions: {},
    });

    const input = buildInput({ generate: mockGenerate });

    // Execute & assert throw
    await expect(runOriginalityGate(input)).rejects.toMatchObject({
      name: "OriginalityContaminationError",
      decision: "contaminated",
    });

    // Generate once, no retry
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(mockGenerate).toHaveBeenCalledWith({});

    // Evaluate once
    expect(mockEvaluateOriginality).toHaveBeenCalledTimes(1);

    // Assessment saved (non-transactional)
    expect(mockDbInsert).toHaveBeenCalledTimes(1);
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: "contaminated",
        candidateHash: sha256Text("contaminated content"),
        projectId: "proj-1",
        stage: "fragment",
      }),
    );

    // Generation quarantined
    expect(mockUpdateSet).toHaveBeenCalledWith({ status: "quarantined" });

    // No transaction
    expect(mockDbTransaction).not.toHaveBeenCalled();
  });

  // =========================================================================
  // 2. Suspect -> Clean after retry
  // =========================================================================

  it("suspect -> clean after retry — exactly 2 generate calls, persists", async () => {
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
      .mockResolvedValue([{ id: "assessment-1" }]);
    const mockTxValues = vi.fn(() => ({ returning: mockTxReturning }));
    const mockTxInsert = vi.fn(() => ({ values: mockTxValues }));
    const mockTxUpdateWhere = vi.fn().mockResolvedValue(undefined);
    const mockTxUpdateSet = vi.fn(() => ({ where: mockTxUpdateWhere }));
    const mockTxUpdate = vi.fn(() => ({ set: mockTxUpdateSet }));
    mockDbTransaction.mockImplementation(async (cb) =>
      cb({
        insert: mockTxInsert,
        update: mockTxUpdate,
      }),
    );

    const mockGenerate = vi
      .fn()
      .mockResolvedValueOnce({
        value: "first-output",
        text: "suspect content",
        executionId: "exec-1",
        promptRevisions: {},
      })
      .mockResolvedValueOnce({
        value: "second-output",
        text: "clean content",
        executionId: "exec-2",
        promptRevisions: { "prompt-1": "rev-1" },
      });

    const mockPersistAccepted = vi
      .fn()
      .mockResolvedValue({ entityType: "fragment", entityId: "entity-1" });

    const input = buildInput({
      generate: mockGenerate,
      persistAccepted: mockPersistAccepted,
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

    // persistAccepted called inside transaction with second candidate
    expect(mockPersistAccepted).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ value: "second-output" }),
      "assessment-1",
      expect.anything(),
    );

    // Update inside transaction
    expect(mockTxUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        acceptedEntityType: "fragment",
        acceptedEntityId: "entity-1",
      }),
    );

    // Result shape
    expect(result.value).toBe("second-output");
    expect(result.assessmentId).toBe("assessment-1");
    expect(result.lineage).toBeDefined();
    expect(result.lineage.scope).toBe("template");
  });

  // =========================================================================
  // 3. Suspect -> Suspect after retry
  // =========================================================================

  it("suspect -> suspect after retry — quarantines, throws", async () => {
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

    const mockGenerate = vi
      .fn()
      .mockResolvedValueOnce({
        value: "first-output",
        text: "suspect content",
        executionId: "exec-1",
        promptRevisions: {},
      })
      .mockResolvedValueOnce({
        value: "second-output",
        text: "still suspect content",
        executionId: "exec-2",
        promptRevisions: {},
      });

    const input = buildInput({ generate: mockGenerate });

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

    // No transaction
    expect(mockDbTransaction).not.toHaveBeenCalled();
  });

  // =========================================================================
  // 4. Clean — persists atomically
  // =========================================================================

  it("clean — persists atomically (assessment + accepted entity in one tx)", async () => {
    mockLoadProfileSet.mockResolvedValue(TEST_PROFILE_SET);
    mockEvaluateOriginality.mockResolvedValue({
      decision: "clean",
      signals: [],
    });

    // Tx (persistClean)
    const mockTxReturning = vi
      .fn()
      .mockResolvedValue([{ id: "assessment-1" }]);
    const mockTxValues = vi.fn(() => ({ returning: mockTxReturning }));
    const mockTxInsert = vi.fn(() => ({ values: mockTxValues }));
    const mockTxUpdateWhere = vi.fn().mockResolvedValue(undefined);
    const mockTxUpdateSet = vi.fn(() => ({ where: mockTxUpdateWhere }));
    const mockTxUpdate = vi.fn(() => ({ set: mockTxUpdateSet }));
    mockDbTransaction.mockImplementation(async (cb) =>
      cb({
        insert: mockTxInsert,
        update: mockTxUpdate,
      }),
    );

    // Non-tx insert should NOT be called (clean doesn't saveAssessment)
    const mockInsertValues = vi.fn().mockResolvedValue(undefined);
    mockDbInsert.mockReturnValue({ values: mockInsertValues });

    const mockGenerate = vi.fn().mockResolvedValue({
      value: "clean-output",
      text: "clean content",
      executionId: "exec-1",
      promptRevisions: {},
    });

    const mockPersistAccepted = vi
      .fn()
      .mockResolvedValue({ entityType: "fragment", entityId: "entity-1" });

    const input = buildInput({
      generate: mockGenerate,
      persistAccepted: mockPersistAccepted,
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
        candidateHash: sha256Text("clean content"),
      }),
    );

    // persistAccepted called
    expect(mockPersistAccepted).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ value: "clean-output" }),
      "assessment-1",
      expect.anything(),
    );

    // Update after persistAccepted
    expect(mockTxUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        acceptedEntityType: "fragment",
        acceptedEntityId: "entity-1",
      }),
    );

    // Result
    expect(result.value).toBe("clean-output");
    expect(result.assessmentId).toBe("assessment-1");
    expect(result.lineage).toBeDefined();
  });

  // =========================================================================
  // 5. Detector unavailable
  // =========================================================================

  it("detector unavailable — throws without persisting", async () => {
    mockLoadProfileSet.mockRejectedValue(
      new OriginalityDetectorUnavailableError(
        "No source profiles found for run run-1",
      ),
    );

    const mockGenerate = vi.fn();
    const mockPersistAccepted = vi.fn();

    const input = buildInput({
      generate: mockGenerate,
      persistAccepted: mockPersistAccepted,
    });

    // Execute & assert throw
    await expect(runOriginalityGate(input)).rejects.toThrow(
      OriginalityDetectorUnavailableError,
    );

    // No generation, no persistence
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(mockPersistAccepted).not.toHaveBeenCalled();
    expect(mockDbInsert).not.toHaveBeenCalled();
    expect(mockDbUpdate).not.toHaveBeenCalled();
    expect(mockDbTransaction).not.toHaveBeenCalled();
  });

  // =========================================================================
  // 6. Assessment stores hash, not prose
  // =========================================================================

  it("stores only hash of candidate prose, not the prose itself", async () => {
    mockLoadProfileSet.mockResolvedValue(TEST_PROFILE_SET);
    mockEvaluateOriginality.mockResolvedValue({
      decision: "clean",
      signals: [],
    });

    // Tx (persistClean)
    const mockTxReturning = vi
      .fn()
      .mockResolvedValue([{ id: "assessment-1" }]);
    const mockTxValues = vi.fn(() => ({ returning: mockTxReturning }));
    const mockTxInsert = vi.fn(() => ({ values: mockTxValues }));
    const mockTxUpdateWhere = vi.fn().mockResolvedValue(undefined);
    const mockTxUpdateSet = vi.fn(() => ({ where: mockTxUpdateWhere }));
    const mockTxUpdate = vi.fn(() => ({ set: mockTxUpdateSet }));
    mockDbTransaction.mockImplementation(async (cb) =>
      cb({
        insert: mockTxInsert,
        update: mockTxUpdate,
      }),
    );
    mockDbInsert.mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });

    const candidateText = "This is the actual generated prose content";
    const mockGenerate = vi.fn().mockResolvedValue({
      value: "output",
      text: candidateText,
      executionId: "exec-1",
      promptRevisions: {},
    });

    const input = buildInput({ generate: mockGenerate });

    await runOriginalityGate(input);

    // Verify tx values contain candidateHash but not the raw text
    const txCalls = mockTxValues.mock.calls as unknown[][];
    expect(txCalls).not.toHaveLength(0);
    const valuesArg = txCalls[0][0] as Record<string, unknown>;
    expect(valuesArg).toHaveProperty("candidateHash");
    expect(valuesArg.candidateHash).toBe(sha256Text(candidateText));
    expect(valuesArg.candidateHash).not.toBe(candidateText);

    // Verify no text field in the assessment values object
    expect(valuesArg).not.toHaveProperty("text");
    expect(valuesArg).not.toHaveProperty("candidateText");
  });

  // =========================================================================
  // 7. Source-free scope
  // =========================================================================

  it("source-free scope — works without pipeline run ID", async () => {
    mockLoadProfileSet.mockResolvedValue(SOURCE_FREE_PROFILE_SET);
    mockEvaluateOriginality.mockResolvedValue({
      decision: "clean",
      signals: [],
    });

    // Tx (persistClean)
    const mockTxReturning = vi
      .fn()
      .mockResolvedValue([{ id: "assessment-2" }]);
    const mockTxValues = vi.fn(() => ({ returning: mockTxReturning }));
    const mockTxInsert = vi.fn(() => ({ values: mockTxValues }));
    const mockTxUpdateWhere = vi.fn().mockResolvedValue(undefined);
    const mockTxUpdateSet = vi.fn(() => ({ where: mockTxUpdateWhere }));
    const mockTxUpdate = vi.fn(() => ({ set: mockTxUpdateSet }));
    mockDbTransaction.mockImplementation(async (cb) =>
      cb({
        insert: mockTxInsert,
        update: mockTxUpdate,
      }),
    );
    mockDbInsert.mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });

    const mockGenerate = vi.fn().mockResolvedValue({
      value: "sf-output",
      text: "source free content",
      executionId: "exec-sf",
      promptRevisions: {},
    });

    const input = buildInput({
      context: makeContext({ authorization: SOURCE_FREE_AUTH }),
      generate: mockGenerate,
    });

    const result = await runOriginalityGate(input);

    // Source-free lineage — no pipelineRunId
    expect(result.lineage.scope).toBe("source-free");
    expect(result.lineage).toHaveProperty("pipelineRunId", null);

    // Assessment inserted with source-free scope and null pipelineRunId
    expect(mockTxValues).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "source-free",
        pipelineRunId: null,
      }),
    );

    // Generation and evaluation still work
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(mockEvaluateOriginality).toHaveBeenCalledTimes(1);
  });
});
