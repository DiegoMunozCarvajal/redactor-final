// ---------------------------------------------------------------------------
// Profile Loader
//
// Loads private source profiles from the authorized active pipeline run,
// verifies hash integrity, caches risk-label embeddings, and returns an
// immutable empty set for source-free scope.
// Server-only — never export from client-reachable barrels.
// ---------------------------------------------------------------------------

import { db } from "@/lib/db";
import { templateSourceProfiles, templateSourceProfileChunks } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { sha256Canonical, EMPTY_SOURCE_PROFILE_SET_HASH } from "@/lib/template-pipeline/hash";
import { generateEmbeddings } from "@/lib/ai/embeddings";
import { OriginalityDetectorUnavailableError } from "./contracts";
import type { GenerationAuthorization } from "@/lib/template-pipeline/contracts";
import type { DistinctiveElement } from "@/lib/db/schema/template-pipeline";

// ---------------------------------------------------------------------------
// Server-only type — never export from client-reachable barrels
// ---------------------------------------------------------------------------

export interface LoadedProfileSet {
  scope: "template" | "source-free";
  pipelineRunId: string | null;
  profileSetHash: string;
  profiles: LoadedProfile[];
}

export interface LoadedProfile {
  id: string;
  profileHash: string;
  elements: DistinctiveElement[];
  chunks: LoadedChunk[];
}

export interface LoadedChunk {
  contentHash: string;
  shingles5: Set<string>;
  shingles8: Set<string>;
  embedding: number[];
}

// ---------------------------------------------------------------------------
// Risk label embedding cache
// ---------------------------------------------------------------------------

interface LabelEmbeddingEntry {
  labelText: string;
  model: string;
  embedding: number[];
}

const labelEmbeddingCache = new Map<string, Promise<LabelEmbeddingEntry[]>>();

// ---------------------------------------------------------------------------
// Main loader
// ---------------------------------------------------------------------------

export async function loadOriginalityProfileSet(
  authorization: GenerationAuthorization,
): Promise<LoadedProfileSet> {
  if (authorization.scope === "source-free") {
    return {
      scope: "source-free",
      pipelineRunId: null,
      profileSetHash: EMPTY_SOURCE_PROFILE_SET_HASH,
      profiles: [],
    };
  }

  // Load profiles from the active pipeline run only
  const profiles = await db
    .select({
      id: templateSourceProfiles.id,
      profileHash: templateSourceProfiles.profileHash,
      elements: templateSourceProfiles.distinctiveElements,
    })
    .from(templateSourceProfiles)
    .where(eq(templateSourceProfiles.pipelineRunId, authorization.pipelineRunId));

  if (profiles.length === 0) {
    throw new OriginalityDetectorUnavailableError(
      `No source profiles found for run ${authorization.pipelineRunId}`,
    );
  }

  // Load chunks for each profile
  const loadedProfiles: LoadedProfile[] = [];
  for (const profile of profiles) {
    const chunkRows = await db
      .select({
        contentHash: templateSourceProfileChunks.contentHash,
        lexicalFingerprint: templateSourceProfileChunks.lexicalFingerprint,
        embedding: templateSourceProfileChunks.embedding,
      })
      .from(templateSourceProfileChunks)
      .where(eq(templateSourceProfileChunks.sourceProfileId, profile.id))
      .orderBy(templateSourceProfileChunks.chunkIndex);

    if (chunkRows.length === 0) {
      throw new OriginalityDetectorUnavailableError(
        `No chunks found for profile ${profile.id}`,
      );
    }

    loadedProfiles.push({
      id: profile.id,
      profileHash: profile.profileHash,
      elements: profile.elements as unknown as DistinctiveElement[],
      chunks: chunkRows.map((row) => ({
        contentHash: row.contentHash,
        shingles5: new Set(
          (row.lexicalFingerprint as Record<string, string[]>).shingles5 ?? [],
        ),
        shingles8: new Set(
          (row.lexicalFingerprint as Record<string, string[]>).shingles8 ?? [],
        ),
        embedding:
          typeof row.embedding === "string"
            ? JSON.parse(row.embedding)
            : (row.embedding as unknown as number[]),
      })),
    });
  }

  // Compute profile-set hash and verify against authorization
  const profileSetHash = sha256Canonical(
    loadedProfiles.map((p) => p.profileHash).sort(),
  );

  if (!timingSafeEqual(profileSetHash, authorization.sourceProfileSetHash)) {
    throw new OriginalityDetectorUnavailableError(
      `Profile set hash mismatch for run ${authorization.pipelineRunId}`,
    );
  }

  return {
    scope: "template",
    pipelineRunId: authorization.pipelineRunId,
    profileSetHash,
    profiles: loadedProfiles,
  };
}

// ---------------------------------------------------------------------------
// Risk-label embedding cache
// ---------------------------------------------------------------------------

export interface LabelEmbeddingResult {
  canonicalLabel: string;
  embedding: number[];
}

export async function getRiskLabelEmbeddings(
  profileSet: LoadedProfileSet,
  confidenceThreshold: number,
): Promise<LabelEmbeddingResult[]> {
  if (profileSet.scope === "source-free" || profileSet.profiles.length === 0) {
    return [];
  }

  const profileHash = profileSet.profileSetHash;

  // Collect labels/aliases above threshold
  const labels = new Map<string, string>();
  for (const profile of profileSet.profiles) {
    for (const element of profile.elements) {
      if (element.confidence < confidenceThreshold) continue;
      labels.set(element.id, element.canonicalLabel);
      for (const alias of element.aliases) {
        if (!labels.has(alias)) labels.set(alias, alias);
      }
    }
  }

  if (labels.size === 0) return [];

  const labelTexts = [...labels.values()];

  // Cache key
  const cacheKey = `${profileHash}::openai`;
  const existing = labelEmbeddingCache.get(cacheKey);
  if (existing) {
    const entries = await existing;
    return entries.map((e) => ({
      canonicalLabel: e.labelText,
      embedding: e.embedding,
    }));
  }

  // Generate embeddings with dedup promise
  const promise = (async () => {
    const embeddings = await generateEmbeddings(labelTexts);
    if (embeddings.length !== labelTexts.length) {
      throw new OriginalityDetectorUnavailableError(
        `Label embedding count mismatch: ${embeddings.length} vs ${labelTexts.length}`,
      );
    }
    return labelTexts.map((label, i) => ({
      labelText: label,
      model: "openai",
      embedding: embeddings[i],
    }));
  })();

  labelEmbeddingCache.set(cacheKey, promise);

  try {
    const entries = await promise;
    return entries.map((e) => ({
      canonicalLabel: e.labelText,
      embedding: e.embedding,
    }));
  } catch (err) {
    labelEmbeddingCache.delete(cacheKey);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Timing-safe comparison
// ---------------------------------------------------------------------------

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
