import { describe, expect, it, vi } from "vitest";

const { getRunWithUnitsMock } = vi.hoisted(() => ({
  getRunWithUnitsMock: vi.fn(),
}));

vi.mock("@/lib/db/queries/runs", () => ({
  getRunWithUnits: getRunWithUnitsMock,
}));

describe("renderRunMarkdown", () => {
  it("exports only chapter units when section rows are present", async () => {
    getRunWithUnitsMock.mockResolvedValue({
      id: "run-1",
      productMode: "small_book",
      units: [
        {
          sortOrder: 1,
          unitType: "chapter",
          parentUnitId: null,
          brief: { chapterTitle: "Presence" },
          revised: { markdown: "## Chapter Body\n\nCHAPTER_MARKER" },
          draft: null,
        },
        {
          sortOrder: 1,
          unitType: "chapter",
          parentUnitId: "chapter-1",
          brief: null,
          revised: { markdown: "## Child Chapter\n\nCHILD_CHAPTER_MARKER" },
          draft: null,
        },
        {
          sortOrder: 1,
          unitType: "section",
          parentUnitId: "chapter-1",
          brief: null,
          revised: null,
          draft: { markdown: "## Section\n\nSECTION_MARKER" },
        },
      ],
    });

    const { renderRunMarkdown } = await import("./markdown");
    const markdown = await renderRunMarkdown("run-1");

    expect(markdown).toContain("CHAPTER_MARKER");
    expect(markdown).not.toContain("CHILD_CHAPTER_MARKER");
    expect(markdown).not.toContain("SECTION_MARKER");
  });
});
