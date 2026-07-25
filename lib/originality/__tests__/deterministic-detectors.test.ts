// ---------------------------------------------------------------------------
// Deterministic Detectors Tests
//
// Tests verify each detector independently using short synthetic fixtures.
// No copyrighted or source-book text is used.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from "vitest";
import { sha256Text } from "@/lib/template-pipeline/hash";
import {
  computeWordShingles,
  normalizeText,
} from "@/lib/ai/originality-check";
import { ORIGINALITY_POLICY_V2 } from "../contracts";
import { runDeterministicDetectors } from "../deterministic-detectors";
import type { OriginalityPolicy } from "../contracts";
import type { LoadedProfileSet, LoadedChunk } from "../profile-loader";
import type { DistinctiveElement } from "@/lib/db/schema/template-pipeline";

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

const policy: OriginalityPolicy = ORIGINALITY_POLICY_V2;

// ---------------------------------------------------------------------------
// Synthetic phrases for containment fixture
// ---------------------------------------------------------------------------

const SYNTHETIC_PHRASE =
  "the quick brown fox jumps over the lazy dog near the riverbank";
const UNRELATED_PHRASE =
  "quantum physics describes the behavior of subatomic particles and energy";

const syntheticNormalized = normalizeText(SYNTHETIC_PHRASE);
const syntheticShingles5 = computeWordShingles(syntheticNormalized, 5);
const syntheticShingles8 = computeWordShingles(syntheticNormalized, 8);
const SYNTHETIC_HASHED_5 = new Set(
  [...syntheticShingles5].map(sha256Text),
);
const SYNTHETIC_HASHED_8 = new Set(
  [...syntheticShingles8].map(sha256Text),
);

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function emptyChunks(): LoadedChunk[] {
  return [];
}

function containmentChunk(): LoadedChunk {
  return {
    contentHash: "fixture-contain-chunk",
    shingles5: SYNTHETIC_HASHED_5,
    shingles8: SYNTHETIC_HASHED_8,
    embedding: Array(1536).fill(0.1),
  };
}

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

function makeProfile(
  overrides: Partial<{
    id: string;
    chunks: LoadedChunk[];
    elements: DistinctiveElement[];
  }>,
) {
  return {
    id: overrides.id ?? "profile-1",
    profileHash: "profile-hash-1",
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
    profileSetHash: "test-set-hash",
    profiles: profiles as LoadedProfileSet["profiles"],
  };
}

// ===========================================================================
// Hashed n-gram containment
// ===========================================================================

describe("hashed_ngram", () => {
  it("detects exact source reuse through hashed shingles", () => {
    const profileSet = templateProfileSet([
      makeProfile({
        id: "profile-contain",
        chunks: [containmentChunk()],
      }),
    ]);

    const signals = runDeterministicDetectors({
      candidate: SYNTHETIC_PHRASE,
      fieldPath: "content",
      profileSet,
      policy,
    });

    const ngram = signals.find((s) => s.detector === "hashed_ngram");
    expect(ngram).toBeDefined();
    expect(ngram!.strength).toBe("strong");
    expect(ngram!.score).toBeGreaterThan(policy.lexicalContainmentThreshold);
    expect(ngram!.threshold).toBe(policy.lexicalContainmentThreshold);
    expect(ngram!.fieldPath).toBe("content");
  });

  it("produces no signal on unrelated text", () => {
    const profileSet = templateProfileSet([
      makeProfile({
        id: "profile-contain",
        chunks: [containmentChunk()],
      }),
    ]);

    const signals = runDeterministicDetectors({
      candidate: UNRELATED_PHRASE,
      fieldPath: "content",
      profileSet,
      policy,
    });

    expect(signals.find((s) => s.detector === "hashed_ngram")).toBeUndefined();
  });
});

// ===========================================================================
// Coined term
// ===========================================================================

