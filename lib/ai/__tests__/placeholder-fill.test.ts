import { describe, it, expect, vi, beforeEach } from "vitest";

// placeholder-fill.ts transitively imports drizzle which reads DATABASE_URL.
// Mock the DB module so pure-function tests don't need a real database.
vi.mock("@/lib/db", () => {
  function chain(): Record<string, unknown> {
    return {
      select: () => chain(),
      from: () => chain(),
      innerJoin: () => chain(),
      leftJoin: () => chain(),
      where: () => chain(),
      limit: () => Promise.resolve([]),
      orderBy: () => chain(),
      values: () => ({ returning: () => Promise.resolve([{ id: "exec-test" }]) }),
      set: () => chain(),
    };
  }
  const c = chain();
  return {
    db: {
      select: c.select as () => unknown,
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([{ id: "exec-test" }]) }) }),
      update: () => ({ set: () => ({ where: () => Promise.resolve(undefined) }) }),
      transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    },
  };
});

// Mock heavy dependencies for fillOnePlaceholder integration tests
vi.mock("@/lib/ai/rag", () => ({ retrieveContext: vi.fn() }));
vi.mock("@/lib/ai/completion", () => ({ generateCompletion: vi.fn() }));
vi.mock("@/lib/ai/web-search", () => ({ searchSemanticScholar: vi.fn() }));
vi.mock("@/lib/ai/originality-check", () => ({
  checkBlocklist: vi.fn().mockResolvedValue({ blocked: false }),
  assertOriginalEnough: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/placeholder-research", () => ({
  inferPlaceholderProvider: vi.fn().mockReturnValue("llm"),
}));
vi.mock("@/lib/editorial-brief/render", () => ({
  renderEditorialScope: vi.fn().mockReturnValue(""),
}));
vi.mock("@/lib/prompts/executor", () => ({
  executeVersionedPrompt: vi.fn().mockResolvedValue({
    result: {
      data: { definition: "A valid definition that is at least thirty characters long for the evidence placeholder test case." },
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, costUsd: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
      durationMs: 100,
    },
    executionId: "exec-test",
    revision: { id: "rev-test", definitionId: "def-test", kind: "placeholder-fill", name: "Placeholder Fill v1", revisionNumber: 1, versionLabel: "v1.0", systemTemplate: "", userTemplate: "", requiredMarkers: [], outputContract: null, configuration: {} },
  }),
}));

import {
  extractJson,
  resolveDirectly,
  buildSearchQuery,
  isNarrativePlaceholder,
  validateDefinition,
  fillOnePlaceholder,
  RequiredEvidenceMissingError,
} from "@/lib/ai/placeholder-fill";
import type { PlaceholderDef, FillOnePlaceholderParams } from "@/lib/ai/placeholder-fill";
import { retrieveContext } from "@/lib/ai/rag";
import { generateCompletion } from "@/lib/ai/completion";
import { createTestEditorialBundle, createTestChapterContract } from "@/lib/editorial-brief/__tests__/fixtures";

// ---------------------------------------------------------------------------
// extractJson — 4-phase JSON parser
// ---------------------------------------------------------------------------

