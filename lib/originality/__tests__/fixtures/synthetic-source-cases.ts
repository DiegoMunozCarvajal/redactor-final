// ---------------------------------------------------------------------------
// Synthetic source profile fixtures
//
// All text is synthetic — NOT from any real book or article. These fixtures
// are used exclusively for calibration tests that verify detector behavior
// against known inputs without relying on copyrighted or production data.
// ---------------------------------------------------------------------------

import type { LoadedProfileSet, LoadedChunk } from "../../profile-loader";
import type { DistinctiveElement } from "@/lib/db/schema/template-pipeline";

// ---------------------------------------------------------------------------
// Common embedding vectors for fixtures
// ---------------------------------------------------------------------------

export const nearThresholdEmbedding: number[] = Array(1536).fill(0.01);
export const belowThresholdEmbedding: number[] = Array(1536).fill(0.05);

// ---------------------------------------------------------------------------
// Empty shingle sets (containment is not tested by these fixtures)
// ---------------------------------------------------------------------------

const emptyShingles5: Set<string> = new Set();
const emptyShingles8: Set<string> = new Set();

// ---------------------------------------------------------------------------
// Chunks
// ---------------------------------------------------------------------------

const phaseChangeChunk: LoadedChunk = {
  contentHash: "chunk-hash-1",
  shingles5: emptyShingles5,
  shingles8: emptyShingles8,
  embedding: nearThresholdEmbedding,
};

// ---------------------------------------------------------------------------
// Distinctive elements
// ---------------------------------------------------------------------------

const riskPhaseChangeElement: DistinctiveElement = {
  id: "risk_phase_change",
  kind: "metaphor",
  canonicalLabel: "phase transition metaphor",
  aliases: ["gradual heat transforming material", "accumulated pressure transforms"],
  sourceChunkIndexes: [0],
  confidence: 0.95,
  distinctiveness: 0.92,
};

// NOTE: Labels must survive normalizeText() which strips non-word, non-space
// characters ([^\\w\\s] → space). Special characters like =, *, . are removed
// from the candidate but preserved in labels — so plain word sequences are
// used here to ensure the matching logic can be exercised reliably.
const riskSyntheticFormula: DistinctiveElement = {
  id: "risk_synthetic_formula",
  kind: "formula",
  canonicalLabel: "newtons second law",
  aliases: ["force mass acceleration"],
  sourceChunkIndexes: [0],
  confidence: 0.90,
  distinctiveness: 0.85,
};

const riskSyntheticNumber: DistinctiveElement = {
  id: "risk_synthetic_number",
  kind: "number",
  canonicalLabel: "forty two km",
  aliases: ["marathon distance"],
  sourceChunkIndexes: [0],
  confidence: 0.88,
  distinctiveness: 0.80,
};

const riskCoinedTerm: DistinctiveElement = {
  id: "risk_coined_term",
  kind: "coined_term",
  canonicalLabel: "gravitational empathy",
  aliases: [],
  sourceChunkIndexes: [0],
  confidence: 0.93,
  distinctiveness: 0.94,
};

const riskEntity1: DistinctiveElement = {
  id: "risk_entity_1",
  kind: "entity",
  canonicalLabel: "Acme Corporation",
  aliases: ["Acme"],
  sourceChunkIndexes: [0],
  confidence: 0.95,
  distinctiveness: 0.91,
};

const riskEntity2: DistinctiveElement = {
  id: "risk_entity_2",
  kind: "entity",
  canonicalLabel: "Beta Protocol",
  aliases: ["Beta"],
  sourceChunkIndexes: [0],
  confidence: 0.92,
  distinctiveness: 0.90,
};

// ---------------------------------------------------------------------------
// Full profile set
// ---------------------------------------------------------------------------

export const syntheticPhaseChangeProfile: LoadedProfileSet = {
  scope: "template",
  pipelineRunId: "run-calibration",
  profileSetHash: "calibration-hash-001",
  profiles: [
    {
      id: "profile-1",
      profileHash: "profile-hash-1",
      elements: [
        riskPhaseChangeElement,
        riskSyntheticFormula,
        riskSyntheticNumber,
        riskCoinedTerm,
        riskEntity1,
        riskEntity2,
      ],
      chunks: [phaseChangeChunk],
    },
  ],
};

// ---------------------------------------------------------------------------
// Text fixtures
// ---------------------------------------------------------------------------

// Translated paraphrase (Spanish)
export const syntheticParaphrase =
  "La presión acumulada transforma lentamente el material.";

// Unrelated generic text
export const syntheticUnrelated =
  "Haz una pregunta breve y escucha la respuesta.";

// Contains coined term
export const syntheticWithCoinedTerm =
  "El concepto de gravitational empathy explica cómo las masas se atraen emocionalmente.";

// Contains two entities
export const syntheticWithTwoEntities =
  "Acme Corporation implementó Beta Protocol en todas sus sucursales.";

// Contains formula + number (labels use word sequences, not punctuation —
// see note above about normalizeText behavior)
export const syntheticWithFormulaAndNumber =
  "Segun newtons second law la fuerza necesaria para un marathon distance es considerable.";
