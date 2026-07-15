import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Generate All concurrency", () => {
  it("serializes prompt requests to match the per-project rate limit", () => {
    const source = readFileSync(
      new URL("../../app/projects/[id]/chapters/[chapterId]/page.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toMatch(/FRAGMENT_GENERATION_CONCURRENCY\s*=\s*1\s*;/);
  });
});
