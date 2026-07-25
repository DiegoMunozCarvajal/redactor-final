// ---------------------------------------------------------------------------
// Semantic similarity detectors
//
// Runs cosine similarity checks between the candidate output and:
//   1. Each source chunk embedding (from loaded profiles)
//   2. Each risk-label embedding (from distinctive elements)
//
// These are slower than deterministic detectors but catch semantic
// paraphrasing and restructuring that bypass lexical matching.
// ---------------------------------------------------------------------------

import { generateEmbeddings } from "@/lib/ai/embeddings";
import { OriginalityDetectorUnavailableError } from "./contracts";
import { getRiskLabelEmbeddings } from "./profile-loader";
import type { OriginalitySignal, OriginalityPolicy } from "./contracts";
import type { LoadedProfileSet } from "./profile-loader";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SemanticSignals {
  sourceChunkMaxSimilarity: number;
  sourceChunkMaxChunkIndex: number;
  sourceChunkMaxProfileId: string;
  labelMaxSimilarity: number;
  labelMaxRiskElementId: string | null;
  signals: OriginalitySignal[];
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runSemanticDetectors(input: {
  candidate: string;
  fieldPath: string;
  profileSet: LoadedProfileSet;
  policy: OriginalityPolicy;
}): Promise<SemanticSignals> {
  const { candidate, fieldPath, profileSet, policy } = input;

  const signals: OriginalitySignal[] = [];
  let sourceChunkMaxSimilarity = 0;
  let sourceChunkMaxChunkIndex = -1;
  let sourceChunkMaxProfileId = "";
  let labelMaxSimilarity = 0;
  let labelMaxRiskElementId: string | null = null;

  // Source-free — no source chunks or risk labels to compare against
  if (profileSet.scope === "source-free") {
    return {
      sourceChunkMaxSimilarity: 0,
      sourceChunkMaxChunkIndex: -1,
      sourceChunkMaxProfileId: "",
      labelMaxSimilarity: 0,
      labelMaxRiskElementId: null,
      signals: [],
    };
  }

  // Embed the candidate once
  const [candidateEmbedding] = await generateEmbeddings([candidate]);
  if (!candidateEmbedding || candidateEmbedding.length !== 1536) {
    throw new OriginalityDetectorUnavailableError(
      "Failed to generate candidate embedding",
    );
  }

  // -----------------------------------------------------------------------
  // 1. Source chunk similarity — compare candidate against every chunk
  // -----------------------------------------------------------------------
  for (const profile of profileSet.profiles) {
    for (let ci = 0; ci < profile.chunks.length; ci++) {
      const chunk = profile.chunks[ci];
      const similarity = cosineSimilarity(candidateEmbedding, chunk.embedding);
      if (similarity > sourceChunkMaxSimilarity) {
        sourceChunkMaxSimilarity = similarity;
        sourceChunkMaxChunkIndex = ci;
        sourceChunkMaxProfileId = profile.id;
      }
    }
  }

  if (sourceChunkMaxSimilarity >= policy.semanticSuspectThreshold) {
    signals.push({
      detector: "source_chunk_embedding",
      strength:
        sourceChunkMaxSimilarity >= policy.semanticStrongThreshold
          ? "strong"
          : "probabilistic",
      riskElementIds: [],
      score: sourceChunkMaxSimilarity,
      threshold: policy.semanticSuspectThreshold,
      fieldPath,
    });
  }

  // -----------------------------------------------------------------------
  // 2. Risk label similarity — compare candidate against element labels
  // -----------------------------------------------------------------------
  const labelEmbeddings = await getRiskLabelEmbeddings(
    profileSet,
    policy.profileElementConfidenceThreshold,
  );

  for (const le of labelEmbeddings) {
    const similarity = cosineSimilarity(candidateEmbedding, le.embedding);
    if (similarity > labelMaxSimilarity) {
      labelMaxSimilarity = similarity;
      labelMaxRiskElementId = le.canonicalLabel;
    }
  }

  if (labelMaxSimilarity >= policy.semanticSuspectThreshold) {
    signals.push({
      detector: "risk_label_embedding",
      strength:
        labelMaxSimilarity >= policy.semanticStrongThreshold
          ? "strong"
          : "probabilistic",
      riskElementIds: labelMaxRiskElementId ? [labelMaxRiskElementId] : [],
      score: labelMaxSimilarity,
      threshold: policy.semanticSuspectThreshold,
      fieldPath,
    });
  }

  return {
    sourceChunkMaxSimilarity,
    sourceChunkMaxChunkIndex,
    sourceChunkMaxProfileId,
    labelMaxSimilarity,
    labelMaxRiskElementId,
    signals,
  };
}

// ---------------------------------------------------------------------------
// Cosine similarity
// ---------------------------------------------------------------------------

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    throw new OriginalityDetectorUnavailableError(
      "embedding dimension mismatch",
    );
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] ** 2;
    normB += b[i] ** 2;
  }

  if (normA === 0 || normB === 0) {
    throw new OriginalityDetectorUnavailableError("zero embedding");
  }

  return dot / Math.sqrt(normA * normB);
}
