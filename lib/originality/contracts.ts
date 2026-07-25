// ---------------------------------------------------------------------------
// Versioned policy
// ---------------------------------------------------------------------------

export const ORIGINALITY_POLICY_V2 = {
  version: "originality-policy-v2",
  profileElementConfidenceThreshold: 0.80,
  strongDistinctivenessThreshold: 0.90,
  lexicalContainmentThreshold: 0.15,
  semanticSuspectThreshold: 0.88,
  semanticStrongThreshold: 0.92,
  reviewerEnabled: true,
} as const;

export type OriginalityPolicy = typeof ORIGINALITY_POLICY_V2;

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

export type OriginalityDecision = "clean" | "suspect" | "contaminated";

// ---------------------------------------------------------------------------
// Signal
// ---------------------------------------------------------------------------

export interface OriginalitySignal {
  detector:
    | "baseline_blocklist"
    | "hashed_ngram"
    | "coined_term"
    | "named_framework"
    | "entity_sequence"
    | "formula_number"
    | "distinctive_alias"
    | "source_chunk_embedding"
    | "risk_label_embedding"
    | "source_leakage_review";
  strength: "strong" | "probabilistic";
  riskElementIds: string[];
  score?: number;
  threshold?: number;
  fieldPath: string;
}

// ---------------------------------------------------------------------------
// Assessment
// ---------------------------------------------------------------------------

export interface OriginalityAssessmentResult {
  decision: OriginalityDecision;
  signals: OriginalitySignal[];
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export type OriginalityStage =
  | "fragment"
  | "placeholder"
  | "assembly"
  | "critique"
  | "correction"
  | "title";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class OriginalityDetectorUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OriginalityDetectorUnavailableError";
  }
}

export class OriginalityContaminationError extends Error {
  constructor(
    public readonly decision: OriginalityDecision,
    message: string,
  ) {
    super(message);
    this.name = "OriginalityContaminationError";
  }
}
