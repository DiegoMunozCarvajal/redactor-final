import { describe, it, expect, beforeEach } from "vitest";
import {
  checkBlocklist,
  normalizeText,
  computeWordShingles,
  jaccardSimilarity,
  longestCommonSubstring,
  buildCorpusFingerprint,
  getCorpusFingerprint,
  resetCorpusFingerprint,
  checkOriginality,
  contaminationMessage,
  containmentScore,
  type CorpusDocument,
  CONTAMINATION_BLOCKLIST,
} from "@/lib/ai/originality-check";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ---------------------------------------------------------------------------
// checkBlocklist
// ---------------------------------------------------------------------------

describe("checkBlocklist", () => {
  it("detects 'mejora del 1%'", () => {
    const hits = checkBlocklist("La mejora del 1% diario es la clave del éxito.");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.includes("1%"))).toBe(true);
  });

  it("detects 'mejora continua del 1%' variant", () => {
    const hits = checkBlocklist("Con la mejora continua del 1% cada día.");
    expect(hits.length).toBeGreaterThan(0);
  });

  it("detects 'hábitos atómicos' with accent variants", () => {
    expect(checkBlocklist("hábitos atómicos son poderosos").length).toBeGreaterThan(0);
    expect(checkBlocklist("habitos atomicos tambien").length).toBeGreaterThan(0);
  });

  it("detects 'bambú' metaphor", () => {
    expect(checkBlocklist("la metáfora del bambú chino").length).toBeGreaterThan(0);
    expect(checkBlocklist("el bambú japonés que crece").length).toBeGreaterThan(0);
  });

  it("detects 'avión que se desvía 1 grado'", () => {
    expect(checkBlocklist("un avión que se desvía un grado").length).toBeGreaterThan(0);
    expect(checkBlocklist("el avion que se desvia 1 grado").length).toBeGreaterThan(0);
  });

  it("detects '4 leyes del cambio de conducta'", () => {
    expect(checkBlocklist("las 4 leyes del cambio de conducta").length).toBeGreaterThan(0);
    expect(checkBlocklist("las cuatro leyes del cambio").length).toBeGreaterThan(0);
  });

  it("detects 'ciclismo británico'", () => {
    expect(checkBlocklist("el equipo de ciclismo británico").length).toBeGreaterThan(0);
    expect(checkBlocklist("el ciclismo britanico").length).toBeGreaterThan(0);
  });

  it("detects 'interés compuesto de los hábitos'", () => {
    expect(checkBlocklist("el interés compuesto de los hábitos").length).toBeGreaterThan(0);
  });

  it("detects 'hielo que se derrite' analogy", () => {
    expect(checkBlocklist("como el hielo que se derrite").length).toBeGreaterThan(0);
  });

  it("detects 'acumulación de pequeñas mejoras'", () => {
    expect(checkBlocklist("la acumulación de pequeñas mejoras").length).toBeGreaterThan(0);
    expect(checkBlocklist("acumulación imperceptible de pequeñas mejoras").length).toBeGreaterThan(0);
  });

  it("detects 'sistema por encima de la motivación'", () => {
    expect(checkBlocklist("el sistema por encima de la motivación").length).toBeGreaterThan(0);
  });

  it("detects 'variable que predice la supervivencia de un hábito'", () => {
    expect(checkBlocklist("la variable que predice la supervivencia de un hábito").length).toBeGreaterThan(0);
  });

  it("detects 'regla de los dos minutos'", () => {
    expect(checkBlocklist("la regla de los dos minutos").length).toBeGreaterThan(0);
  });

  it("detects 'pequeñas ganancias diarias'", () => {
    expect(checkBlocklist("pequeñas ganancias diarias").length).toBeGreaterThan(0);
    expect(checkBlocklist("pequeñas ganancias compuestas").length).toBeGreaterThan(0);
  });

  it("detects 'hábitos clave'", () => {
    expect(checkBlocklist("los hábitos clave son fundamentales").length).toBeGreaterThan(0);
  });

  it("detects 'plan de implementación'", () => {
    expect(checkBlocklist("un plan de implementación específico").length).toBeGreaterThan(0);
  });

  it("detects 'apilamiento de hábitos'", () => {
    expect(checkBlocklist("el apilamiento de hábitos funciona").length).toBeGreaterThan(0);
  });

  it("does NOT flag generic habit advice", () => {
    expect(checkBlocklist("crear buenos hábitos requiere disciplina")).toEqual([]);
    expect(checkBlocklist("la constancia es clave para el éxito")).toEqual([]);
    expect(checkBlocklist("una mejora del 50% en eficiencia")).toEqual([]);
  });

  it("does NOT flag percentage improvements in other contexts", () => {
    // "mejora del 50%" is not "mejora del 1%"
    expect(checkBlocklist("una mejora del 30% en ventas")).toEqual([]);
    expect(checkBlocklist("mejora del 100% en productividad")).toEqual([]);
  });

  it("handles empty and null-ish input", () => {
    expect(checkBlocklist("")).toEqual([]);
  });

  it("handles accent-insensitive matching", () => {
    // Without accents should still match
    expect(checkBlocklist("habitos atomicos").length).toBeGreaterThan(0);
    expect(checkBlocklist("metafora del bambu").length).toBeGreaterThan(0);
    expect(checkBlocklist("interes compuesto de los habitos").length).toBeGreaterThan(0);
  });

  it("every blocklist pattern is testable", () => {
    // Ensure the blocklist array has entries (not accidentally empty)
    expect(CONTAMINATION_BLOCKLIST.length).toBeGreaterThanOrEqual(15);
  });
});

