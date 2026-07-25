// ---------------------------------------------------------------------------
// Source leakage reviewer
//
// An escalation-only structured-output LLM call that evaluates whether a
// suspect candidate re-constructs protected source content. This is the
// most expensive detector and is **only** called when deterministic and
// semantic detectors have already flagged the candidate as suspect.
//
// The reviewer has a single job: answer "does this output reconstruct
// protected source content" and identify which risk elements match.
// ---------------------------------------------------------------------------

import { z } from "zod";
import { executeVersionedPrompt } from "@/lib/prompts/executor";
import type { OriginalitySignal } from "./contracts";
import type { LoadedProfileSet } from "./profile-loader";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const reviewerOutputSchema = z
  .object({
    possibleReconstruction: z.boolean(),
    matchedRiskElementIds: z.array(z.string()).max(20),
  })
  .strict();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReviewerResult {
  possibleReconstruction: boolean;
  matchedRiskElementIds: string[];
  signals: OriginalitySignal[];
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runReviewer(input: {
  candidate: string;
  candidateExecutionId: string;
  profileSet: LoadedProfileSet;
  riskLabels: Array<{ id: string; label: string }>;
  existingSignals: OriginalitySignal[];
  semanticSimilarity: number;
  labelSimilarity: number;
  model: string;
}): Promise<ReviewerResult> {
  const {
    candidate,
    candidateExecutionId,
    riskLabels,
    existingSignals,
    semanticSimilarity,
    labelSimilarity,
    model,
  } = input;

  // Minimize input: only matched labels, truncated to 120 chars each
  const truncatedLabels = riskLabels
    .map((l) => `${l.id}: ${l.label.slice(0, 120)}`)
    .join("\n");

  const signalReport = JSON.stringify({
    deterministicCount: existingSignals.filter((s) => s.strength === "strong")
      .length,
    probabilisticCount: existingSignals.filter(
      (s) => s.strength === "probabilistic",
    ).length,
    semanticSimilarity: Math.round(semanticSimilarity * 100) / 100,
    labelSimilarity: Math.round(labelSimilarity * 100) / 100,
  });

  const schemaStr = JSON.stringify({
    type: "object",
    properties: {
      possibleReconstruction: { type: "boolean" },
      matchedRiskElementIds: {
        type: "array",
        items: { type: "string" },
        maxItems: 20,
      },
    },
    required: ["possibleReconstruction", "matchedRiskElementIds"],
  });

  const { result } = await executeVersionedPrompt({
    stage: "originality-review",
    kind: "source-leakage-review",
    model,
    markerValues: {
      "{{CANDIDATE_OUTPUT}}": candidate,
      "{{MATCHED_RISK_LABELS}}": truncatedLabels || "(none)",
      "{{SIGNAL_REPORT}}": signalReport,
      "{{OUTPUT_SCHEMA}}": schemaStr,
    },
    messagePersistence: {
      mode: "redact-sensitive-markers",
      sensitiveMarkers: ["{{CANDIDATE_OUTPUT}}", "{{MATCHED_RISK_LABELS}}"],
    },
    schema: reviewerOutputSchema,
  });

  const data = result.data as z.infer<typeof reviewerOutputSchema>;

  // Validate returned IDs are a subset of supplied IDs
  const suppliedIds = new Set(riskLabels.map((l) => l.id));
  for (const id of data.matchedRiskElementIds) {
    if (!suppliedIds.has(id)) {
      throw new Error(`Reviewer returned unknown risk element ID: ${id}`);
    }
  }

  const signals: OriginalitySignal[] = [];
  if (data.possibleReconstruction) {
    signals.push({
      detector: "source_leakage_review",
      strength: "probabilistic",
      riskElementIds: data.matchedRiskElementIds,
      fieldPath: "reviewer",
    });
  }

  return {
    possibleReconstruction: data.possibleReconstruction,
    matchedRiskElementIds: data.matchedRiskElementIds,
    signals,
  };
}
