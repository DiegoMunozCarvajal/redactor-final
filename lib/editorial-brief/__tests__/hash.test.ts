import { describe, it, expect } from "vitest";
import { canonicalStringify, hashEditorialBundle } from "../hash";
import {
  createTestEditorialBundle,
  createTestChapterContract,
  TEST_CHAPTER_1_ID,
  TEST_CHAPTER_2_ID,
} from "./fixtures";
import type { EditorialBundle } from "../schema";

describe("hashEditorialBundle", () => {
  it("produces a 64-character hex string", () => {
    const bundle = createTestEditorialBundle();
    const hash = hashEditorialBundle(bundle);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable for the same bundle", () => {
    const bundle = createTestEditorialBundle();
    const hash1 = hashEditorialBundle(bundle);
    const hash2 = hashEditorialBundle(bundle);
    expect(hash1).toBe(hash2);
  });

  it("is stable regardless of key ordering in the plain object", () => {
    const bundle = createTestEditorialBundle();

    // Create a copy with keys in different insertion order
    const reordered: EditorialBundle = {
      hash: bundle.hash,
      version: bundle.version,
      content: bundle.content,
      id: bundle.id,
      contracts: bundle.contracts,
      evidenceSourceIds: bundle.evidenceSourceIds,
    };

    expect(hashEditorialBundle(bundle)).toBe(hashEditorialBundle(reordered));
  });

  it("is stable regardless of nested object key ordering", () => {
    expect(
      canonicalStringify({ outer: { second: 2, first: 1 } }),
    ).toBe(canonicalStringify({ outer: { first: 1, second: 2 } }));
  });

  it("changes when a nested editorial array is reordered", () => {
    const bundle = createTestEditorialBundle();
    const reordered = createTestEditorialBundle({
      content: {
        thesis: {
          mechanism: [...bundle.content.thesis.mechanism].reverse(),
        },
      },
    });

    expect(hashEditorialBundle(bundle)).not.toBe(
      hashEditorialBundle(reordered),
    );
  });

  it("is stable regardless of contract order", () => {
    const bundle = createTestEditorialBundle();

    // Contracts in reverse order
    const reversedContracts = [
      createTestChapterContract(TEST_CHAPTER_2_ID),
      createTestChapterContract(TEST_CHAPTER_1_ID),
    ];
    const reversed = createTestEditorialBundle({
      contracts: reversedContracts,
    });

    expect(hashEditorialBundle(bundle)).toBe(
      hashEditorialBundle(reversed),
    );
  });

  it("changes when content changes", () => {
    const bundle = createTestEditorialBundle();
    const changed = createTestEditorialBundle({
      content: { thesis: { promise: "A different promise" } },
    });
    expect(hashEditorialBundle(bundle)).not.toBe(
      hashEditorialBundle(changed),
    );
  });

  it("changes when evidence source ids change", () => {
    const bundle = createTestEditorialBundle();
    const changed = createTestEditorialBundle({
      evidenceSourceIds: [
        "55555555-5555-5555-5555-555555555555",
      ],
    });
    expect(hashEditorialBundle(bundle)).not.toBe(
      hashEditorialBundle(changed),
    );
  });

  it("changes when a single contract changes", () => {
    const bundle = createTestEditorialBundle();
    const changedContract = createTestChapterContract(TEST_CHAPTER_1_ID, {
      jobToBeDone: "Changed job description",
    });
    const changed = createTestEditorialBundle({
      contracts: [changedContract, createTestChapterContract(TEST_CHAPTER_2_ID)],
    });
    expect(hashEditorialBundle(bundle)).not.toBe(
      hashEditorialBundle(changed),
    );
  });

  it("changes when contracts are added", () => {
    const bundle = createTestEditorialBundle({
      contracts: [createTestChapterContract(TEST_CHAPTER_1_ID)],
    });
    const extended = createTestEditorialBundle({
      contracts: [
        createTestChapterContract(TEST_CHAPTER_1_ID),
        createTestChapterContract(TEST_CHAPTER_2_ID),
      ],
    });
    expect(hashEditorialBundle(bundle)).not.toBe(
      hashEditorialBundle(extended),
    );
  });

  it("changes when evidence source ids are reordered (sorted, so should be same — actually sorted so it won't change)", () => {
    // This test proves that evidenceSourceIds sorted order = same hash
    const bundleA = createTestEditorialBundle({
      evidenceSourceIds: [
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      ],
    });
    const bundleB = createTestEditorialBundle({
      evidenceSourceIds: [
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      ],
    });
    expect(hashEditorialBundle(bundleA)).toBe(
      hashEditorialBundle(bundleB),
    );
  });
});
