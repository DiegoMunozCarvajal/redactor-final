import { describe, expect, it } from "vitest";
import {
  assertExactChapterCoverage,
  reconcileChapterContracts,
} from "../coverage";
import { EditorialBriefChapterCoverageError } from "../errors";
import { createTestChapterContract } from "./fixtures";

const CHAPTER_1 = "10000000-0000-4000-8000-000000000001";
const CHAPTER_2 = "10000000-0000-4000-8000-000000000002";
const CHAPTER_3 = "10000000-0000-4000-8000-000000000003";

describe("editorial brief chapter coverage", () => {
  it("accepts every current chapter exactly once", () => {
    expect(() =>
      assertExactChapterCoverage(
        [CHAPTER_2, CHAPTER_1],
        [CHAPTER_1, CHAPTER_2],
      ),
    ).not.toThrow();
  });

  it("reports missing chapters", () => {
    expect(() =>
      assertExactChapterCoverage([CHAPTER_1], [CHAPTER_1, CHAPTER_2]),
    ).toThrowError(
      expect.objectContaining<Partial<EditorialBriefChapterCoverageError>>({
        name: "EditorialBriefChapterCoverageError",
        missingChapterIds: [CHAPTER_2],
        extraChapterIds: [],
        duplicateChapterIds: [],
      }),
    );
  });

  it("reports extra and duplicate chapters", () => {
    expect(() =>
      assertExactChapterCoverage(
        [CHAPTER_1, CHAPTER_3, CHAPTER_3],
        [CHAPTER_1, CHAPTER_2],
      ),
    ).toThrowError(
      expect.objectContaining<Partial<EditorialBriefChapterCoverageError>>({
        missingChapterIds: [CHAPTER_2],
        extraChapterIds: [CHAPTER_3],
        duplicateChapterIds: [CHAPTER_3],
      }),
    );
  });

  it("reconciles a cloned brief to current chapter order", () => {
    const oldContract = createTestChapterContract(CHAPTER_1, {
      jobToBeDone: "Preserve me",
    });
    const historicalContract = createTestChapterContract(CHAPTER_3);

    const reconciled = reconcileChapterContracts(
      [CHAPTER_2, CHAPTER_1],
      [oldContract, historicalContract],
      (chapterId) =>
        createTestChapterContract(chapterId, { jobToBeDone: "New chapter" }),
    );

    expect(reconciled.map((contract) => contract.chapterId)).toEqual([
      CHAPTER_2,
      CHAPTER_1,
    ]);
    expect(reconciled[0].jobToBeDone).toBe("New chapter");
    expect(reconciled[1]).toBe(oldContract);
    expect(reconciled).not.toContain(historicalContract);
  });
});
