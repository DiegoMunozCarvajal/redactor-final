// ---------------------------------------------------------------------------
// Originality evaluation
//
// Combines deterministic and semantic signals into a single decision using a
// pure decision matrix:
//
//   1. Strong deterministic signal → contaminated (immediate)
//   2. Strong semantic (source ⩾ 0.92) + suspect semantic (label ⩾ 0.88) → contaminated
//   3. Any suspect semantic (⩾ 0.88) → escalate to reviewer (if enabled)
//   4. All below threshold → clean
//
// The reviewer is the most expensive path and is only entered when semantic
// detectors produce suspect signals and risk labels are available to inspect.
// ---------------------------------------------------------------------------

import { ORIGINALITY_POLICY_V2 } from "./contracts";
import { runDeterministicDetectors } from "./deterministic-detectors";
import { runSemanticDetectors } from "./semantic-detectors";
import { runReviewer } from "./reviewer";
import type { OriginalityDecision, OriginalitySignal, OriginalityPolicy } from "./contracts";
import type { LoadedProfileSet } from "./profile-loader";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvaluateInput {
  candidate: string;
  fieldPath: string;
  profileSet: LoadedProfileSet;
  policy?: OriginalityPolicy;
  candidateExecutionId?: string;
  model?: string;
}

export interface EvaluateResult {
  decision: OriginalityDecision;
  signals: OriginalitySignal[];
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function evaluateOriginality(
  input: EvaluateInput,
): Promise<EvaluateResult> {
  const {
    candidate,
    fieldPath,
    profileSet,
    policy = ORIGINALITY_POLICY_V2,
    candidateExecutionId,
    model = "claude-sonnet-5",
  } = input;

  // -----------------------------------------------------------------------
  // 1. Deterministic signals
  // -----------------------------------------------------------------------
  const deterministicSignals = runDeterministicDetectors({
    candidate,
    fieldPath,
    profileSet,
    policy,
  });

  const strongDeterministic = deterministicSignals.filter(
    (s) => s.strength === "strong",
  );

  // Strong deterministic → contaminated immediately, no semantic check needed
  if (strongDeterministic.length > 0) {
    return { decision: "contaminated", signals: deterministicSignals };
  }

  // -----------------------------------------------------------------------
  // 2. Semantic signals
  // -----------------------------------------------------------------------
  const semantic = await runSemanticDetectors({
    candidate,
    fieldPath,
    profileSet,
    policy,
  });

  const allSignals = [...deterministicSignals, ...semantic.signals];

  const sourceSemantic = semantic.sourceChunkMaxSimilarity;
  const labelSemantic = semantic.labelMaxSimilarity;

  // -----------------------------------------------------------------------
  // 3. Decision matrix
  // -----------------------------------------------------------------------

  // Both at strong+suspect thresholds → contaminated (no reviewer needed)
  if (
    sourceSemantic >= policy.semanticStrongThreshold &&
    labelSemantic >= policy.semanticSuspectThreshold
  ) {
    return { decision: "contaminated", signals: allSignals };
  }

  // Any semantic signal above suspect threshold → potential contamination
  if (
    sourceSemantic >= policy.semanticSuspectThreshold ||
    labelSemantic >= policy.semanticSuspectThreshold
  ) {
    // Escalate to reviewer if enabled and execution ID available
    if (
      policy.reviewerEnabled &&
      candidateExecutionId &&
      profileSet.scope === "template"
    ) {
      const riskLabels = collectRiskLabels(profileSet, allSignals);
      if (riskLabels.length > 0) {
        try {
          const reviewerResult = await runReviewer({
            candidate,
            candidateExecutionId,
            profileSet,
            riskLabels,
            existingSignals: allSignals,
            semanticSimilarity: sourceSemantic,
            labelSimilarity: labelSemantic,
            model,
          });

          allSignals.push(...reviewerResult.signals);

          // Reviewer can escalate suspect → contaminated if at least one
          // semantic signal is strong AND reviewer confirms reconstruction
          if (
            reviewerResult.possibleReconstruction &&
            (sourceSemantic >= policy.semanticStrongThreshold ||
              labelSemantic >= policy.semanticStrongThreshold)
          ) {
            return { decision: "contaminated", signals: allSignals };
          }
        } catch {
          // Reviewer unavailable — keep suspect verdict, don't block
        }
      }
    }

    return { decision: "suspect", signals: allSignals };
  }

  // -----------------------------------------------------------------------
  // 4. Clean — nothing triggered
  // -----------------------------------------------------------------------
  return { decision: "clean", signals: allSignals };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Collect risk labels from the profile set that match any risk element IDs
 * referenced by existing signals. Truncates labels to 120 chars.
 */
function collectRiskLabels(
  profileSet: LoadedProfileSet,
  signals: OriginalitySignal[],
): Array<{ id: string; label: string }> {
  const riskIds = new Set(signals.flatMap((s) => s.riskElementIds));
  const labels: Array<{ id: string; label: string }> = [];

  for (const profile of profileSet.profiles) {
    for (const element of profile.elements) {
      if (riskIds.has(element.id)) {
        labels.push({
          id: element.id,
          label: element.canonicalLabel.slice(0, 120),
        });
      }
    }
  }

  return labels;
}
