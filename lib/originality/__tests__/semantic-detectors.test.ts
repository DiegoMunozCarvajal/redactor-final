// ---------------------------------------------------------------------------
// Semantic Detectors Tests
//
// Tests verify cosine similarity correctness and runSemanticDetectors signal
// emission using deterministic mock embeddings. No external API calls.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from "vitest";
import { ORIGINALITY_POLICY_V2 } from "../contracts";
import {
  cosineSimilarity,
  runSemanticDetectors,
} from "../semantic-detectors";
import { generateEmbeddings } from "@/lib/ai/embeddings";
import { OriginalityDetectorUnavailableError } from "../contracts";
import type { OriginalityPolicy } from "../contracts";
import type { LoadedProfileSet, LoadedChunk } from "../profile-loader";
import type { DistinctiveElement } from "@/lib/db/schema/template-pipeline";

// ---------------------------------------------------------------------------
// Mock external AI dependency
// ---------------------------------------------------------------------------

vi.mock("@/lib/ai/embeddings", () => ({
  generateEmbeddings: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

const policy: OriginalityPolicy = ORIGINALITY_POLICY_V2;

// ---------------------------------------------------------------------------
// Test embedding vectors (1536-dim)
//
// E0 = [1, 0, 0, …]    basis vector along axis 0
// E1 = [0, 1, 0, …]    basis vector along axis 1
// E_NEAR = [0.9, ~0.436, 0, …]  cos(E0, E_NEAR) ≈ 0.9  (above suspect 0.88)
// E_FAR  = [0.87, ~0.493, 0, …] cos(E0, E_FAR)  ≈ 0.87 (below suspect 0.88)
// E_STRONG = [0.95, ~0.312, 0, …] cos(E0, E_STRONG) ≈ 0.95 (above strong 0.92)
// ---------------------------------------------------------------------------

const DIM = 1536;

function basisVector(index: number): number[] {
  const v = new Array(DIM).fill(0);
  v[index] = 1;
  return v;
}

function dirVector(
  primary: number,
  secondary: number,
  primaryMag: number,
): number[] {
  const v = new Array(DIM).fill(0);
  v[primary] = primaryMag;
  v[secondary] = Math.sqrt(1 - primaryMag * primaryMag);
  return v;
}

const E0 = basisVector(0);
const E1 = basisVector(1);
const E_NEAR = dirVector(0, 2, 0.9); // cos(E0, E_NEAR) = 0.9
const E_FAR = dirVector(0, 2, 0.87); // cos(E0, E_FAR) = 0.87
const E_STRONG = dirVector(0, 2, 0.95); // cos(E0, E_STRONG) = 0.95

// ---------------------------------------------------------------------------
// Fixture builders
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

function makeChunk(
  overrides: Partial<LoadedChunk> & { embedding: number[] },
): LoadedChunk {
  return {
    contentHash: overrides.contentHash ?? "chunk-hash",
    shingles5: overrides.shingles5 ?? new Set(),
    shingles8: overrides.shingles8 ?? new Set(),
    embedding: overrides.embedding,
  };
}

function makeProfile(
  overrides: Partial<{
    id: string;
    chunks: LoadedChunk[];
    elements: DistinctiveElement[];
  }>,
) {
  return {
    id: overrides.id ?? "profile-1",
    profileHash: `hash-${overrides.id ?? "default"}`,
    elements: overrides.elements ?? [],
    chunks: overrides.chunks ?? [],
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

// ===========================================================================
// Cosine similarity
// ===========================================================================

describe("cosineSimilarity", () => {
  it("returns 1.0 for identical vectors", () => {
    const a = E0;
    const b = [...E0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 10);
  });

  it("returns 0.0 for orthogonal vectors", () => {
    expect(cosineSimilarity(E0, E1)).toBeCloseTo(0.0, 10);
  });

  it("throws on dimension mismatch", () => {
    const a = E0;
    const b = new Array(DIM + 1).fill(0);
    expect(() => cosineSimilarity(a, b)).toThrow(
      OriginalityDetectorUnavailableError,
    );
  });

  it("throws on zero vector", () => {
    const zero = new Array(DIM).fill(0);
    expect(() => cosineSimilarity(E0, zero)).toThrow(
      OriginalityDetectorUnavailableError,
    );
    expect(() => cosineSimilarity(zero, E0)).toThrow(
      OriginalityDetectorUnavailableError,
    );
  });

  it("returns correct value for non-orthogonal vectors", () => {
    // cos(E0, E_NEAR) = 0.9
    const sim = cosineSimilarity(E0, E_NEAR);
    expect(sim).toBeCloseTo(0.9, 5);
  });
});

// ===========================================================================
// runSemanticDetectors
// ===========================================================================

describe("runSemanticDetectors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty for source-free scope", async () => {
    const result = await runSemanticDetectors({
      candidate: "any text",
      fieldPath: "content",
      profileSet: sourceFreeProfileSet(),
      policy,
    });

    expect(result.sourceChunkMaxSimilarity).toBe(0);
    expect(result.sourceChunkMaxChunkIndex).toBe(-1);
    expect(result.signals).toHaveLength(0);
    // No embedding call for source-free
    expect(generateEmbeddings).not.toHaveBeenCalled();
  });

  it("detects high similarity to source chunk", async () => {
    vi.mocked(generateEmbeddings).mockResolvedValue([E0]);

    const chunk = makeChunk({ embedding: E0 });
    const profileSet = templateProfileSet([
      makeProfile({ id: "p1", chunks: [chunk] }),
    ]);

    const result = await runSemanticDetectors({
      candidate: "some text similar to source",
      fieldPath: "content",
      profileSet,
      policy,
    });

    expect(result.sourceChunkMaxSimilarity).toBeCloseTo(1.0, 5);
    expect(result.sourceChunkMaxChunkIndex).toBe(0);
    expect(result.sourceChunkMaxProfileId).toBe("p1");
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0].detector).toBe("source_chunk_embedding");
    expect(result.signals[0].strength).toBe("strong");
    expect(result.signals[0].score).toBeCloseTo(1.0, 5);
    expect(result.signals[0].fieldPath).toBe("content");
  });

  it("emits probabilistic signal when similarity is between suspect and strong", async () => {
    vi.mocked(generateEmbeddings).mockResolvedValue([E0]);

    const chunk = makeChunk({ embedding: E_NEAR }); // cos ≈ 0.9 (suspect, not strong)
    const profileSet = templateProfileSet([
      makeProfile({ id: "p1", chunks: [chunk] }),
    ]);

    const result = await runSemanticDetectors({
      candidate: "text with suspect similarity",
      fieldPath: "content",
      profileSet,
      policy,
    });

    expect(result.signals).toHaveLength(1);
    expect(result.signals[0].strength).toBe("probabilistic");
    expect(result.signals[0].score).toBeCloseTo(0.9, 5);
  });

  it("produces no signals for unrelated text", async () => {
    vi.mocked(generateEmbeddings).mockResolvedValue([E0]);

    const chunk = makeChunk({ embedding: E1 }); // orthogonal → cos = 0
    const profileSet = templateProfileSet([
      makeProfile({ id: "p1", chunks: [chunk] }),
    ]);

    const result = await runSemanticDetectors({
      candidate: "unrelated text",
      fieldPath: "content",
      profileSet,
      policy,
    });

    expect(result.sourceChunkMaxSimilarity).toBe(0);
    expect(result.signals).toHaveLength(0);
  });

  it("detects risk label similarity", async () => {
    // First call: candidate embedding → E0
    // Second call (via getRiskLabelEmbeddings): label texts → E_STRONG (cos≈0.95 with E0)
    vi.mocked(generateEmbeddings)
      .mockResolvedValueOnce([E0])
      .mockResolvedValueOnce([E_STRONG]);

    const chunk = makeChunk({ embedding: E1 }); // orthogonal to E0 → no chunk signal
    const element = makeElement({
      id: "risk-label-1",
      kind: "coined_term",
      canonicalLabel: "HighRiskLabel",
      confidence: 0.95, // above threshold (0.80)
    });
    const profileSet = templateProfileSet([
      makeProfile({
        id: "p1",
        chunks: [chunk],
        elements: [element],
      }),
    ]);

    const result = await runSemanticDetectors({
      candidate: "label matching text",
      fieldPath: "content",
      profileSet,
      policy,
    });

    expect(result.labelMaxSimilarity).toBeCloseTo(0.95, 5);
    expect(result.labelMaxRiskElementId).toBe("HighRiskLabel");
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0].detector).toBe("risk_label_embedding");
    expect(result.signals[0].strength).toBe("strong");
  });

  it("produces no label signal when label similarity is below threshold", async () => {
    vi.mocked(generateEmbeddings)
      .mockResolvedValueOnce([E0])
      .mockResolvedValueOnce([E_FAR]); // cos ≈ 0.87 < 0.88

    const chunk = makeChunk({ embedding: E1 });
    const element = makeElement({
      id: "risk-label-2",
      kind: "coined_term",
      canonicalLabel: "BelowThresholdLabel",
      confidence: 0.95,
    });
    // Use unique profile ID to avoid cache collision with previous test
    const profileSet = templateProfileSet([
      makeProfile({
        id: "p-below-threshold",
        chunks: [chunk],
        elements: [element],
      }),
    ]);

    const result = await runSemanticDetectors({
      candidate: "text with below-threshold label sim",
      fieldPath: "content",
      profileSet,
      policy,
    });

    expect(result.labelMaxSimilarity).toBeCloseTo(0.87, 5);
    expect(result.signals).toHaveLength(0);
  });
});
