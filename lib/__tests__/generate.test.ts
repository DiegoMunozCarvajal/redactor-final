import { describe, it, expect, vi } from "vitest";

// Mock db to avoid DATABASE_URL requirement (resolvePlaceholdersDirect barrel imports db)
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/schema", () => ({}));

import {
  sanitizeValue,
  applyPlaceholders,
  generateChapterAssemblyHierarchical,
  generateChapterAssemblyHalves,
  generateChapterAssemblySequential,
} from "@/lib/generate";
import { resolvePlaceholdersDirect } from "@/lib/placeholders";

describe("sanitizeValue", () => {
  it("strips control characters", () => {
    expect(sanitizeValue("hello\x00world")).toBe("helloworld");
    expect(sanitizeValue("test\x1F")).toBe("test");
  });

  it("replaces << and >> with safe alternatives", () => {
    expect(sanitizeValue("<<greeting>>")).toBe("‹‹greeting››");
  });

  it("trims whitespace", () => {
    expect(sanitizeValue("  hello  ")).toBe("hello");
  });

  it("preserves normal text", () => {
    expect(sanitizeValue("Hola mundo")).toBe("Hola mundo");
  });
});

describe("applyPlaceholders", () => {
  it("replaces placeholder tokens with wrapped values", () => {
    const content = "Escribe sobre {TEMA}";
    const placeholders = { TEMA: "historia" };
    const result = applyPlaceholders(content, placeholders);
    expect(result).toBe("Escribe sobre <<TEMA>>historia<</TEMA>>");
  });

  it("sorts longest-first to prevent partial matches", () => {
    const content = "{TEMA} y {TEMA_EXTRA}";
    const placeholders = { TEMA: "a", TEMA_EXTRA: "b" };
    const result = applyPlaceholders(content, placeholders);
    expect(result).toContain("<<TEMA_EXTRA>>b<</TEMA_EXTRA>>");
    expect(result).toContain("<<TEMA>>a<</TEMA>>");
  });

  it("skips placeholders not present in content", () => {
    const content = "Solo {TEMA}";
    const placeholders = { TEMA: "x", OTRO: "y" };
    const result = applyPlaceholders(content, placeholders);
    expect(result).not.toContain("OTRO");
  });

  it("returns content unchanged if no placeholders match", () => {
    const content = "Sin placeholders";
    const placeholders = { TEMA: "x" };
    const result = applyPlaceholders(content, placeholders);
    expect(result).toBe("Sin placeholders");
  });
});

describe("resolvePlaceholdersDirect", () => {
  it("resolves TEMA-like placeholders from projectTopic", () => {
    const result = resolvePlaceholdersDirect(["TEMA_DEL_LIBRO"], "historia de la ciencia");
    expect(result.resolved).toEqual({ TEMA_DEL_LIBRO: "historia de la ciencia" });
    expect(result.unresolved).toEqual([]);
  });

  it("resolves TEMA (lowercase) from projectTopic", () => {
    const result = resolvePlaceholdersDirect(["tema_principal"], "filosofía antigua");
    expect(result.resolved).toEqual({ tema_principal: "filosofía antigua" });
    expect(result.unresolved).toEqual([]);
  });

  it("resolves TOPIC-like placeholders from projectTopic", () => {
    const result = resolvePlaceholdersDirect(["BOOK_TOPIC"], "machine learning");
    expect(result.resolved).toEqual({ BOOK_TOPIC: "machine learning" });
  });

  it("leaves LECTOR_OBJETIVO unresolved (no chapter brief)", () => {
    const result = resolvePlaceholdersDirect(["LECTOR_OBJETIVO"], null);
    expect(result.resolved).toEqual({});
    expect(result.unresolved).toEqual(["LECTOR_OBJETIVO"]);
  });

  it("leaves AUDIENCIA unresolved (no chapter brief)", () => {
    const result = resolvePlaceholdersDirect(["AUDIENCIA"], null);
    expect(result.resolved).toEqual({});
    expect(result.unresolved).toEqual(["AUDIENCIA"]);
  });

  it("leaves factual placeholder unresolved (no LLM, just passes through)", () => {
    const result = resolvePlaceholdersDirect(["FUENTE_PRINCIPAL"], null);
    expect(result.resolved).toEqual({});
    expect(result.unresolved).toEqual(["FUENTE_PRINCIPAL"]);
  });

  it("leaves TEMA unresolved when topic is null", () => {
    const result = resolvePlaceholdersDirect(["TEMA_DEL_LIBRO"], null);
    expect(result.resolved).toEqual({});
    expect(result.unresolved).toEqual(["TEMA_DEL_LIBRO"]);
  });

  it("resolves mixed batch: some direct, some unresolved", () => {
    const result = resolvePlaceholdersDirect(
      ["TEMA", "FUENTE", "LECTOR_OBJETIVO", "EJEMPLO_HISTORICO"],
      "historia del arte",
    );
    expect(result.resolved["TEMA"]).toBe("historia del arte");
    expect(result.unresolved.sort()).toEqual(["EJEMPLO_HISTORICO", "FUENTE", "LECTOR_OBJETIVO"]);
  });
});

