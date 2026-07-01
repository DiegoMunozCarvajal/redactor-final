import { describe, expect, it } from "vitest";

import { inferPlaceholderProvider } from "@/lib/placeholder-research";

describe("placeholder research provider inference", () => {
  it("uses RAG for examples and stories", () => {
    expect(inferPlaceholderProvider("EJEMPLO_CONCRETO")).toBe("rag");
  });

  it("uses Semantic Scholar for studies", () => {
    expect(inferPlaceholderProvider("ESTUDIO_CLAVE")).toBe("semantic-scholar");
  });

  it("uses direct provider for topic placeholders", () => {
    expect(inferPlaceholderProvider("TEMA_DEL_LIBRO")).toBe("direct");
  });

  it("uses no research for stylistic placeholders", () => {
    expect(inferPlaceholderProvider("LECTOR_OBJETIVO")).toBe("llm");
  });

  it("does not match 'tema' inside other words (segment matching)", () => {
    // "SISTEMA" contains "tema" as substring but its segments are ["sistema"]
    expect(inferPlaceholderProvider("SISTEMA")).not.toBe("direct");
    expect(inferPlaceholderProvider("SISTEMA")).toBe("llm");
  });

  it("uses RAG when a whole segment matches, not substring", () => {
    // "CASO" is a segment match for RAG
    expect(inferPlaceholderProvider("CASO_PAPER")).toBe("rag");
    // "PAPER" alone would be Semantic Scholar, but RAG is checked first
  });

  it("matches compound names correctly across multiple segments", () => {
    // "EJEMPLO" segment → RAG, "CIENTIFICO" segment → Semantic Scholar
    // RAG wins because checked first
    expect(inferPlaceholderProvider("EJEMPLO_CIENTIFICO")).toBe("rag");
    // "LECTOR" segment → stylistic/none
    expect(inferPlaceholderProvider("LECTOR_PRINCIPIANTE")).toBe("llm");
  });
});
