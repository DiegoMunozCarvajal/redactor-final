import { createHash } from "crypto";
import {
  EditorialBriefExpectedHashFormatError,
  EditorialBriefExpectedHashMismatchError,
  EditorialBriefIntegrityError,
} from "./errors";
import { canonicalStringify, hashEditorialBundle } from "./hash";
import {
  chapterEditorialContractSchema,
  editorialBriefContentSchema,
  editorialBriefContentSchemaV3,
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
  // Branch on schema version — v2 uses .strict() schema that would reject v3
  // content with unknown keys (topicKnowledge, scenarioCatalog, evidenceGaps).
  const rawContent = stored.brief.content as Record<string, unknown> | null;
  const isV3 = rawContent?.schemaVersion === "3.0";

  const parsedContent = isV3
    ? editorialBriefContentSchemaV3.safeParse(stored.brief.content)
    : editorialBriefContentSchema.safeParse(stored.brief.content);
  if (!parsedContent.success) {
    throw new EditorialBriefIntegrityError(
      `Stored brief content failed schema validation for brief ${stored.brief.id}: ${parsedContent.error.message}`,
    );
  }

  const parsedContracts: ChapterEditorialContract[] = [];
  if (!isV3) {
    for (const row of stored.contracts) {
      const computedContractHash = hashEditorialContract(row.content);
      if (computedContractHash !== row.contentHash) {
        throw new EditorialBriefIntegrityError(
          `Contract content hash mismatch for chapter ${row.chapterId} in brief ${stored.brief.id} (expected ${row.contentHash}, computed ${computedContractHash})`,
        );
      }

      const parsedContract = chapterEditorialContractSchema.safeParse(row.content);
      if (!parsedContract.success) {
        throw new EditorialBriefIntegrityError(
          `Stored contract for chapter ${row.chapterId} in brief ${stored.brief.id} failed schema validation: ${parsedContract.error.message}`,
        );
      }
      if (parsedContract.data.chapterId !== row.chapterId) {
        throw new EditorialBriefIntegrityError(
          `Stored contract chapterId mismatch in brief ${stored.brief.id}: row ${row.chapterId}, content ${parsedContract.data.chapterId}`,
        );
      }

      parsedContracts.push(parsedContract.data);
    }
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
    throw new EditorialBriefIntegrityError(
      `Editorial brief content hash mismatch for brief ${stored.brief.id} (expected ${stored.brief.contentHash}, computed ${computedHash})`,
    );
  }

  return { ...candidate, hash: computedHash };
}

export function assertExpectedEditorialBriefHash(
  bundle: EditorialBundle,
  expectedHash?: string,
): EditorialBundle {
  if (expectedHash === undefined) return bundle;
  if (!/^[0-9a-f]{64}$/.test(expectedHash)) {
    throw new EditorialBriefExpectedHashFormatError();
  }
  if (bundle.hash !== expectedHash) {
    throw new EditorialBriefExpectedHashMismatchError();
  }
  return bundle;
}
