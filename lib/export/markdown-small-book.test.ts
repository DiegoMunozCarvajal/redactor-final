import { describe, expect, it } from "vitest";

import { renderSmallBookMarkdown } from "./markdown-small-book";

describe("renderSmallBookMarkdown", () => {
  it("stitches chapters in sort_order with plan title as H1", () => {
    const md = renderSmallBookMarkdown({
      bookTitle: "Easy to Love",
      units: [
        { sortOrder: 2, workingTitle: "Scenes", revisedMarkdown: "## First\n\nB" },
        { sortOrder: 1, workingTitle: "Presence", revisedMarkdown: "## First\n\nA" },
      ],
    });

    expect(md).toMatch(/^# Easy to Love/);
    expect(md.indexOf("# Chapter 1")).toBeLessThan(md.indexOf("# Chapter 2"));
  });

  it("falls back to draft markdown when revised is absent", () => {
    const md = renderSmallBookMarkdown({
      bookTitle: "T",
      units: [{ sortOrder: 1, workingTitle: "W", draftMarkdown: "## S\n\nD" }],
    });

    expect(md).toContain("## S");
    expect(md).toContain("D");
  });
});
