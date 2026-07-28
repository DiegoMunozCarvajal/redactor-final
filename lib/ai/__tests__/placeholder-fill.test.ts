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
  renderEditorialData: vi.fn().mockReturnValue(""),
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
  isEvidencePlaceholder,
  buildEvidenceQuery,
  matchEvidenceGap,
  validateDefinition,
  fillOnePlaceholder,
  fillPlaceholdersSequential,
  RequiredEvidenceMissingError,
} from "@/lib/ai/placeholder-fill";
import type { PlaceholderDef, FillOnePlaceholderParams } from "@/lib/ai/placeholder-fill";
import { retrieveContext } from "@/lib/ai/rag";
import { generateCompletion } from "@/lib/ai/completion";
import { executeVersionedPrompt } from "@/lib/prompts/executor";
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
  const ph = (fn: string): PlaceholderDef => ({
    name: "test",
    function: fn,
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

  it("detects narrative patterns in function field", () => {
    expect(isNarrativePlaceholder({ name: "x", function: "relato breve" })).toBe(true);
  });

  it("classifies correctly with function only", () => {
    // notes field no longer exists on PlaceholderDef. Only name + function.
    expect(isNarrativePlaceholder({ name: "x", function: null })).toBe(false);
    expect(isNarrativePlaceholder({ name: "x", function: "un relato conmovedor" })).toBe(true);
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

  it("rejects narrative definitions shorter than 30 characters", () => {
    const result = validateDefinition("short", "anecdota", ph({ name: "anecdota", function: "Una anécdota ilustrativa del concepto" }));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("too short");
  });

  it("accepts short non-narrative definitions (terms, maxims)", () => {
    const result = validateDefinition("microimpulsos", "termino_central", ph({ name: "termino_central" }));
    expect(result.ok).toBe(true);
  });

  it("rejects empty non-narrative definitions", () => {
    const result = validateDefinition("ab", "termino_central", ph({ name: "termino_central" }));
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
// isEvidencePlaceholder — detects evidence-related placeholder names and text
// ---------------------------------------------------------------------------

describe("isEvidencePlaceholder", () => {
  it("returns true for names containing 'evidencia'", () => {
    expect(isEvidencePlaceholder("evidencia_placeholder", "")).toBe(true);
  });

  it("returns true for names containing 'evidence'", () => {
    expect(isEvidencePlaceholder("evidence_placeholder", "")).toBe(true);
  });

  it("returns true for names containing 'estudio'", () => {
    expect(isEvidencePlaceholder("estudio_caso", "")).toBe(true);
  });

  it("returns true for prompt text containing 'presenta evidencia'", () => {
    expect(isEvidencePlaceholder("some_name", "presenta evidencia concreta")).toBe(true);
  });

  it("returns true for prompt text containing 'datos'", () => {
    expect(isEvidencePlaceholder("some_name", "incorpore datos estadísticos")).toBe(true);
  });

  it("returns false for non-evidence placeholder", () => {
    expect(isEvidencePlaceholder("concepto_central", "")).toBe(false);
  });

  it("returns false for empty name and text", () => {
    expect(isEvidencePlaceholder("", "")).toBe(false);
  });

  it("returns true for prompt text containing 'fuente'", () => {
    expect(isEvidencePlaceholder("cita", "una fuente confiable")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildEvidenceQuery — builds search query from placeholder + prompt text
// ---------------------------------------------------------------------------

describe("buildEvidenceQuery", () => {
  it("extracts meaningful keywords from prompt text", () => {
    const result = buildEvidenceQuery({
      ph: { name: "evidencia" },
      promptText: "presenta datos estadísticos sobre el tema",
      projectTopic: "Hábitos",
    });
    expect(result).toContain("presenta");
    expect(result).toContain("datos");
    expect(result).toContain("estadísticos");
    expect(result).toContain("sobre");
    expect(result).toContain("tema");
    expect(result).toContain("Hábitos");
  });

  it("filters short words (length <= 3)", () => {
    const result = buildEvidenceQuery({
      ph: { name: "evidencia" },
      promptText: "el y la del con",
      projectTopic: "Topic",
    });
    // All input words are short, only project topic remains
    expect(result).not.toMatch(/\bel\b/);
    expect(result).toContain("Topic");
  });

  it("deduplicates repeated keywords", () => {
    const result = buildEvidenceQuery({
      ph: { name: "evidencia" },
      promptText: "dato importante dato clave",
      projectTopic: "Topic",
    });
    const countDato = result.split("dato").length - 1;
    expect(countDato).toBe(1);
  });

  it("handles null project topic", () => {
    const result = buildEvidenceQuery({
      ph: { name: "evidencia" },
      promptText: "datos estadísticos importantes",
      projectTopic: null,
    });
    expect(result).toBe("datos estadísticos importantes ");
  });

  it("handles empty prompt text", () => {
    const result = buildEvidenceQuery({
      ph: { name: "evidencia" },
      promptText: "",
      projectTopic: "Topic",
    });
    expect(result).toBe(" Topic");
  });

  it("computes the right result for a realistic example", () => {
    const result = buildEvidenceQuery({
      ph: { name: "estadisticas_manuscrito" },
      promptText: "Presenta evidencia sobre la efectividad de mensajes personalizados en apps de citas",
      projectTopic: "Dating app strategies",
    });
    expect(result).toContain("Presenta");
    expect(result).toContain("evidencia");
    expect(result).toContain("efectividad");
    expect(result).toContain("mensajes");
    expect(result).toContain("personalizados");
    expect(result).toContain("citas");
    expect(result).toContain("Dating");
    expect(result).toContain("app");
    expect(result).toContain("strategies");
    // "de", "en" are short words — filtered out
    expect(result).not.toMatch(/\bde\b/);
  });
});

// ---------------------------------------------------------------------------
// matchEvidenceGap — matches query against evidence gaps by word overlap
// ---------------------------------------------------------------------------

describe("matchEvidenceGap", () => {
  const gaps = [
    {
      question: "What is the response rate for personalized first messages?",
      category: "statistics",
      suggestedQueries: [
        "first message response rate dating apps",
        "personalized opener effectiveness",
      ],
      required: true,
    },
    {
      question: "How does message length affect reply probability?",
      category: "engagement",
      suggestedQueries: ["optimal message length dating apps"],
      required: false,
    },
    {
      question: "What is the best time to send a first message?",
      category: "timing",
      suggestedQueries: ["best time to message dating apps"],
      required: false,
    },
  ];

  it("returns best match by word overlap", () => {
    const result = matchEvidenceGap(
      "response rate personalized first messages effectiveness",
      gaps,
    );
    expect(result).not.toBeNull();
    expect(result!.suggestedQueries).toContain("first message response rate dating apps");
  });

  it("returns different match for different queries", () => {
    const result = matchEvidenceGap(
      "message length affect probability optimal",
      gaps,
    );
    expect(result).not.toBeNull();
    expect(result!.suggestedQueries).toContain("optimal message length dating apps");
  });

  it("returns null when no gap matches (below 0.2 threshold)", () => {
    const result = matchEvidenceGap(
      "completely unrelated topic like cooking recipes",
      gaps,
    );
    expect(result).toBeNull();
  });

  it("returns null for empty query", () => {
    const result = matchEvidenceGap("", gaps);
    expect(result).toBeNull();
  });

  it("returns null for query with only short words", () => {
    const result = matchEvidenceGap("a an the in on at", gaps);
    expect(result).toBeNull();
  });

  it("handles empty gaps array", () => {
    const result = matchEvidenceGap("response rate messages", []);
    expect(result).toBeNull();
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
    existingDefinitions: {},
    chapterId: CHAPTER_ID,
  };

  it("does not force RAG for an optional evidence need when classification is LLM", async () => {
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

    const result = await fillOnePlaceholder({ ...baseParams, editorialBundle: bundle });

    expect(retrieveContext).not.toHaveBeenCalled();
    expect(result.provider).toBe("llm");
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

describe("fillPlaceholdersSequential", () => {
  it("retries one transient placeholder failure before marking it failed", async () => {
    vi.mocked(executeVersionedPrompt)
      .mockRejectedValueOnce(new Error("temporary provider failure"))
      .mockResolvedValueOnce({
        result: {
          data: { definition: "Definición válida recuperada en el segundo intento." },
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, costUsd: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
          durationMs: 100,
        },
        executionId: "exec-retry",
        revision: { id: "rev-test", definitionId: "def-test", kind: "placeholder-fill", name: "Placeholder Fill v1", revisionNumber: 1, versionLabel: "v1.0", systemTemplate: "", userTemplate: "", requiredMarkers: [], outputContract: null, configuration: {} },
      });

    const events = [];
    for await (const event of fillPlaceholdersSequential(
      [{ name: "concepto" }],
      "Tema",
      "project-1",
    )) {
      events.push(event);
    }

    expect(executeVersionedPrompt).toHaveBeenCalledTimes(2);
    expect(events.map((event) => event.type)).toEqual(["placeholder", "done"]);
    expect(events.at(-1)).toMatchObject({ filled: 1, failed: 0 });
  });
});