// ---------------------------------------------------------------------------
// normalizeText
// ---------------------------------------------------------------------------

describe("normalizeText", () => {
  it("lowercases text", () => {
    expect(normalizeText("Hola Mundo")).toBe("hola mundo");
  });

  it("strips accents", () => {
    expect(normalizeText("hábitos atómicos")).toBe("habitos atomicos");
  });

  it("collapses whitespace", () => {
    expect(normalizeText("mucho   espacio    extra")).toBe("mucho espacio extra");
  });

  it("replaces punctuation with spaces", () => {
    const result = normalizeText("hola,mundo.¿qué?");
    // Punctuation becomes space, then collapsed
    expect(result).toBe("hola mundo que");
  });

  it("handles empty string", () => {
    expect(normalizeText("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// computeWordShingles
// ---------------------------------------------------------------------------

describe("computeWordShingles", () => {
  it("computes 5-grams by default", () => {
    const shingles = computeWordShingles("uno dos tres cuatro cinco seis siete");
    // words: uno dos tres cuatro cinco = shingle 1
    // words: dos tres cuatro cinco seis = shingle 2
    // words: tres cuatro cinco seis siete = shingle 3
    expect(shingles.size).toBe(3);
    expect(shingles.has("uno dos tres cuatro cinco")).toBe(true);
    expect(shingles.has("dos tres cuatro cinco seis")).toBe(true);
    expect(shingles.has("tres cuatro cinco seis siete")).toBe(true);
  });

  it("handles text shorter than n", () => {
    const shingles = computeWordShingles("tres palabras", 5);
    expect(shingles.size).toBe(1);
    expect(shingles.has("tres palabras")).toBe(true);
  });

  it("respects custom n", () => {
    const shingles = computeWordShingles("a b c d e f", 3);
    expect(shingles.size).toBe(4);
  });

  it("handles empty string", () => {
    const shingles = computeWordShingles("");
    expect(shingles.size).toBe(0); // no words → empty set
  });

  it("deduplicates identical shingles", () => {
    const shingles = computeWordShingles("hola hola hola hola hola hola");
    expect(shingles.size).toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// jaccardSimilarity
// ---------------------------------------------------------------------------

describe("jaccardSimilarity", () => {
  it("returns 1 for identical sets", () => {
    const a = new Set(["a", "b", "c"]);
    const b = new Set(["a", "b", "c"]);
    expect(jaccardSimilarity(a, b)).toBe(1);
  });

  it("returns 0 for disjoint sets", () => {
    const a = new Set(["a", "b"]);
    const b = new Set(["c", "d"]);
    expect(jaccardSimilarity(a, b)).toBe(0);
  });

  it("returns 0 for both empty", () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(0);
  });

  it("returns 0.5 for half overlap", () => {
    const a = new Set(["x", "y"]);
    const b = new Set(["y", "z"]);
    expect(jaccardSimilarity(a, b)).toBe(1 / 3); // intersection=1, union=3
  });

  it("handles one empty set", () => {
    expect(jaccardSimilarity(new Set(["a"]), new Set())).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// longestCommonSubstring
// ---------------------------------------------------------------------------

describe("longestCommonSubstring", () => {
  it("finds common substring above minLength", () => {
    const a = "esta es una frase muy larga que debería ser detectada";
    const b = "esta es una frase muy larga que deberia ser detectada";
    const result = longestCommonSubstring(a, b, 10);
    expect(result).not.toBeNull();
    expect(result!.length).toBeGreaterThanOrEqual(10);
  });

  it("returns null when no common substring >= minLength", () => {
    const a = "texto completamente diferente";
    const b = "nada que ver con lo anterior";
    expect(longestCommonSubstring(a, b, 10)).toBeNull();
  });

  it("is accent-insensitive", () => {
    const a = "hábitos atómicos son importantes";
    const b = "habitos atomicos son importantes";
    const result = longestCommonSubstring(a, b, 10);
    expect(result).not.toBeNull();
  });

  it("handles empty strings", () => {
    expect(longestCommonSubstring("", "algo", 5)).toBeNull();
    expect(longestCommonSubstring("algo", "", 5)).toBeNull();
  });

  it("respects minLength", () => {
    const a = "abc def ghi jkl";
    const b = "abc def ghi jkl";
    const result = longestCommonSubstring(a, b, 50);
    expect(result).toBeNull(); // match exists but shorter than 50
  });
});

// ---------------------------------------------------------------------------
// buildCorpusFingerprint
// ---------------------------------------------------------------------------

describe("buildCorpusFingerprint", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "corpus-test-"));
  });

  it("loads .md files from a directory", () => {
    fs.writeFileSync(path.join(tmpDir, "doc1.md"), "este es un documento de prueba sobre hábitos");
    fs.writeFileSync(path.join(tmpDir, "doc2.md"), "otro documento con contenido diferente");

    const fp = buildCorpusFingerprint(tmpDir);
    expect(fp.loaded).toBe(true);
    expect(fp.totalDocs).toBe(2);
    expect(fp.documents.length).toBe(2);
    expect(fp.documents[0].shingles5.size).toBeGreaterThan(0);
    expect(fp.documents[0].shingles8!.size).toBeGreaterThan(0);
    expect(fp.documents[0].text.length).toBeGreaterThan(0);
    expect(fp.documents[1].shingles5.size).toBeGreaterThan(0);
    expect(fp.documents[1].shingles8!.size).toBeGreaterThan(0);
    expect(fp.documents[1].text.length).toBeGreaterThan(0);
  });

  it("returns loaded=false for nonexistent directory", () => {
    const fp = buildCorpusFingerprint("/tmp/nonexistent-corpus-dir-xyz");
    expect(fp.loaded).toBe(false);
    expect(fp.totalDocs).toBe(0);
  });

  it("returns loaded=false for empty directory", () => {
    const fp = buildCorpusFingerprint(tmpDir);
    expect(fp.loaded).toBe(false);
    expect(fp.totalDocs).toBe(0);
  });

  it("filters non-.md files", () => {
    fs.writeFileSync(path.join(tmpDir, "doc1.md"), "contenido markdown");
    fs.writeFileSync(path.join(tmpDir, "notes.txt"), "ignorado");
    fs.writeFileSync(path.join(tmpDir, "script.js"), "ignorado");

    const fp = buildCorpusFingerprint(tmpDir);
    expect(fp.totalDocs).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getCorpusFingerprint / resetCorpusFingerprint
// ---------------------------------------------------------------------------

describe("getCorpusFingerprint", () => {
  it("caches fingerprint after first load", () => {
    resetCorpusFingerprint();
    const fp1 = getCorpusFingerprint();
    const fp2 = getCorpusFingerprint();
    // Same reference (cached)
    expect(fp1).toBe(fp2);
  });

  it("resetCorpusFingerprint clears cache", () => {
    resetCorpusFingerprint();
    const fp1 = getCorpusFingerprint();
    resetCorpusFingerprint();
    const fp2 = getCorpusFingerprint();
    // Different load, possibly same if corpus unchanged
    expect(fp1.loaded).toBe(fp2.loaded);
    expect(fp1.totalDocs).toBe(fp2.totalDocs);
  });

  it("does not crash when corpus dir is missing", () => {
    resetCorpusFingerprint();
    const fp = getCorpusFingerprint("/tmp/definitely-nonexistent-path-xyz");
    expect(fp.loaded).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkOriginality
// ---------------------------------------------------------------------------

describe("checkOriginality", () => {
  it("passes clean text", () => {
    const result = checkOriginality(
      "La disciplina y la constancia son fundamentales para desarrollar cualquier habilidad nueva.",
    );
    expect(result.passed).toBe(true);
    expect(result.blocklistHits).toEqual([]);
    expect(result.flagged).toBe(false);
  });

  it("fails on blocklist hit", () => {
    const result = checkOriginality(
      "La mejora del 1% diario es un concepto poderoso.",
    );
    expect(result.passed).toBe(false);
    expect(result.blocklistHits.length).toBeGreaterThan(0);
    expect(result.flagged).toBe(true);
  });

  it("fails on 'hábitos atómicos' mention", () => {
    const result = checkOriginality(
      "Los hábitos atómicos son pequeños cambios que generan grandes resultados.",
    );
    expect(result.passed).toBe(false);
  });

  it("works with blocklist disabled", () => {
    const result = checkOriginality(
      "La mejora del 1% diario es clave.",
      { blocklist: false },
    );
    // Without blocklist, the text may still fail on shingle similarity
    // but it definitely won't have blocklistHits
    expect(result.blocklistHits).toEqual([]);
  });

  it("uses blocklist-only mode when corpus unavailable", () => {
    const emptyCorpus = { documents: [] as CorpusDocument[], totalDocs: 0, loaded: false };
    const result = checkOriginality(
      "Texto completamente original sobre productividad personal.",
      { corpus: emptyCorpus },
    );
    expect(result.passed).toBe(true);
    expect(result.mode).toBe("blocklist-only");
  });

  it("detects high shingle similarity with corpus", () => {
    // Build a tiny corpus with known content
    const corpusText = "los pequeños cambios diarios generan resultados extraordinarios a largo plazo";
    const corpus = {
      documents: [
        {
          shingles5: computeWordShingles(corpusText, 5),
          shingles8: computeWordShingles(corpusText, 8),
          text: corpusText,
        },
      ],
      totalDocs: 1,
      loaded: true,
    };

    // Text that heavily overlaps with corpus
    const similarText = "los pequeños cambios diarios generan resultados extraordinarios";
    const result = checkOriginality(similarText, {
      corpus,
      containmentThreshold: 0.3,
      shingleN: 5,
    });
    expect(result.passed).toBe(false);
    expect(result.shingleSimilarity).toBeGreaterThan(0.3);
  });

  it("passes text with low shingle similarity", () => {
    const corpusText = "los pequeños cambios diarios generan resultados extraordinarios a largo plazo";
    const corpus = {
      documents: [
        {
          shingles5: computeWordShingles(corpusText, 5),
          shingles8: computeWordShingles(corpusText, 8),
          text: corpusText,
        },
      ],
      totalDocs: 1,
      loaded: true,
    };

    const differentText = "la programación funcional ofrece ventajas para el desarrollo de software moderno";
    const result = checkOriginality(differentText, {
      corpus,
      containmentThreshold: 0.15,
      shingleN: 5,
    });
    expect(result.passed).toBe(true);
  });

  it("blocklist short-circuits shingle computation", () => {
    // Even with a corpus that would match, blocklist triggers first
    const corpus = {
      documents: [
        {
          shingles5: new Set<string>(["mejora del 1 diario"]),
          shingles8: new Set<string>(),
          text: "mejora del 1 diario",
        },
      ],
      totalDocs: 1,
      loaded: true,
    };

    const result = checkOriginality(
      "La mejora del 1% diario es la clave.",
      { corpus, containmentThreshold: 0.0 }, // threshold 0 would catch anything, but blocklist should fire first
    );
    expect(result.passed).toBe(false);
    expect(result.blocklistHits.length).toBeGreaterThan(0);
    expect(result.shingleSimilarity).toBe(0); // never computed
  });
});

// ---------------------------------------------------------------------------
// contaminationMessage
// ---------------------------------------------------------------------------

describe("contaminationMessage", () => {
  it("describes blocklist hits", () => {
    const result = {
      passed: false,
      blocklistHits: ["pattern1", "pattern2"],
      shingleSimilarity: 0,
      lcsMatch: null,
      flagged: true,
      mode: "full" as const,
    };
    const msg = contaminationMessage(result);
    expect(msg).toContain("Conceptos detectados");
    expect(msg).toContain("2 patrón");
  });

  it("describes shingle similarity", () => {
    const result = {
      passed: false,
      blocklistHits: [],
      shingleSimilarity: 0.25,
      lcsMatch: null,
      flagged: true,
      mode: "full" as const,
    };
    const msg = contaminationMessage(result);
    expect(msg).toContain("25.0%");
  });

  it("describes LCS match", () => {
    const result = {
      passed: false,
      blocklistHits: [],
      shingleSimilarity: 0,
      lcsMatch: "texto común encontrado entre ambos documentos",
      flagged: true,
      mode: "full" as const,
    };
    const msg = contaminationMessage(result);
    expect(msg).toContain("Subcadena común");
  });

  it("does NOT name Atomic Habits or James Clear", () => {
    const result = {
      passed: false,
      blocklistHits: ["pattern"],
      shingleSimilarity: 0,
      lcsMatch: null,
      flagged: true,
      mode: "full" as const,
    };
    const msg = contaminationMessage(result);
    expect(msg).not.toMatch(/atomic/i);
    expect(msg).not.toMatch(/james/i);
    expect(msg).not.toMatch(/clear/i);
    expect(msg).not.toMatch(/hábitos atómicos/i);
  });
});
