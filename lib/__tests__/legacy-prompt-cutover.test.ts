import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { legacyPromptGone } from "@/lib/api/legacy-prompt-gone";
import {
  legacyPromptLibraryTarget,
  legacyMetaPromptsTarget,
  legacyGenerationPromptsTarget,
  legacyPromptDetailTarget,
} from "@/lib/prompts/legacy-redirects";

const root = new URL("../..", import.meta.url).pathname;

describe("legacy prompt cutover", () => {
  it("returns 410 with canonical replacement", async () => {
    const response = legacyPromptGone();
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: "Legacy prompt endpoint has been retired",
      replacement: "/generation",
    });
  });

  it("maps old library tabs to registry kinds", () => {
    expect(legacyPromptLibraryTarget("assembly")).toBe(
      "/generation?kind=assembly",
    );
    expect(legacyPromptLibraryTarget("critique")).toBe(
      "/generation?kind=critique",
    );
    expect(legacyPromptLibraryTarget("corrector")).toBe(
      "/generation?kind=corrector",
    );
    expect(legacyPromptLibraryTarget("invalid")).toBe(
      "/generation?kind=assembly",
    );
  });

  it("maps meta-prompts to meta-template", () => {
    expect(legacyMetaPromptsTarget()).toBe("/generation?kind=meta-template");
  });

  it("maps generation-prompts to generation-system", () => {
    expect(legacyGenerationPromptsTarget()).toBe(
      "/generation?kind=generation-system",
    );
  });

  it("maps detail pages to /generation", () => {
    expect(legacyPromptDetailTarget()).toBe("/generation");
  });

  it("sidebar exposes one global prompt destination", () => {
    const source = readFileSync(
      `${root}/components/patterns/sidebar.tsx`,
      "utf8",
    );
    expect(source).toContain('{ href: "/generation", label: "Prompts"');
    expect(source).not.toContain("/prompt-library");
    expect(source).not.toContain("/meta-prompts");
  });

  it("manual legacy assembly script is absent", () => {
    expect(existsSync(`${root}/scripts/assemble-chapter.ts`)).toBe(false);
  });

  it("all legacy API files only reference legacyPromptGone, not db", () => {
    for (const path of [
      "app/api/prompt-library/route.ts",
      "app/api/prompt-library/[id]/route.ts",
      "app/api/meta-prompts/route.ts",
      "app/api/meta-prompts/[id]/route.ts",
      "app/api/generation-prompts/route.ts",
      "app/api/generation-prompts/[id]/route.ts",
    ]) {
      const source = readFileSync(`${root}/${path}`, "utf8");
      expect(source).toContain("legacyPromptGone");
      expect(source).not.toContain("@/lib/db");
    }
  });
});