describe("coined_term", () => {
  it("detects exact coined term above confidence threshold", () => {
    const coined = makeElement({
      id: "coined-1",
      kind: "coined_term",
      canonicalLabel: "Synaptic Resonance",
      aliases: ["synaptic resonance theory"],
      confidence: 0.85,
      distinctiveness: 0.95,
    });

    const profileSet = templateProfileSet([
      makeProfile({
        id: "profile-elem",
        elements: [coined],
        chunks: emptyChunks(),
      }),
    ]);

    const signals = runDeterministicDetectors({
      candidate:
        "The experiment confirmed the predictions of Synaptic Resonance.",
      fieldPath: "content",
      profileSet,
      policy,
    });

    const match = signals.find((s) => s.detector === "coined_term");
    expect(match).toBeDefined();
    expect(match!.strength).toBe("strong");
    expect(match!.riskElementIds).toEqual(["coined-1"]);
  });

  it("ignores term below confidence threshold", () => {
    const coined = makeElement({
      id: "coined-low",
      kind: "coined_term",
      canonicalLabel: "Fuzzy Logic Matrix",
      confidence: 0.65, // below 0.80
      distinctiveness: 0.95,
    });

    const profileSet = templateProfileSet([
      makeProfile({
        id: "profile-elem",
        elements: [coined],
        chunks: emptyChunks(),
      }),
    ]);

    const signals = runDeterministicDetectors({
      candidate: "The system uses Fuzzy Logic Matrix for inference.",
      fieldPath: "content",
      profileSet,
      policy,
    });

    expect(
      signals.find((s) => s.detector === "coined_term"),
    ).toBeUndefined();
  });
});

// ===========================================================================
// Named framework
// ===========================================================================

describe("named_framework", () => {
  it("detects framework name in candidate", () => {
    const framework = makeElement({
      id: "fw-1",
      kind: "named_framework",
      canonicalLabel: "Quantum Decision Framework",
      aliases: ["QDF"],
      confidence: 0.90,
      distinctiveness: 0.95,
    });

    const profileSet = templateProfileSet([
      makeProfile({
        id: "profile-elem",
        elements: [framework],
        chunks: emptyChunks(),
      }),
    ]);

    const signals = runDeterministicDetectors({
      candidate:
        "The Quantum Decision Framework guides the selection process.",
      fieldPath: "content",
      profileSet,
      policy,
    });

    const match = signals.find((s) => s.detector === "named_framework");
    expect(match).toBeDefined();
    expect(match!.strength).toBe("strong");
    expect(match!.riskElementIds).toEqual(["fw-1"]);
  });
});

// ===========================================================================
// Entity sequence
// ===========================================================================

describe("entity_sequence", () => {
  it("two distinct entities emit one strong signal", () => {
    const entityA = makeElement({
      id: "entity-a",
      kind: "entity",
      canonicalLabel: "Dr. Maria Santos",
      aliases: ["Maria Santos"],
      confidence: 0.95,
    });
    const entityB = makeElement({
      id: "entity-b",
      kind: "entity",
      canonicalLabel: "Institute for Advanced Study",
      aliases: ["Institute for Advanced Study"],
      confidence: 0.95,
    });

    const profileSet = templateProfileSet([
      makeProfile({
        id: "profile-elem",
        elements: [entityA, entityB],
        chunks: emptyChunks(),
      }),
    ]);

    const signals = runDeterministicDetectors({
      candidate:
        "Dr. Maria Santos presented at the Institute for Advanced Study.",
      fieldPath: "content",
      profileSet,
      policy,
    });

    // Should be exactly one entity_sequence signal (not two individual)
    const sequences = signals.filter(
      (s) => s.detector === "entity_sequence",
    );
    expect(sequences).toHaveLength(1);
    expect(sequences[0].strength).toBe("strong");
    expect(sequences[0].riskElementIds).toContain("entity-a");
    expect(sequences[0].riskElementIds).toContain("entity-b");
    expect(sequences[0].riskElementIds).toHaveLength(2);
  });

  it("single entity produces no signal", () => {
    const entity = makeElement({
      id: "entity-single",
      kind: "entity",
      canonicalLabel: "Dr. Maria Santos",
      aliases: ["Maria Santos"],
      confidence: 0.95,
    });

    const profileSet = templateProfileSet([
      makeProfile({
        id: "profile-elem",
        elements: [entity],
        chunks: emptyChunks(),
      }),
    ]);

    const signals = runDeterministicDetectors({
      candidate: "Dr. Maria Santos presented the findings.",
      fieldPath: "content",
      profileSet,
      policy,
    });

    expect(
      signals.find((s) => s.detector === "entity_sequence"),
    ).toBeUndefined();
  });
});

