import { describe, it, expect, vi } from "vitest";

// Mock db to avoid DATABASE_URL requirement (resolvePlaceholdersDirect barrel imports db)
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/schema", () => ({}));

import { sanitizeValue, applyPlaceholders } from "@/lib/generate";
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
  const brief = "Este capítulo desglosa los seis principios de sticky ideas con ejemplos del mundo publicitario. Está escrito para profesionales de comunicación que ya dominan conceptos básicos de marketing. Al terminar, el lector podrá auditar cualquier pieza de comunicación usando la checklist SUCCESs.";

  it("resolves TEMA-like placeholders from projectTopic", () => {
    const result = resolvePlaceholdersDirect(["TEMA_DEL_LIBRO"], "historia de la ciencia", brief);
    expect(result.resolved).toEqual({ TEMA_DEL_LIBRO: "historia de la ciencia" });
    expect(result.unresolved).toEqual([]);
  });

  it("resolves TEMA (lowercase) from projectTopic", () => {
    const result = resolvePlaceholdersDirect(["tema_principal"], "filosofía antigua", "");
    expect(result.resolved).toEqual({ tema_principal: "filosofía antigua" });
    expect(result.unresolved).toEqual([]);
  });

  it("resolves TOPIC-like placeholders from projectTopic", () => {
    const result = resolvePlaceholdersDirect(["BOOK_TOPIC"], "machine learning", "");
    expect(result.resolved).toEqual({ BOOK_TOPIC: "machine learning" });
  });

  it("resolves LECTOR_OBJETIVO from chapter brief", () => {
    const result = resolvePlaceholdersDirect(["LECTOR_OBJETIVO"], null, brief);
    expect(result.resolved["LECTOR_OBJETIVO"]).toContain("profesionales de comunicación");
    expect(result.unresolved).toEqual([]);
  });

  it("resolves AUDIENCIA from chapter brief", () => {
    const result = resolvePlaceholdersDirect(["AUDIENCIA"], null, brief);
    expect(result.resolved["AUDIENCIA"]).toContain("profesionales");
    expect(result.unresolved).toEqual([]);
  });

  it("leaves factual placeholder unresolved (no LLM, just passes through)", () => {
    const result = resolvePlaceholdersDirect(["FUENTE_PRINCIPAL"], null, brief);
    expect(result.resolved).toEqual({});
    expect(result.unresolved).toEqual(["FUENTE_PRINCIPAL"]);
  });

  it("leaves TEMA unresolved when topic is null", () => {
    const result = resolvePlaceholdersDirect(["TEMA_DEL_LIBRO"], null, "");
    expect(result.resolved).toEqual({});
    expect(result.unresolved).toEqual(["TEMA_DEL_LIBRO"]);
  });

  it("resolves mixed batch: some direct, some unresolved", () => {
    const result = resolvePlaceholdersDirect(
      ["TEMA", "FUENTE", "LECTOR_OBJETIVO", "EJEMPLO_HISTORICO"],
      "historia del arte",
      brief,
    );
    expect(result.resolved["TEMA"]).toBe("historia del arte");
    expect(result.resolved["LECTOR_OBJETIVO"]).toContain("profesionales");
    expect(result.unresolved).toEqual(["FUENTE", "EJEMPLO_HISTORICO"]);
  });
});
