// ---------------------------------------------------------------------------
// Deterministic source reuse detectors
//
// Runs a set of fast, deterministic checks against loaded source profiles to
// detect verbatim or near-verbatim reuse of protected content. These are the
// cheapest (and highest-precision) detectors in the originality pipeline.
//
// Guards:
//   1. Hashed n-gram containment — word-level shingles hashed for O(1) lookup
//   2. Coined term detection     — distinctive term/phrase from source profile
//   3. Named framework detection — framework names from source profile
//   4. Entity sequence detection — ≥2 distinct entities from the same source
//   5. Formula+number pair       — formula + number from same source → strong
//   6. Distinctive alias         — metaphor/anecdote/example/creative sequence
//   7. Baseline blocklist        — always-on regex blocklist (copyrighted works)
// ---------------------------------------------------------------------------

import { sha256Text } from "@/lib/template-pipeline/hash";
import {
  computeWordShingles,
  normalizeText,
  assertOriginalEnough,
} from "@/lib/ai/originality-check";
import type { OriginalitySignal, OriginalityPolicy } from "./contracts";
import type { LoadedProfileSet } from "./profile-loader";
import type { DistinctiveElement } from "@/lib/db/schema/template-pipeline";

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function runDeterministicDetectors(input: {
  candidate: string;
  fieldPath: string;
  profileSet: LoadedProfileSet;
  policy: OriginalityPolicy;
}): OriginalitySignal[] {
  const signals: OriginalitySignal[] = [];
  const { candidate, fieldPath, profileSet, policy } = input;

  // Source-free — only baseline blocklist
  if (profileSet.scope === "source-free") {
    return runBaselineBlocklist(candidate, fieldPath);
  }

  const normalized = normalizeText(candidate);
  const shingles5 = computeWordShingles(normalized, 5);
  const shingles8 = computeWordShingles(normalized, 8);
  const hashed5 = new Set([...shingles5].map(sha256Text));
  const hashed8 = new Set([...shingles8].map(sha256Text));

  // -----------------------------------------------------------------------
  // 1. Hashed n-gram containment against every chunk
  // -----------------------------------------------------------------------
  for (const profile of profileSet.profiles) {
    for (const chunk of profile.chunks) {
      const score5 = containment(hashed5, chunk.shingles5);
      const score8 = containment(hashed8, chunk.shingles8);
      const maxScore = Math.max(score5, score8);

      if (maxScore > policy.lexicalContainmentThreshold) {
        signals.push({
          detector: "hashed_ngram",
          strength: "strong",
          riskElementIds: [],
          score: maxScore,
          threshold: policy.lexicalContainmentThreshold,
          fieldPath,
        });
        break;
      }
    }
    if (signals.some((s) => s.detector === "hashed_ngram")) break;
  }

  // -----------------------------------------------------------------------
  // 2. Protected element rules
  // -----------------------------------------------------------------------
  const normalizedLower = normalized.toLowerCase();

  for (const profile of profileSet.profiles) {
    for (const element of profile.elements) {
      // Skip low-confidence elements
      if (element.confidence < policy.profileElementConfidenceThreshold)
        continue;

      const isStrong =
        element.distinctiveness >= policy.strongDistinctivenessThreshold;
      const strength: OriginalitySignal["strength"] =
        isStrong ? "strong" : "probabilistic";
      const labels = [element.canonicalLabel, ...element.aliases].map((l) =>
        l.toLowerCase().trim(),
      );

      switch (element.kind) {
        case "coined_term":
        case "named_framework": {
          for (const label of labels) {
            if (normalizedLower.includes(label)) {
              signals.push({
                detector:
                  element.kind === "coined_term"
                    ? "coined_term"
                    : "named_framework",
                strength,
                riskElementIds: [element.id],
                fieldPath,
              });
              break;
            }
          }
          break;
        }
        case "metaphor":
        case "anecdote":
        case "example":
        case "creative_sequence": {
          // Only fire at high distinctiveness
          if (
            element.distinctiveness < policy.strongDistinctivenessThreshold
          )
            break;
          for (const label of labels) {
            if (normalizedLower.includes(label)) {
              signals.push({
                detector: "distinctive_alias",
                strength,
                riskElementIds: [element.id],
                fieldPath,
              });
              break;
            }
          }
          break;
        }
        case "entity": {
          // Individual entities collected — may be upgraded to sequence below
          for (const label of labels) {
            if (normalizedLower.includes(label)) {
              signals.push({
                detector: "entity_sequence",
                strength: "probabilistic",
                riskElementIds: [element.id],
                fieldPath,
              });
              break;
            }
          }
          break;
        }
        case "formula":
        case "number": {
          // Individual matches collected — may be upgraded to pair below
          for (const label of labels) {
            if (normalizedLower.includes(label)) {
              signals.push({
                detector: "formula_number",
                strength: "probabilistic",
                riskElementIds: [element.id],
                fieldPath,
              });
              break;
            }
          }
          break;
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // 3. Entity sequence: ≥2 distinct matched entity IDs → one strong signal
  // -----------------------------------------------------------------------
  const entitySignals = signals.filter(
    (s) => s.detector === "entity_sequence",
  );
  if (entitySignals.length >= 2) {
    const uniqueIds = new Set(entitySignals.map((s) => s.riskElementIds[0]));
    if (uniqueIds.size >= 2) {
      // Remove individual entity signals, emit combined strong signal
      for (let i = signals.length - 1; i >= 0; i--) {
        if (signals[i].detector === "entity_sequence") signals.splice(i, 1);
      }
      signals.push({
        detector: "entity_sequence",
        strength: "strong",
        riskElementIds: [...uniqueIds],
        fieldPath,
      });
    } else {
      // Fewer than 2 distinct entities — remove all entity signals
      for (let i = signals.length - 1; i >= 0; i--) {
        if (signals[i].detector === "entity_sequence") signals.splice(i, 1);
      }
    }
  } else if (entitySignals.length === 1) {
    // Single entity — too weak, remove
    for (let i = signals.length - 1; i >= 0; i--) {
      if (signals[i].detector === "entity_sequence") signals.splice(i, 1);
    }
  }

  // -----------------------------------------------------------------------
  // 4. Formula+number pair: ≥1 formula + ≥1 number → one strong signal
  // -----------------------------------------------------------------------
  const formulaSignals = signals.filter(
    (s) => s.detector === "formula_number",
  );
  if (formulaSignals.length > 0) {
    const matchedIds = new Set(
      formulaSignals.map((s) => s.riskElementIds[0]),
    );
    const matchedElements = profileSet.profiles
      .flatMap((p) => p.elements)
      .filter((e) => matchedIds.has(e.id));
    const hasFormula = matchedElements.some((e) => e.kind === "formula");
    const hasNumber = matchedElements.some((e) => e.kind === "number");

    if (hasFormula && hasNumber) {
      // Combine into one strong signal
      for (let i = signals.length - 1; i >= 0; i--) {
        if (signals[i].detector === "formula_number") signals.splice(i, 1);
      }
      signals.push({
        detector: "formula_number",
        strength: "strong",
        riskElementIds: [...matchedIds],
        fieldPath,
      });
    } else {
      // Single kind alone — not strong enough
      for (let i = signals.length - 1; i >= 0; i--) {
        if (signals[i].detector === "formula_number") signals.splice(i, 1);
      }
    }
  }

  // -----------------------------------------------------------------------
  // 5. Baseline blocklist (always runs)
  // -----------------------------------------------------------------------
  signals.push(...runBaselineBlocklist(candidate, fieldPath));

  return signals;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Containment score: fraction of candidate hashed shingles present in the
 * source shingle set.
 */
function containment(
  candidate: Set<string>,
  source: Set<string>,
): number {
  if (candidate.size === 0) return 0;
  let matches = 0;
  for (const hash of candidate) {
    if (source.has(hash)) matches += 1;
  }
  return matches / candidate.size;
}

/**
 * Run the baseline copyright blocklist against the candidate.
 * Returns a signal if the blocklist matches.
 */
function runBaselineBlocklist(
  candidate: string,
  fieldPath: string,
): OriginalitySignal[] {
  try {
    assertOriginalEnough(candidate, {
      stage: "metaprompt-block",
      throwOnFail: true,
    });
  } catch {
    return [
      {
        detector: "baseline_blocklist",
        strength: "strong",
        riskElementIds: [],
        fieldPath,
      },
    ];
  }
  return [];
}
