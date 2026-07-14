import { describe, expect, it } from "vitest";
import { hashEditorialBundle } from "../hash";
import {
  assertExpectedEditorialBriefHash,
  hashEditorialContract,
  verifyStoredEditorialBundle,
  type StoredEditorialBundle,
} from "../integrity";
import {
  EditorialBriefExpectedHashFormatError,
  EditorialBriefExpectedHashMismatchError,
  EditorialBriefIntegrityError,
} from "../errors";
import { editorialBriefBundleInputSchema } from "../schema";
import {
  createTestChapterContract,
  createTestEditorialBundle,
  TEST_BRIEF_ID,
  TEST_CHAPTER_1_ID,
  TEST_CHAPTER_2_ID,
} from "./fixtures";

function createStoredBundle(): StoredEditorialBundle {
  const sourceIds = [
    "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  ];
  const contracts = [
    createTestChapterContract(TEST_CHAPTER_1_ID),
    createTestChapterContract(TEST_CHAPTER_2_ID),
  ];
  const candidate = createTestEditorialBundle({
    id: TEST_BRIEF_ID,
    version: 3,
    contracts,
    evidenceSourceIds: sourceIds,
  });
  const contentHash = hashEditorialBundle(candidate);

  return {
    brief: {
      id: candidate.id,
      version: candidate.version,
      content: candidate.content,
      contentHash,
    },
    contracts: contracts.map((content) => ({
      chapterId: content.chapterId,
      content,
      contentHash: hashEditorialContract(content),
    })),
    evidenceSourceIds: sourceIds,
  };
}

describe("stored editorial bundle integrity", () => {
  it("rejects invalid global brief JSON", () => {
    const stored = createStoredBundle();
    stored.brief.content = { invalid: true };

    expect(() => verifyStoredEditorialBundle(stored)).toThrow(
      "brief content failed schema validation",
    );
    expect(() => verifyStoredEditorialBundle(stored)).toThrowError(
      EditorialBriefIntegrityError,
    );
  });

  it("rejects a corrupt contract hash as an integrity error", () => {
    const stored = createStoredBundle();
    stored.contracts[0].contentHash = "0".repeat(64);

    expect(() => verifyStoredEditorialBundle(stored)).toThrowError(
      EditorialBriefIntegrityError,
    );
  });

  it("rejects invalid contract JSON as an integrity error", () => {
    const stored = createStoredBundle();
    stored.contracts[0].content = {
      ...(stored.contracts[0].content as Record<string, unknown>),
      jobToBeDone: "",
    };
    stored.contracts[0].contentHash = hashEditorialContract(
      stored.contracts[0].content,
    );

    expect(() => verifyStoredEditorialBundle(stored)).toThrowError(
      EditorialBriefIntegrityError,
    );
  });

  it("rejects contract row/content chapter mismatches", () => {
    const stored = createStoredBundle();
    stored.contracts[0].chapterId = TEST_CHAPTER_2_ID;

    expect(() => verifyStoredEditorialBundle(stored)).toThrow(
      "contract chapterId mismatch",
    );
    expect(() => verifyStoredEditorialBundle(stored)).toThrowError(
      EditorialBriefIntegrityError,
    );
  });

  it("rejects a corrupt composite hash", () => {
    const stored = createStoredBundle();
    stored.brief.contentHash = "0".repeat(64);

    expect(() => verifyStoredEditorialBundle(stored)).toThrow(
      "Editorial brief content hash mismatch",
    );
    expect(() => verifyStoredEditorialBundle(stored)).toThrowError(
      EditorialBriefIntegrityError,
    );
  });

  it("verifies normalized uppercase UUID input after persistence", () => {
    const chapterId = "A1B2C3D4-E5F6-4A7B-8C9D-A1B2C3D4E5F6";
    const sourceId = "B1B2C3D4-E5F6-4A7B-8C9D-A1B2C3D4E5F6";
    const parsed = editorialBriefBundleInputSchema.parse({
      content: createStoredBundle().brief.content,
      contracts: [createTestChapterContract(chapterId)],
      evidenceSourceIds: [sourceId],
    });
    const candidate = createTestEditorialBundle({
      version: 4,
      content: parsed.content,
      contracts: parsed.contracts,
      evidenceSourceIds: parsed.evidenceSourceIds,
    });
    const stored: StoredEditorialBundle = {
      brief: {
        id: candidate.id,
        version: candidate.version,
        content: parsed.content,
        contentHash: hashEditorialBundle(candidate),
      },
      contracts: parsed.contracts.map((content) => ({
        chapterId: content.chapterId,
        content,
        contentHash: hashEditorialContract(content),
      })),
      evidenceSourceIds: parsed.evidenceSourceIds,
    };

    const verified = verifyStoredEditorialBundle(stored);
    expect(verified.contracts[0].chapterId).toBe(chapterId.toLowerCase());
    expect(verified.evidenceSourceIds).toEqual([sourceId.toLowerCase()]);
  });

  it("returns the recomputed hash and deterministic source ids", () => {
    const stored = createStoredBundle();
    const bundle = verifyStoredEditorialBundle(stored);

    expect(bundle.hash).toBe(stored.brief.contentHash);
    expect(bundle.evidenceSourceIds).toEqual([
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    ]);
  });

  it("accepts the verified expected hash", () => {
    const bundle = verifyStoredEditorialBundle(createStoredBundle());

    expect(assertExpectedEditorialBriefHash(bundle, bundle.hash)).toBe(bundle);
  });

  it("rejects a wrong expected hash after verification", () => {
    const bundle = verifyStoredEditorialBundle(createStoredBundle());

    expect(() =>
      assertExpectedEditorialBriefHash(bundle, "f".repeat(64)),
    ).toThrowError(EditorialBriefExpectedHashMismatchError);
  });

  it.each(["", "short", "A".repeat(64)])(
    "rejects invalid expected hash format %j",
    (expectedHash) => {
      const bundle = verifyStoredEditorialBundle(createStoredBundle());

      expect(() =>
        assertExpectedEditorialBriefHash(bundle, expectedHash),
      ).toThrowError(EditorialBriefExpectedHashFormatError);
    },
  );

  it("allows an omitted expected hash", () => {
    const bundle = verifyStoredEditorialBundle(createStoredBundle());

    expect(assertExpectedEditorialBriefHash(bundle, undefined)).toBe(bundle);
  });
});
