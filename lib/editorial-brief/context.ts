import { getEditorialBriefBundle, getApprovedEditorialBriefBundle } from "./repository";
import type { EditorialBundle, EditorialSnapshot } from "./schema";
import type { DB } from "./repository";
export { renderEditorialData } from "./render";

/**
 * Load an editorial bundle from the database.
 *
 * If `briefId` is provided, loads that exact version (with optional hash
 * verification). Otherwise loads the currently approved brief for the project.
 *
 * Accepts an optional DB context (transaction or test db instance) so callers
 * inside transactions can read their own uncommitted writes.
 *
 * Returns `null` when no matching brief exists.
 * Throws when `expectedHash` is provided and does not match.
 */
export async function loadEditorialBundle(
  params: {
    projectId: string;
    briefId?: string;
    expectedHash?: string;
  },
  ctx?: DB,
): Promise<EditorialBundle | null> {
  const { projectId, briefId, expectedHash } = params;

  if (briefId) {
    return getEditorialBriefBundle({ projectId, briefId, expectedHash }, ctx);
  }

  return getApprovedEditorialBriefBundle(projectId, ctx);
}

/**
 * Extract an immutable snapshot from a bundle.
 *
 * The snapshot captures the exact id, version, and hash so that generation
 * metadata records which brief was used, preventing version drift between
 * queuing and execution.
 */
export function snapshotFromBundle(bundle: EditorialBundle): EditorialSnapshot {
  return {
    editorialBriefId: bundle.id,
    editorialBriefVersion: bundle.version,
    editorialBriefHash: bundle.hash,
  };
}

/**
 * Convert an EditorialSnapshot to a flat object suitable for JSONB metadata.
 *
 * Returns the same shape as generation metadata fields so callers can spread
 * the result directly into a chapter generation's metadata.
 */
export function metadataFromSnapshot(
  snapshot: EditorialSnapshot,
): {
  editorialBriefId: string;
  editorialBriefVersion: number;
  editorialBriefHash: string;
} {
  return {
    editorialBriefId: snapshot.editorialBriefId,
    editorialBriefVersion: snapshot.editorialBriefVersion,
    editorialBriefHash: snapshot.editorialBriefHash,
  };
}

/**
 * Reconstruct an EditorialSnapshot from stored generation metadata.
 *
 * Legacy rows (before editorial briefs existed) have null or undefined
 * metadata fields. This function returns `null` for those rows, allowing
 * callers to branch: null → legacy path, snapshot → versioned path.
 */
export function snapshotFromGenerationMetadata(metadata: {
  editorialBriefId?: string | null;
  editorialBriefVersion?: number | null;
  editorialBriefHash?: string | null;
}): EditorialSnapshot | null {
  const { editorialBriefId, editorialBriefVersion, editorialBriefHash } =
    metadata;

  if (!editorialBriefId || !editorialBriefVersion || !editorialBriefHash) {
    return null;
  }

  return {
    editorialBriefId,
    editorialBriefVersion,
    editorialBriefHash,
  };
}
