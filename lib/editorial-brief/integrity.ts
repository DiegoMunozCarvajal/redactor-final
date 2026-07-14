import { createHash } from "crypto";
import { canonicalStringify, hashEditorialBundle } from "./hash";
import {
  chapterEditorialContractSchema,
  editorialBriefContentSchema,
  type ChapterEditorialContract,
  type EditorialBundle,
} from "./schema";

export interface StoredEditorialBundle {
  brief: {
    id: string;
    version: number;
    content: unknown;
    contentHash: string;
  };
  contracts: Array<{
    chapterId: string;
    content: unknown;
    contentHash: string;
  }>;
  evidenceSourceIds: string[];
}

export function hashEditorialContract(contract: unknown): string {
  return createHash("sha256")
    .update(canonicalStringify(contract), "utf-8")
    .digest("hex");
}

/**
 * Parse and verify a persisted brief bundle before exposing it to generation.
 */
export function verifyStoredEditorialBundle(
  stored: StoredEditorialBundle,
): EditorialBundle {
  const parsedContent = editorialBriefContentSchema.safeParse(
    stored.brief.content,
  );
  if (!parsedContent.success) {
    throw new Error(
      `Stored brief content failed schema validation for brief ${stored.brief.id}: ${parsedContent.error.message}`,
    );
  }

  const parsedContracts: ChapterEditorialContract[] = [];
  for (const row of stored.contracts) {
    const computedContractHash = hashEditorialContract(row.content);
    if (computedContractHash !== row.contentHash) {
      throw new Error(
        `Contract content hash mismatch for chapter ${row.chapterId} in brief ${stored.brief.id} (expected ${row.contentHash}, computed ${computedContractHash})`,
      );
    }

    const parsedContract = chapterEditorialContractSchema.safeParse(row.content);
    if (!parsedContract.success) {
      throw new Error(
        `Stored contract for chapter ${row.chapterId} in brief ${stored.brief.id} failed schema validation: ${parsedContract.error.message}`,
      );
    }
    if (parsedContract.data.chapterId !== row.chapterId) {
      throw new Error(
        `Stored contract chapterId mismatch in brief ${stored.brief.id}: row ${row.chapterId}, content ${parsedContract.data.chapterId}`,
      );
    }

    parsedContracts.push(parsedContract.data);
  }

  const candidate: EditorialBundle = {
    id: stored.brief.id,
    version: stored.brief.version,
    hash: "",
    content: parsedContent.data,
    contracts: parsedContracts,
    evidenceSourceIds: [...stored.evidenceSourceIds].sort(),
  };
  const computedHash = hashEditorialBundle(candidate);
  if (computedHash !== stored.brief.contentHash) {
    throw new Error(
      `Editorial brief content hash mismatch for brief ${stored.brief.id} (expected ${stored.brief.contentHash}, computed ${computedHash})`,
    );
  }

  return { ...candidate, hash: computedHash };
}

export function assertExpectedEditorialBriefHash(
  bundle: EditorialBundle,
  expectedHash?: string,
): EditorialBundle {
  if (expectedHash && bundle.hash !== expectedHash) {
    throw new Error("Editorial brief hash mismatch");
  }
  return bundle;
}