// ===========================================================================
// Formula + number pair
// ===========================================================================

describe("formula_number", () => {
  it("formula+number pair emits strong signal", () => {
    // Use labels without special characters that normalizeText strips
    const formula = makeElement({
      id: "formula-e",
      kind: "formula",
      canonicalLabel: "Energy Mass Equivalence",
      aliases: ["energy mass equivalence"],
      confidence: 0.95,
    });
    const number = makeElement({
      id: "number-42",
      kind: "number",
      canonicalLabel: "value of 42",
      aliases: ["42 units"],
      confidence: 0.95,
    });

    const profileSet = templateProfileSet([
      makeProfile({
        id: "profile-elem",
        elements: [formula, number],
        chunks: emptyChunks(),
      }),
    ]);

    const signals = runDeterministicDetectors({
      candidate:
        "Using the energy mass equivalence we calculate the value of 42.",
      fieldPath: "content",
      profileSet,
      policy,
    });

    const fnSignals = signals.filter(
      (s) => s.detector === "formula_number",
    );
    expect(fnSignals).toHaveLength(1);
    expect(fnSignals[0].strength).toBe("strong");
    expect(fnSignals[0].riskElementIds).toContain("formula-e");
    expect(fnSignals[0].riskElementIds).toContain("number-42");
  });

  it("single formula alone produces no signal", () => {
    const formula = makeElement({
      id: "formula-e",
      kind: "formula",
      canonicalLabel: "Energy Mass Equivalence",
      aliases: ["energy mass equivalence"],
      confidence: 0.95,
    });

    const profileSet = templateProfileSet([
      makeProfile({
        id: "profile-elem",
        elements: [formula],
        chunks: emptyChunks(),
      }),
    ]);

    const signals = runDeterministicDetectors({
      candidate:
        "Using the energy mass equivalence we calculate the yield.",
      fieldPath: "content",
      profileSet,
      policy,
    });

    expect(
      signals.find((s) => s.detector === "formula_number"),
    ).toBeUndefined();
  });
});

// ===========================================================================
// Distinctive alias (metaphor / anecdote / example / creative_sequence)
// ===========================================================================

describe("distinctive_alias", () => {
  it("metaphor alias at high distinctiveness emits strong signal", () => {
    const metaphor = makeElement({
      id: "meta-1",
      kind: "metaphor",
      canonicalLabel: "The Lighthouse of Understanding",
      aliases: ["lighthouse of understanding"],
      confidence: 0.95,
      distinctiveness: 0.95,
    });

    const profileSet = templateProfileSet([
      makeProfile({
        id: "profile-elem",
        elements: [metaphor],
        chunks: emptyChunks(),
      }),
    ]);

    const signals = runDeterministicDetectors({
      candidate:
        "The theory acts as a lighthouse of understanding in complex domains.",
      fieldPath: "content",
      profileSet,
      policy,
    });

    const match = signals.find(
      (s) => s.detector === "distinctive_alias",
    );
    expect(match).toBeDefined();
    expect(match!.strength).toBe("strong");
    expect(match!.riskElementIds).toEqual(["meta-1"]);
  });

  it("below distinctiveness threshold produces no signal", () => {
    const metaphor = makeElement({
      id: "meta-low",
      kind: "metaphor",
      canonicalLabel: "The Lighthouse of Understanding",
      aliases: ["lighthouse of understanding"],
      confidence: 0.95,
      distinctiveness: 0.50, // below 0.90
    });

    const profileSet = templateProfileSet([
      makeProfile({
        id: "profile-elem",
        elements: [metaphor],
        chunks: emptyChunks(),
      }),
    ]);

    const signals = runDeterministicDetectors({
      candidate:
        "The theory acts as a lighthouse of understanding in complex domains.",
      fieldPath: "content",
      profileSet,
      policy,
    });

    expect(
      signals.find((s) => s.detector === "distinctive_alias"),
    ).toBeUndefined();
  });
});

