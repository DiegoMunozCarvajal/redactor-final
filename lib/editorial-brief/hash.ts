import { createHash } from "crypto";
import type { EditorialBundle } from "./schema";

/**
 * Canonical JSON stringify with sorted object keys.
 *
 * Uses a deterministic algorithm so that the same logical object always
 * produces the same string regardless of property insertion order.
 */
function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const items = value.map(canonicalStringify);
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
      a.chapterId.localeCompare(b.chapterId),
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
