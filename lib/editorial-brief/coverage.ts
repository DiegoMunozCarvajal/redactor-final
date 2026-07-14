import {
  EditorialBriefChapterCoverageError,
} from "./errors";
import type { ChapterEditorialContract } from "./schema";

/**
 * Assert that contract chapter IDs cover every current project chapter
 * exactly once — no missing, no extra, no duplicates.
 */
export function assertExactChapterCoverage(
  contractChapterIds: string[],
  currentChapterIds: string[],
): void {
  const currentSet = new Set(currentChapterIds);

  // Detect extras (not in current project chapters) — deduplicate
  const extraSet = new Set<string>();
  for (const id of contractChapterIds) {
    if (!currentSet.has(id)) {
      extraSet.add(id);
    }
  }
  const extraChapterIds = [...extraSet];

  // Detect duplicates within the contract list
  const seen = new Set<string>();
  const duplicateChapterIds: string[] = [];
  for (const id of contractChapterIds) {
    if (seen.has(id)) {
      duplicateChapterIds.push(id);
    } else {
      seen.add(id);
    }
  }

  // Detect missing (in current project but not in contracts)
  const contractSet = new Set(contractChapterIds);
  const missingChapterIds = currentChapterIds.filter(
    (id) => !contractSet.has(id),
  );

  if (
    missingChapterIds.length > 0 ||
    extraChapterIds.length > 0 ||
    duplicateChapterIds.length > 0
  ) {
    throw new EditorialBriefChapterCoverageError({
      missingChapterIds,
      extraChapterIds,
      duplicateChapterIds,
    });
  }
}

/**
 * Reconcile contracts from a cloned brief against current chapter order.
 *
 * Existing contracts: kept in new chapter order (matched by chapterId).
 * Historical chapters: contracts for chapters no longer in the project are dropped.
 * New chapters: `createContract` factory called for chapters without a matching old contract.
 */
export function reconcileChapterContracts(
  currentChapterIds: string[],
  oldContracts: ChapterEditorialContract[],
  createContract: (chapterId: string) => ChapterEditorialContract,
): ChapterEditorialContract[] {
  const oldByChapterId = new Map(
    oldContracts.map((c) => [c.chapterId, c]),
  );

  return currentChapterIds.map((chapterId) => {
    const existing = oldByChapterId.get(chapterId);
    return existing ?? createContract(chapterId);
  });
}

/**
 * Create a minimal empty contract for a chapter that has no matching old contract.
 */
export function createEmptyContract(
  chapterId: string,
): ChapterEditorialContract {
  return {
    chapterId,
    jobToBeDone: "-",
    readerShift: "-",
    mustCover: ["-"],
    requiredScenarios: ["-"],
    evidenceNeeds: [{ placeholderName: "tema", query: "-", required: false }],
    toneAdjustment: "-",
    avoidOverlapWith: ["-"],
    transitionToNext: "-",
  };
}
