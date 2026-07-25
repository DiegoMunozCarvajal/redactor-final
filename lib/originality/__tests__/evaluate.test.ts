// ---------------------------------------------------------------------------
// Evaluate Tests (Decision Matrix)
//
// Tests the evaluateOriginality decision matrix end-to-end by mocking all
// three detector layers. Covers:
//   - Strong deterministic → contaminated (short-circuit)
//   - Semantic strong + suspect → contaminated (direct path)
//   - Suspect-only → suspect (with/without reviewer escalation)
//   - All-clean → clean
//   - Source-free → clean
//   - Boundary values: 0.8799, 0.88, 0.9199, 0.92
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from "vitest";
import { ORIGINALITY_POLICY_V2 } from "../contracts";
import { evaluateOriginality } from "../evaluate";
import type { OriginalityPolicy } from "../contracts";
import type { LoadedProfileSet } from "../profile-loader";
import type { DistinctiveElement } from "@/lib/db/schema/template-pipeline";

// ---------------------------------------------------------------------------
// Mock all detector dependencies
// ---------------------------------------------------------------------------

vi.mock("../deterministic-detectors", () => ({
  runDeterministicDetectors: vi.fn(),
}));

vi.mock("../semantic-detectors", () => ({
  runSemanticDetectors: vi.fn(),
}));

