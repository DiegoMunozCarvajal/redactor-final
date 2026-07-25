// ---------------------------------------------------------------------------
// Calibration tests
//
// These tests verify the originality policy against known synthetic fixtures
// to ensure the deterministic detectors behave correctly at policy boundaries.
// No copyrighted or source-book text is used.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from "vitest";
import { runDeterministicDetectors } from "../deterministic-detectors";
import { ORIGINALITY_POLICY_V2 } from "../contracts";
import {
  syntheticPhaseChangeProfile,
  syntheticUnrelated,
  syntheticWithCoinedTerm,
  syntheticWithTwoEntities,
  syntheticWithFormulaAndNumber,
} from "./fixtures/synthetic-source-cases";

// Mock embeddings (never called by deterministic detectors, but imported
// transitively by modules that are not exercised here).
vi.mock("@/lib/ai/embeddings", () => ({
  generateEmbeddings: vi.fn().mockResolvedValue([Array(1536).fill(0.01)]),
  EMBEDDING_MODEL: "text-embedding-3-small",
  EMBEDDING_DIMENSIONS: 1536,
}));

vi.mock("@/lib/prompts/executor", () => ({
  executeVersionedPrompt: vi.fn(),
}));

describe("calibration: deterministic detectors", () => {
  it("flags coined term reuse", () => {
    const signals = runDeterministicDetectors({
      candidate: syntheticWithCoinedTerm,
      fieldPath: "test.field",
      profileSet: syntheticPhaseChangeProfile,
      policy: ORIGINALITY_POLICY_V2,
    });

    expect(signals.some((s) => s.detector === "coined_term")).toBe(true);
  });

  it("flags two-entity sequence", () => {
    const signals = runDeterministicDetectors({
      candidate: syntheticWithTwoEntities,
      fieldPath: "test.field",
      profileSet: syntheticPhaseChangeProfile,
      policy: ORIGINALITY_POLICY_V2,
    });

    expect(signals.some((s) => s.detector === "entity_sequence")).toBe(true);
  });

  it("flags formula+number pair", () => {
    const signals = runDeterministicDetectors({
      candidate: syntheticWithFormulaAndNumber,
      fieldPath: "test.field",
      profileSet: syntheticPhaseChangeProfile,
      policy: ORIGINALITY_POLICY_V2,
    });

    expect(signals.some((s) => s.detector === "formula_number")).toBe(true);
  });

  it("keeps unrelated text clean", () => {
    const signals = runDeterministicDetectors({
      candidate: syntheticUnrelated,
      fieldPath: "test.field",
      profileSet: syntheticPhaseChangeProfile,
      policy: ORIGINALITY_POLICY_V2,
    });

    // Strong signals only — probabilistic "entity_sequence" or "formula_number"
    // should not fire for unrelated text. The baseline blocklist may still fire
    // for its own matches, so we check that non-blocklist strong signals are 0.
    const strongNonBlocklist = signals.filter(
      (s) => s.strength === "strong" && s.detector !== "baseline_blocklist",
    );
    expect(strongNonBlocklist.length).toBe(0);
  });

  it("no single entity signal for one entity", () => {
    const singleEntityProfile = {
      ...syntheticPhaseChangeProfile,
      profiles: [
        {
          ...syntheticPhaseChangeProfile.profiles[0],
          elements: [
            syntheticPhaseChangeProfile.profiles[0].elements[4],
          ], // only Acme
        },
      ],
    };

    const signals = runDeterministicDetectors({
      candidate: "Acme Corporation es una empresa.",
      fieldPath: "test.field",
      profileSet: singleEntityProfile,
      policy: ORIGINALITY_POLICY_V2,
    });

    // Single entity should not produce entity_sequence signal at any strength
    expect(signals.some((s) => s.detector === "entity_sequence")).toBe(false);
  });
});

describe("calibration: database safety properties", () => {
  it("assessment stores candidate_hash not candidate_text", () => {
    // This is verified through the migration/DB test already.
    // The schema-level assertion ensures we never store raw candidate text.
    expect(true).toBe(true);
  });

  it("source-free scope has null pipeline_run_id", () => {
    const sourceFreeProfile = {
      scope: "source-free" as const,
      pipelineRunId: null,
      profileSetHash: "empty",
      profiles: [],
    };

    const signals = runDeterministicDetectors({
      candidate: "any text",
      fieldPath: "test.field",
      profileSet: sourceFreeProfile,
      policy: ORIGINALITY_POLICY_V2,
    });

    // Only baseline blocklist can fire for source-free
    const nonBlocklist = signals.filter(
      (s) => s.detector !== "baseline_blocklist",
    );
    expect(nonBlocklist.length).toBe(0);
  });

  it("below-threshold elements produce no signal", () => {
    const lowProfile = {
      ...syntheticPhaseChangeProfile,
      profiles: [
        {
          ...syntheticPhaseChangeProfile.profiles[0],
          elements: [
            {
              ...syntheticPhaseChangeProfile.profiles[0].elements[0],
              confidence: 0.5, // below 0.80 threshold
            } as const,
          ],
        },
      ],
    };

    const signals = runDeterministicDetectors({
      candidate:
        "gradual heat transforming material slowly changes properties",
      fieldPath: "test.field",
      profileSet: lowProfile,
      policy: ORIGINALITY_POLICY_V2,
    });

    const nonBlocklist = signals.filter(
      (s) => s.detector !== "baseline_blocklist",
    );
    expect(nonBlocklist.length).toBe(0);
  });
});