describe("applyPlaceholders edge cases", () => {
  it("falls back to projectTopic for {tema} when not in placeholders", () => {
    const result = applyPlaceholders("Habla sobre {tema}", { OTRO: "x" }, "Historia");
    expect(result).toContain("<<TEMA>>Historia<</TEMA>>");
  });

  it("does not use projectTopic when tema IS in placeholders", () => {
    const result = applyPlaceholders(
      "{tema}",
      { tema: "placeholder value" },
      "project topic",
    );
    expect(result).toContain("placeholder value");
    expect(result).not.toContain("project topic");
  });

  it("escapes $ in replacement values", () => {
    const result = applyPlaceholders("{COST}", { COST: "$100" });
    // $ should be escaped to $$ so it's not interpreted as a replacement pattern
    expect(result).toContain("$100");
  });

  it("matches case-insensitively", () => {
    const result = applyPlaceholders("{TEMA} {Tema} {tema}", { tema: "x" });
    const matches = result.match(/<<TEMA>>x<<\/TEMA>>/g);
    expect(matches).toHaveLength(3);
  });
});

describe("assembly algorithms — no-LLM paths", () => {
  const dummyPrompt = { content: "assemble" };
  const emptyPlaceholders: Record<string, string> = {};

  describe("generateChapterAssemblyHierarchical", () => {
    it("throws on empty fragments", async () => {
      await expect(
        generateChapterAssemblyHierarchical(dummyPrompt, [], emptyPlaceholders, "deepseek-v4-pro"),
      ).rejects.toThrow("No fragments to assemble");
    });

    it("returns single fragment as-is", async () => {
      const r = await generateChapterAssemblyHierarchical(
        dummyPrompt,
        [{ content: "solo" }],
        emptyPlaceholders,
        "deepseek-v4-pro",
      );
      expect(r.text).toBe("solo");
      expect(r.usage.inputTokens).toBe(0);
    });
  });

  describe("generateChapterAssemblyHalves", () => {
    it("throws on empty fragments", async () => {
      await expect(
        generateChapterAssemblyHalves(dummyPrompt, [], emptyPlaceholders, "deepseek-v4-pro"),
      ).rejects.toThrow("No fragments to assemble");
    });

    it("returns single fragment as-is", async () => {
      const r = await generateChapterAssemblyHalves(
        dummyPrompt,
        [{ content: "uno" }],
        emptyPlaceholders,
        "deepseek-v4-pro",
      );
      expect(r.text).toBe("uno");
    });
  });

  describe("generateChapterAssemblySequential", () => {
    it("throws on empty fragments", async () => {
      await expect(
        generateChapterAssemblySequential(dummyPrompt, [], emptyPlaceholders, "deepseek-v4-pro"),
      ).rejects.toThrow("No fragments to assemble");
    });

    it("returns single fragment as-is", async () => {
      const r = await generateChapterAssemblySequential(
        dummyPrompt,
        [{ content: "uno" }],
        emptyPlaceholders,
        "deepseek-v4-pro",
      );
      expect(r.text).toBe("uno");
    });
  });
});