describe("extractJson", () => {
  it("parses well-formed JSON (Phase 1)", () => {
    expect(extractJson('{"key": "value"}')).toEqual({ key: "value" });
  });

  it("parses JSON inside ```json fences (Phase 2)", () => {
    expect(extractJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  it("parses JSON inside plain ``` fences (Phase 2)", () => {
    expect(extractJson('```\n{"b": 2}\n```')).toEqual({ b: 2 });
  });

  it("extracts JSON from text with surrounding prose (Phase 3)", () => {
    expect(extractJson('Here is the result: {"x": 42}. Done.')).toEqual({ x: 42 });
  });

  it("handles nested braces (string-aware)", () => {
    const result = extractJson('{"outer": {"inner": "value"}}');
    expect(result).toEqual({ outer: { inner: "value" } });
  });

  it("handles braces inside JSON strings (not counted as depth)", () => {
    expect(extractJson('{"template": "use {variable} here"}')).toEqual({
      template: "use {variable} here",
    });
  });

  it("strips trailing commas (Phase 4 salvage)", () => {
    expect(extractJson('{"a": 1,}')).toEqual({ a: 1 });
  });

  it("throws for invalid JSON", () => {
    expect(() => extractJson("not json at all")).toThrow("Could not parse JSON");
  });

  it("throws for empty string", () => {
    expect(() => extractJson("")).toThrow("Could not parse JSON");
  });

  it("extracts first JSON object when multiple exist", () => {
    const result = extractJson('{"first": 1} {"second": 2}');
    expect(result).toEqual({ first: 1 });
  });

  it("handles escaped quotes in strings", () => {
    expect(extractJson('{"text": "hello \\"world\\""}')).toEqual({
      text: 'hello "world"',
    });
  });
});

// ---------------------------------------------------------------------------
// resolveDirectly — topic/theme placeholder resolution
// ---------------------------------------------------------------------------

describe("resolveDirectly", () => {
  it("resolves 'tema' from project topic", () => {
    expect(resolveDirectly("tema", "Hábitos Atómicos")).toBe("Hábitos Atómicos");
  });

  it("resolves 'tema_del_libro' from project topic", () => {
    expect(resolveDirectly("tema_del_libro", "Productividad")).toBe("Productividad");
  });

  it("resolves 'topic' alias", () => {
    expect(resolveDirectly("main_topic", "Sleep Science")).toBe("Sleep Science");
  });

  it("returns null for non-topic placeholders", () => {
    expect(resolveDirectly("autor", "Some Topic")).toBeNull();
    expect(resolveDirectly("metodologia", "Some Topic")).toBeNull();
  });

  it("returns null when project topic is null", () => {
    expect(resolveDirectly("tema", null)).toBeNull();
  });

  it("returns null when project topic is empty", () => {
    expect(resolveDirectly("tema", "")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildSearchQuery — generates search queries from placeholder metadata
// ---------------------------------------------------------------------------

describe("buildSearchQuery", () => {
  const ph = (overrides: Partial<PlaceholderDef> = {}): PlaceholderDef => ({
    name: "placeholder",
    ...overrides,
  });

  it("uses function field as primary query source", () => {
    const q = buildSearchQuery(
      ph({ name: "esfuerzo", function: "El esfuerzo para eliminar un mal hábito" }),
      "Hábitos",
    );
    expect(q).toBe("esfuerzo para eliminar un mal hábito Hábitos");
  });

  it("strips leading articles from function", () => {
    const q = buildSearchQuery(
      ph({ function: "La metodología de investigación" }),
      "Ciencia",
    );
    expect(q).toBe("metodología de investigación Ciencia");
  });

  it("falls back to name when no function", () => {
    const q = buildSearchQuery(
      ph({ name: "historia_clave", function: null }),
      "Liderazgo",
    );
    expect(q).toContain("historia clave");
    expect(q).toContain("Liderazgo");
  });

  it("returns just topic when no function and no name", () => {
    const q = buildSearchQuery(ph({ name: "", function: null }), "Topic");
    expect(q).toBe("Topic");
  });
});

// ---------------------------------------------------------------------------
// isNarrativePlaceholder — detects narrative/story placeholders
// ---------------------------------------------------------------------------

describe("isNarrativePlaceholder", () => {
  const ph = (fn: string, notes = ""): PlaceholderDef => ({
    name: "test",
    function: fn,
    notes,
  });

  it("detects 'historia'", () => {
    expect(isNarrativePlaceholder(ph("Una historia personal"))).toBe(true);
  });

  it("detects 'anécdota'", () => {
    expect(isNarrativePlaceholder(ph("Anécdota del autor"))).toBe(true);
  });

  it("detects 'caso de estudio'", () => {
    expect(isNarrativePlaceholder(ph("Un caso de estudio relevante"))).toBe(true);
  });

  it("detects narrative patterns in notes field", () => {
    expect(isNarrativePlaceholder({ name: "x", function: null, notes: "relato breve" })).toBe(true);
  });

  it("returns false for factual placeholders", () => {
    expect(isNarrativePlaceholder(ph("Definición del concepto"))).toBe(false);
    expect(isNarrativePlaceholder(ph("Datos estadísticos"))).toBe(false);
  });

  it("'caso' alone is NOT considered narrative", () => {
    expect(isNarrativePlaceholder(ph("Un caso"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateDefinition — validates AI-generated placeholder definitions
// ---------------------------------------------------------------------------

describe("validateDefinition", () => {
  const ph = (overrides: Partial<PlaceholderDef> = {}): PlaceholderDef => ({
    name: "concepto",
    ...overrides,
  });

  it("rejects definitions shorter than 30 characters", () => {
    const result = validateDefinition("short", "concepto", ph());
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("too short");
  });

  it("accepts valid definitions", () => {
    const result = validateDefinition(
      "Se refiere a una idea abstracta que engloba múltiples aspectos " +
      "teóricos y prácticos dentro del marco de referencia establecido por el autor.",
      "concepto",
      ph(),
    );
    expect(result.ok).toBe(true);
  });

  it("detects name bleeding — definition contains placeholder name", () => {
    const result = validateDefinition(
      "El concepto es una idea fundamental. El concepto debe entenderse bien " +
      "para comprender el resto del texto que estamos generando aquí.",
      "concepto",
      ph(),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("name bleeding");
  });

  it("detects name bleeding with underscores in placeholder name", () => {
    const result = validateDefinition(
      "El tema del libro es importante para entender el contexto general de la obra escrita.",
      "tema_del_libro",
      ph({ name: "tema_del_libro" }),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("tema_del_libro");
  });

  it("accepts definitions without name bleeding", () => {
    const result = validateDefinition(
      "Se refiere al asunto principal que se aborda en la obra literaria " +
      "y que conecta todos los capítulos entre sí de manera coherente.",
      "tema",
      ph({ name: "tema" }),
    );
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// fillOnePlaceholder — evidence-driven RAG source restriction
// ---------------------------------------------------------------------------

const CHAPTER_ID = "10000000-0000-4000-8000-000000000001";

describe("fillOnePlaceholder evidence-driven sourceIds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(retrieveContext).mockResolvedValue({ chunks: [], contextText: "" });
    vi.mocked(generateCompletion).mockResolvedValue({
      data: '{"definition": "A valid definition that is at least thirty characters long for the evidence placeholder test case."}',
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, costUsd: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
      durationMs: 100,
    });
  });

  const baseParams: FillOnePlaceholderParams = {
    placeholder: { name: "evidence_placeholder" },
    projectTopic: "Test Topic",
    projectId: "proj-1",
    promptContents: ["Content 1"],
    existingDefinitions: {},
    chapterId: CHAPTER_ID,
  };

  it("passes sourceIds:[] to retrieveContext when evidenceSourceIds is empty array", async () => {
    const bundle = createTestEditorialBundle({
      evidenceSourceIds: [],
      contracts: [
        createTestChapterContract(CHAPTER_ID, {
          evidenceNeeds: [
            { placeholderName: "evidence_placeholder", query: "test query", required: false },
          ],
        }),
      ],
    });

    await fillOnePlaceholder({ ...baseParams, editorialBundle: bundle });

    expect(retrieveContext).toHaveBeenCalledWith(
      expect.any(String),
      "proj-1",
      expect.objectContaining({ sourceIds: [] }),
    );
  });

  it("does NOT set sourceIds when no evidence need matches placeholder", async () => {
    const bundle = createTestEditorialBundle({
      evidenceSourceIds: [],
      contracts: [
        createTestChapterContract(CHAPTER_ID, {
          evidenceNeeds: [
            { placeholderName: "other_placeholder", query: "other query", required: false },
          ],
        }),
      ],
    });

    // When placeholder doesn't match any evidence need, evidenceSourceIds stays undefined
    await fillOnePlaceholder({ ...baseParams, placeholder: { name: "unrelated" }, editorialBundle: bundle });

    // provider is "llm" (no evidence match), so RAG not called at all
    expect(retrieveContext).not.toHaveBeenCalled();
  });

  it("throws RequiredEvidenceMissingError when required evidence has no approved sources", async () => {
    const bundle = createTestEditorialBundle({
      evidenceSourceIds: [],
      contracts: [
        createTestChapterContract(CHAPTER_ID, {
          evidenceNeeds: [
            { placeholderName: "required_evidence", query: "required query", required: true },
          ],
        }),
      ],
    });

    await expect(
      fillOnePlaceholder({
        ...baseParams,
        placeholder: { name: "required_evidence" },
        editorialBundle: bundle,
      }),
    ).rejects.toThrow(RequiredEvidenceMissingError);
  });
});
