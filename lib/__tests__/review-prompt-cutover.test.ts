import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(
  new URL("../../app/projects/[id]/chapters/[chapterId]/page.tsx", import.meta.url),
  "utf8",
);
const corrector = readFileSync(
  new URL("../../components/prompts/corrector-section.tsx", import.meta.url),
  "utf8",
);

describe("review prompt registry cutover", () => {
  it("loads effective review prompts and persists project bindings", () => {
    expect(page).toContain("loadReviewPromptRegistry");
    expect(page).toContain("setReviewPromptBinding");
    expect(page).toContain("clearReviewPromptBinding");
  });

  it("sends revision IDs without legacy inline prompt objects", () => {
    expect(page).toContain("critiquePromptRevisionId");
    expect(corrector).toContain("correctorPromptRevisionId");
    expect(page).not.toMatch(/critiquePrompt:\s*\{/);
    expect(corrector).not.toMatch(/correctorPrompt\s*=/);
  });
});
