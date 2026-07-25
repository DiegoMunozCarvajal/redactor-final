import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const guardedFiles = [
  "app/api/projects/[id]/chapters/[chapterId]/placeholders/fill/route.ts",
  "app/api/projects/[id]/chapters/[chapterId]/placeholders/[name]/fill/route.ts",
  "app/api/projects/[id]/prompts/[promptId]/generate/route.ts",
  "app/api/projects/[id]/chapters/[chapterId]/generate/route.ts",
  "app/api/projects/[id]/chapters/[chapterId]/assemble/route.ts",
  "app/api/projects/[id]/chapters/[chapterId]/critique/route.ts",
  "app/api/projects/[id]/chapters/[chapterId]/correct/route.ts",
  "app/api/projects/[id]/generate-title/route.ts",
  "trigger/generate-chapter.ts",
  "trigger/generate-critique.ts",
  "trigger/generate-correction.ts",
] as const;

describe("generation authorization coverage", () => {
  it.each(guardedFiles)("%s calls the central guard", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).toContain("assertTemplateGenerationAllowed(");
  });
});
