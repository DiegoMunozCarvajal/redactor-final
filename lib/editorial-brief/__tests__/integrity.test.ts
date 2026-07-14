import { createHash } from "crypto";
import { describe, expect, it } from "vitest";
import { canonicalStringify, hashEditorialBundle } from "../hash";
import {
  assertExpectedEditorialBriefHash,
  verifyStoredEditorialBundle,
  type StoredEditorialBundle,
} from "../integrity";
import {
  createTestChapterContract,
  createTestEditorialBundle,
  TEST_BRIEF_ID,
  TEST_CHAPTER_1_ID,
  TEST_CHAPTER_2_ID,
} from "./fixtures";

function hashContract(content: unknown): string {
  return createHash("sha256")
    .update(canonicalStringify(content), "utf-8")
    .digest("hex");
}

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
      contentHash: hashContract(content),
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
  });

  it("rejects contract row/content chapter mismatches", () => {
    const stored = createStoredBundle();
    stored.contracts[0].chapterId = TEST_CHAPTER_2_ID;

    expect(() => verifyStoredEditorialBundle(stored)).toThrow(
      "contract chapterId mismatch",
    );
  });

  it("rejects a corrupt composite hash", () => {
    const stored = createStoredBundle();
    stored.brief.contentHash = "0".repeat(64);

    expect(() => verifyStoredEditorialBundle(stored)).toThrow(
      "Editorial brief content hash mismatch",
    );
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
    ).toThrow("Editorial brief hash mismatch");
  });
});
