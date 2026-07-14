/**
 * Staleness computation for editorial brief version tracking.
 *
 * Compares a generation's stored editorial brief snapshot against the
 * currently approved brief to determine whether the generation was
 * produced with a current, legacy, stale, or invalid brief reference.
 */

export type StalenessStatus = "current" | "legacy" | "stale" | "invalid";

/**
 * Compute the staleness status of a generation relative to the active brief.
 *
 * @param genSnapshot - The editorial brief snapshot stored in the generation's
 *   metadata (nullable partial — legacy or missing rows).
 * @param activeBrief - The currently approved editorial brief summary, or null
 *   when no brief has ever been approved for this project.
 *
 * States:
 * - "current"   — gen matches active brief (same hash), or no brief exists at all
 * - "legacy"    — gen predates editorial briefs (no snapshot) but a brief exists now
 * - "stale"     — gen used a brief, but a newer one has been approved (hash differs)
 * - "invalid"   — gen references a brief that no longer exists (brief was deleted)
 */
export function computeStaleness(
  genSnapshot: {
    editorialBriefId?: string | null;
    editorialBriefVersion?: number | null;
    editorialBriefHash?: string | null;
  } | null | undefined,
  activeBrief: { id: string; version: number; hash: string } | null,
): StalenessStatus {
  const hasSnapshot =
    genSnapshot != null && genSnapshot.editorialBriefHash != null;

  // No active brief exists — all generations are unversioned
  if (!activeBrief) {
    // Generation has a snapshot but no active brief → brief was deleted
    if (hasSnapshot) return "invalid";
    // No active brief and no gen snapshot → project never had a brief
    return "current";
  }

  // Active brief exists, but generation has no snapshot → predates briefs
  if (!hasSnapshot) return "legacy";

  // Both exist — compare hashes
  if (genSnapshot!.editorialBriefHash === activeBrief.hash) return "current";
  return "stale";
}
