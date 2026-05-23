import { describe, it, expect } from "vitest";
import { sanitizeValue, applyPlaceholders } from "@/lib/generate";

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