// ===========================================================================
// Baseline blocklist
// ===========================================================================

describe("baseline_blocklist", () => {
  it("catches blocked content", () => {
    const profileSet = templateProfileSet([
      makeProfile({
        id: "profile-empty",
        elements: [],
        chunks: emptyChunks(),
      }),
    ]);

    const signals = runDeterministicDetectors({
      candidate: "This book explains atomic habits and daily improvement.",
      fieldPath: "content",
      profileSet,
      policy,
    });

    const bl = signals.find((s) => s.detector === "baseline_blocklist");
    expect(bl).toBeDefined();
    expect(bl!.strength).toBe("strong");
    expect(bl!.fieldPath).toBe("content");
  });

  it("produces no signal on clean generic text", () => {
    const profileSet = templateProfileSet([
      makeProfile({
        id: "profile-empty",
        elements: [],
        chunks: emptyChunks(),
      }),
    ]);

    const signals = runDeterministicDetectors({
      candidate: "This book explains how to build better habits through practice and repetition.",
      fieldPath: "content",
      profileSet,
      policy,
    });

    expect(
      signals.find((s) => s.detector === "baseline_blocklist"),
    ).toBeUndefined();
  });
});

// ===========================================================================
// Source-free scope
// ===========================================================================

describe("source-free scope", () => {
  it("returns only baseline blocklist results (no hit)", () => {
    const sourceFreeSet: LoadedProfileSet = {
      scope: "source-free",
      pipelineRunId: null,
      profileSetHash: "empty-hash",
      profiles: [],
    };

    const signals = runDeterministicDetectors({
      candidate: "Generic content with no protected material.",
      fieldPath: "content",
      profileSet: sourceFreeSet,
      policy,
    });

    // Only possible signals are baseline_blocklist (none here)
    expect(signals).toHaveLength(0);
  });

  it("returns only baseline blocklist results (with hit)", () => {
    const sourceFreeSet: LoadedProfileSet = {
      scope: "source-free",
      pipelineRunId: null,
      profileSetHash: "empty-hash",
      profiles: [],
    };

    const signals = runDeterministicDetectors({
      candidate: "atomic habits and the bamboo metaphor",
      fieldPath: "content",
      profileSet: sourceFreeSet,
      policy,
    });

    expect(signals).toHaveLength(1);
    expect(signals[0].detector).toBe("baseline_blocklist");
    expect(signals[0].strength).toBe("strong");
  });

  it("never emits profile-based detectors in source-free scope", () => {
    const sourceFreeSet: LoadedProfileSet = {
      scope: "source-free",
      pipelineRunId: null,
      profileSetHash: "empty-hash",
      profiles: [],
    };

    const signals = runDeterministicDetectors({
      candidate: SYNTHETIC_PHRASE,
      fieldPath: "content",
      profileSet: sourceFreeSet,
      policy,
    });

    const profileDetectors = signals.filter(
      (s) => s.detector !== "baseline_blocklist",
    );
    expect(profileDetectors).toHaveLength(0);
  });
});
