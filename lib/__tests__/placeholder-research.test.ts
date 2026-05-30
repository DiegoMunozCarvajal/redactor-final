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
    expect(inferPlaceholderProvider("LECTOR_OBJETIVO")).toBe("none");
  });
});
