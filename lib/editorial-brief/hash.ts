import { createHash } from "crypto";
import type { EditorialBundle } from "./schema";

/**
 * Canonical JSON stringify with sorted object keys.
 *
 * Uses a deterministic algorithm so that the same logical object always
 * produces the same string regardless of property insertion order.
 */
export function canonicalStringify(value: unknown): string {
  // JSON.stringify(undefined) returns the JS primitive `undefined` (not a
  // string), which would corrupt the hash payload if concatenated. Map
  // undefined to null so JSONB round-trips and optional Zod fields never
  // produce a broken hash.
  if (value === undefined) return "null";

  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    // Sort by canonical string representation so semantically identical
    // arrays produce the same hash regardless of element order.  This is
    // essential for string arrays inside EditorialBriefContent (mechanism,
    // tone, avoid, pillars, etc.) where LLM output ordering is unstable.
    const items = value.map(canonicalStringify).sort();
    return `[${items.join(",")}]`;
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const pairs = keys.map(
    (k) => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`,
  );
  return `{${pairs.join(",")}}`;
}

/**
 * Build the canonical payload for hashing.
 *
 * - Content is included as-is (key ordering is handled by canonicalStringify).
 * - Contracts are sorted by chapterId so contract order does not affect the hash.
 * - Evidence source ids are sorted so insertion order does not affect the hash.
 */
function buildCanonicalPayload(bundle: EditorialBundle): {
  content: unknown;
  contracts: unknown[];
  evidenceSourceIds: string[];
} {
  return {
    content: bundle.content,
    contracts: [...bundle.contracts].sort((a, b) =>
      a.chapterId.localeCompare(b.chapterId, "en"),
    ),
    evidenceSourceIds: [...bundle.evidenceSourceIds].sort(),
  };
}

/**
 * Compute a stable SHA-256 hash of an EditorialBundle.
 *
 * The hash is based on:
 * - The editorial brief content (all fields)
 * - All chapter contracts (sorted by chapterId)
 * - All evidence source ids (sorted)
 *
 * Key ordering inside objects does not affect the hash (canonical serialization).
 * Contract ordering does not affect the hash (sorted by chapterId).
 * The bundle's own `id`, `version`, and `hash` fields are NOT included in the
 * canonical payload.
 */
export function hashEditorialBundle(bundle: EditorialBundle): string {
  const payload = buildCanonicalPayload(bundle);
  const json = canonicalStringify(payload);

  return createHash("sha256").update(json, "utf-8").digest("hex");
}