vi.mock("../reviewer", () => ({
  runReviewer: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import mocked functions
// ---------------------------------------------------------------------------

import { runDeterministicDetectors } from "../deterministic-detectors";
import { runSemanticDetectors } from "../semantic-detectors";
import { runReviewer } from "../reviewer";

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

const policy: OriginalityPolicy = ORIGINALITY_POLICY_V2;

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeElement(
  overrides: Partial<DistinctiveElement>,
): DistinctiveElement {
  return {
    id: overrides.id ?? `elem-${Math.random().toString(36).slice(2, 8)}`,
    kind: overrides.kind ?? "entity",
    canonicalLabel: overrides.canonicalLabel ?? "default-label",
    aliases: overrides.aliases ?? [],
    sourceChunkIndexes: overrides.sourceChunkIndexes ?? [0],
    confidence: overrides.confidence ?? 0.95,
    distinctiveness: overrides.distinctiveness ?? 0.95,
  };
}

function makeProfile(overrides: {
  id: string;
  chunks?: Array<Record<string, unknown>>;
  elements?: DistinctiveElement[];
}) {
  return {
    id: overrides.id,
    profileHash: `hash-${overrides.id}`,
    elements: overrides.elements ?? [],
    chunks:
      overrides.chunks?.map((c) => ({
        contentHash: "chunk-hash",
        shingles5: new Set<string>(),
        shingles8: new Set<string>(),
        embedding: new Array(1536).fill(0.1),
        ...c,
      })) ?? [],
  };
}

function templateProfileSet(
  profiles: ReturnType<typeof makeProfile>[],
): LoadedProfileSet {
  return {
    scope: "template",
    pipelineRunId: "test-run",
    profileSetHash: `set-hash-${profiles.map((p) => p.id).join("-")}`,
    profiles: profiles as LoadedProfileSet["profiles"],
  };
}

function sourceFreeProfileSet(): LoadedProfileSet {
  return {
    scope: "source-free",
    pipelineRunId: null,
    profileSetHash: "empty-hash",
    profiles: [],
  };
}

const mockDeterministic = vi.mocked(runDeterministicDetectors);
const mockSemantic = vi.mocked(runSemanticDetectors);
const mockReviewer = vi.mocked(runReviewer);

// ===========================================================================
// Tests
// ===========================================================================

describe("evaluateOriginality", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // 1. Strong deterministic → contaminated
  // -----------------------------------------------------------------------

  it("returns contaminated when a strong deterministic signal fires", async () => {
    mockDeterministic.mockReturnValue([
      {
        detector: "hashed_ngram",
        strength: "strong",
        riskElementIds: [],
        score: 0.5,
        threshold: 0.15,
        fieldPath: "content",
      },
    ]);
    // Semantic shouldn't matter — short-circuited
    mockSemantic.mockRejectedValue(new Error("should not be called"));

    const profileSet = templateProfileSet([
      makeProfile({ id: "p1" }),
    ]);

    const result = await evaluateOriginality({
      candidate: "some text",
      fieldPath: "content",
      profileSet,
    });

    expect(result.decision).toBe("contaminated");
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0].detector).toBe("hashed_ngram");
    expect(result.signals[0].strength).toBe("strong");
  });

  // -----------------------------------------------------------------------
  // 2. Semantic strong + label suspect → contaminated (direct path)
  // -----------------------------------------------------------------------

  it("returns contaminated when source >= 0.92 and label >= 0.88", async () => {
    mockDeterministic.mockReturnValue([]);
    mockSemantic.mockResolvedValue({
      sourceChunkMaxSimilarity: 0.92,
      sourceChunkMaxChunkIndex: 0,
      sourceChunkMaxProfileId: "p1",
      labelMaxSimilarity: 0.88,
      labelMaxRiskElementId: "some-label",
      signals: [
        {
          detector: "source_chunk_embedding",
          strength: "strong",
          riskElementIds: [],
          score: 0.92,
          threshold: 0.88,
          fieldPath: "content",
        },
        {
          detector: "risk_label_embedding",
          strength: "probabilistic",
          riskElementIds: ["some-label"],
          score: 0.88,
          threshold: 0.88,
          fieldPath: "content",
        },
      ],
    });

    const profileSet = templateProfileSet([
      makeProfile({ id: "p1" }),
    ]);

    const result = await evaluateOriginality({
      candidate: "text with strong+label similarity",
      fieldPath: "content",
      profileSet,
    });

    // Direct path — contaminated without reviewer
    expect(result.decision).toBe("contaminated");
    expect(result.signals).toHaveLength(2);
    expect(mockReviewer).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 3. Suspect-only → suspect (with reviewer escalation)
  // -----------------------------------------------------------------------

  it("returns suspect when source at suspect threshold (0.88) but below strong", async () => {
    mockDeterministic.mockReturnValue([]);
    mockSemantic.mockResolvedValue({
      sourceChunkMaxSimilarity: 0.88,
      sourceChunkMaxChunkIndex: 0,
      sourceChunkMaxProfileId: "p1",
      labelMaxSimilarity: 0.5,
      labelMaxRiskElementId: null,
      signals: [
        {
          detector: "source_chunk_embedding",
          strength: "probabilistic",
          riskElementIds: [],
          score: 0.88,
          threshold: 0.88,
          fieldPath: "content",
        },
      ],
    });
    // Reviewer not called because no risk labels (deterministic signals empty)
    mockReviewer.mockRejectedValue(new Error("should not be called"));

    const profileSet = templateProfileSet([
      makeProfile({ id: "p1" }),
    ]);

    const result = await evaluateOriginality({
      candidate: "suspect text",
      fieldPath: "content",
      profileSet,
      candidateExecutionId: "exec-1",
    });

    expect(result.decision).toBe("suspect");
    expect(result.signals).toHaveLength(1);
    expect(mockReviewer).not.toHaveBeenCalled();
  });

  it("returns suspect at boundary 0.9199 (above suspect, below strong)", async () => {
    mockDeterministic.mockReturnValue([]);
    mockSemantic.mockResolvedValue({
      sourceChunkMaxSimilarity: 0.9199,
      sourceChunkMaxChunkIndex: 0,
      sourceChunkMaxProfileId: "p1",
      labelMaxSimilarity: 0.5,
      labelMaxRiskElementId: null,
      signals: [
        {
          detector: "source_chunk_embedding",
          strength: "probabilistic",
          riskElementIds: [],
          score: 0.9199,
          threshold: 0.88,
          fieldPath: "content",
        },
      ],
    });

    const profileSet = templateProfileSet([
      makeProfile({ id: "p1" }),
    ]);

    const result = await evaluateOriginality({
      candidate: "suspect text at 0.9199",
      fieldPath: "content",
      profileSet,
    });

    expect(result.decision).toBe("suspect");
  });

  it("escalates to reviewer when deterministic provides risk labels", async () => {
    // Deterministic returns a probabilistic signal with a risk element ID
    mockDeterministic.mockReturnValue([
      {
        detector: "coined_term",
        strength: "probabilistic",
        riskElementIds: ["risk-term-1"],
        fieldPath: "content",
      },
    ]);
    // Semantic is suspect
    mockSemantic.mockResolvedValue({
      sourceChunkMaxSimilarity: 0.88,
      sourceChunkMaxChunkIndex: 0,
      sourceChunkMaxProfileId: "p1",
      labelMaxSimilarity: 0.5,
      labelMaxRiskElementId: null,
      signals: [
        {
          detector: "source_chunk_embedding",
          strength: "probabilistic",
          riskElementIds: [],
          score: 0.88,
          threshold: 0.88,
          fieldPath: "content",
        },
      ],
    });
    // Reviewer says not a reconstruction
    mockReviewer.mockResolvedValue({
      possibleReconstruction: false,
      matchedRiskElementIds: [],
      signals: [],
    });

    const element = makeElement({
      id: "risk-term-1",
      kind: "coined_term",
      canonicalLabel: "RiskTerm",
    });
    const profileSet = templateProfileSet([
      makeProfile({
        id: "p1",
        elements: [element],
      }),
    ]);

    const result = await evaluateOriginality({
      candidate: "suspect text with risk labels",
      fieldPath: "content",
      profileSet,
      candidateExecutionId: "exec-1",
    });

    expect(result.decision).toBe("suspect");
    expect(mockReviewer).toHaveBeenCalledTimes(1);
  });

  it("escalates suspect to contaminated when reviewer confirms + strong semantic", async () => {
    // Deterministic provides risk labels via probabilistic signal
    mockDeterministic.mockReturnValue([
      {
        detector: "coined_term",
        strength: "probabilistic",
        riskElementIds: ["risk-term-1"],
        fieldPath: "content",
      },
    ]);
    // Source at strong threshold (0.92), label below suspect
    mockSemantic.mockResolvedValue({
      sourceChunkMaxSimilarity: 0.92,
      sourceChunkMaxChunkIndex: 0,
      sourceChunkMaxProfileId: "p1",
      labelMaxSimilarity: 0.5,
      labelMaxRiskElementId: null,
      signals: [
        {
          detector: "source_chunk_embedding",
          strength: "strong",
          riskElementIds: [],
          score: 0.92,
          threshold: 0.88,
          fieldPath: "content",
        },
      ],
    });
    // Reviewer confirms possible reconstruction
    mockReviewer.mockResolvedValue({
      possibleReconstruction: true,
      matchedRiskElementIds: [],
      signals: [
        {
          detector: "source_leakage_review",
          strength: "probabilistic",
          riskElementIds: [],
          fieldPath: "reviewer",
        },
      ],
    });

    const element = makeElement({
      id: "risk-term-1",
      kind: "coined_term",
      canonicalLabel: "RiskTerm",
    });
    const profileSet = templateProfileSet([
      makeProfile({
        id: "p1",
        elements: [element],
      }),
    ]);

    const result = await evaluateOriginality({
      candidate: "text with strong semantic + reviewer confirm",
      fieldPath: "content",
      profileSet,
      candidateExecutionId: "exec-1",
    });

    expect(result.decision).toBe("contaminated");
    expect(mockReviewer).toHaveBeenCalledTimes(1);
    // Should include the reviewer signal
    expect(
      result.signals.find((s) => s.detector === "source_leakage_review"),
    ).toBeDefined();
  });

  it("does not escalate to contaminated when reviewer confirms but no strong semantic", async () => {
    mockDeterministic.mockReturnValue([
      {
        detector: "coined_term",
        strength: "probabilistic",
        riskElementIds: ["risk-term-1"],
        fieldPath: "content",
      },
    ]);
    // Source at suspect threshold (0.88) but not strong
    mockSemantic.mockResolvedValue({
      sourceChunkMaxSimilarity: 0.88,
      sourceChunkMaxChunkIndex: 0,
      sourceChunkMaxProfileId: "p1",
      labelMaxSimilarity: 0.5,
      labelMaxRiskElementId: null,
      signals: [
        {
          detector: "source_chunk_embedding",
          strength: "probabilistic",
          riskElementIds: [],
          score: 0.88,
          threshold: 0.88,
          fieldPath: "content",
        },
      ],
    });
    mockReviewer.mockResolvedValue({
      possibleReconstruction: true,
      matchedRiskElementIds: [],
      signals: [
        {
          detector: "source_leakage_review",
          strength: "probabilistic",
          riskElementIds: [],
          fieldPath: "reviewer",
        },
      ],
    });

    const element = makeElement({
      id: "risk-term-1",
      kind: "coined_term",
      canonicalLabel: "RiskTerm",
    });
    const profileSet = templateProfileSet([
      makeProfile({
        id: "p1",
        elements: [element],
      }),
    ]);

    const result = await evaluateOriginality({
      candidate: "suspect with reviewer but no strong semantic",
      fieldPath: "content",
      profileSet,
      candidateExecutionId: "exec-1",
    });

    // Reviewer confirms, but 0.88 < 0.92 → stays suspect
    expect(result.decision).toBe("suspect");
    expect(mockReviewer).toHaveBeenCalledTimes(1);
  });

  it("handles reviewer failure gracefully without blocking", async () => {
    mockDeterministic.mockReturnValue([
      {
        detector: "coined_term",
        strength: "probabilistic",
        riskElementIds: ["risk-term-1"],
        fieldPath: "content",
      },
    ]);
    mockSemantic.mockResolvedValue({
      sourceChunkMaxSimilarity: 0.88,
      sourceChunkMaxChunkIndex: 0,
      sourceChunkMaxProfileId: "p1",
      labelMaxSimilarity: 0.5,
      labelMaxRiskElementId: null,
      signals: [
        {
          detector: "source_chunk_embedding",
          strength: "probabilistic",
          riskElementIds: [],
          score: 0.88,
          threshold: 0.88,
          fieldPath: "content",
        },
      ],
    });
    // Reviewer throws
    mockReviewer.mockRejectedValue(new Error("Reviewer API unavailable"));

    const element = makeElement({
      id: "risk-term-1",
      kind: "coined_term",
      canonicalLabel: "RiskTerm",
    });
    const profileSet = templateProfileSet([
      makeProfile({
        id: "p1",
        elements: [element],
      }),
    ]);

    const result = await evaluateOriginality({
      candidate: "suspect text with failing reviewer",
      fieldPath: "content",
      profileSet,
      candidateExecutionId: "exec-1",
    });

    // Should degrade gracefully to suspect
    expect(result.decision).toBe("suspect");
  });

  // -----------------------------------------------------------------------
  // 4. All-clean → clean
  // -----------------------------------------------------------------------

  it("returns clean when all signals are below thresholds", async () => {
    mockDeterministic.mockReturnValue([]);
    mockSemantic.mockResolvedValue({
      sourceChunkMaxSimilarity: 0.5,
      sourceChunkMaxChunkIndex: -1,
      sourceChunkMaxProfileId: "",
      labelMaxSimilarity: 0.3,
      labelMaxRiskElementId: null,
      signals: [],
    });

    const profileSet = templateProfileSet([
      makeProfile({ id: "p1" }),
    ]);

    const result = await evaluateOriginality({
      candidate: "clean text",
      fieldPath: "content",
      profileSet,
    });

    expect(result.decision).toBe("clean");
    expect(result.signals).toHaveLength(0);
  });

  it("returns clean at boundary 0.8799 (below suspect threshold)", async () => {
    mockDeterministic.mockReturnValue([]);
    mockSemantic.mockResolvedValue({
      sourceChunkMaxSimilarity: 0.8799,
      sourceChunkMaxChunkIndex: 0,
      sourceChunkMaxProfileId: "p1",
      labelMaxSimilarity: 0.5,
      labelMaxRiskElementId: null,
      signals: [],
    });

    const profileSet = templateProfileSet([
      makeProfile({ id: "p1" }),
    ]);

    const result = await evaluateOriginality({
      candidate: "clean at 0.8799",
      fieldPath: "content",
      profileSet,
    });

    expect(result.decision).toBe("clean");
  });

  // -----------------------------------------------------------------------
  // 5. Source-free
  // -----------------------------------------------------------------------

  it("returns clean for source-free with generic text", async () => {
    mockDeterministic.mockReturnValue([]);
    mockSemantic.mockResolvedValue({
      sourceChunkMaxSimilarity: 0,
      sourceChunkMaxChunkIndex: -1,
      sourceChunkMaxProfileId: "",
      labelMaxSimilarity: 0,
      labelMaxRiskElementId: null,
      signals: [],
    });

    const result = await evaluateOriginality({
      candidate: "generic text without any protected content",
      fieldPath: "content",
      profileSet: sourceFreeProfileSet(),
    });

    expect(result.decision).toBe("clean");
    expect(result.signals).toHaveLength(0);
  });
});
