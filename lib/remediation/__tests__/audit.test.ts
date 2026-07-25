import { describe, expect, it, vi, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before module mocks
// ---------------------------------------------------------------------------

const { mockDbSelect } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
}));

vi.mock("@/lib/db/drizzle", () => ({
  db: { select: mockDbSelect },
}));

vi.mock("@/lib/template-pipeline/compiler", () => ({
  COMPILER_VERSION: "template-compiler-v1",
}));

// ---------------------------------------------------------------------------
// Imports — must follow mocks
// ---------------------------------------------------------------------------

import { auditTemplate, auditAllTemplates } from "../audit";
import type { SafeAuditReport } from "../audit";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a chainable select mock that resolves to `data`.
 *
 * Drizzle semantics: select() returns a query builder (thenable).
 *   - .from() returns a thenable query builder that also has .where()
 *   - .where() returns a thenable query builder that also has .orderBy()
 *   - .orderBy() returns the same thenable
 *
 * This mock handles all three patterns:
 *   select().from(t)            — no .where(), from result is awaitable
 *   select().from(t).where(...) — where result is awaitable
 *   select().from(t).where(...).orderBy(...) — orderBy returns the same promise
 */
function selectChain(data: unknown) {
  const result = Promise.resolve(data);
  // .where() returns this: thenable + .orderBy()
  const whereResult = Object.assign(Promise.resolve(data), {
    orderBy: vi.fn(() => result),
  });
  // .from() returns this: thenable + .where()
  const fromResult = Object.assign(Promise.resolve(data), {
    where: vi.fn(() => whereResult),
  });

  return {
    from: vi.fn(() => fromResult),
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const UUID = {
  TEMPLATE: "00000000-0000-0000-0000-000000000001",
  PROJECT: "00000000-0000-0000-0000-000000000010",
  PIPELINE_RUN: "00000000-0000-0000-0000-000000000020",
  CHAPTER_1: "00000000-0000-0000-0000-000000000031",
  CHAPTER_2: "00000000-0000-0000-0000-000000000032",
  CHAPTER_3: "00000000-0000-0000-0000-000000000033",
  GENERATION: "00000000-0000-0000-0000-000000000040",
};

const COMPILER_VERSION_MOCK = "template-compiler-v1";

function templateFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: UUID.TEMPLATE,
    name: "Test Template",
    description: null,
    status: "ready",
    activePipelineRunId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function pipelineRunFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: UUID.PIPELINE_RUN,
    bookTemplateId: UUID.TEMPLATE,
    status: "clean",
    pipelineVersion: COMPILER_VERSION_MOCK,
    compilerVersion: COMPILER_VERSION_MOCK,
    compilerHash: "a".repeat(64),
    recipeCatalogHash: "a".repeat(64),
    rhetoricTraceRevisionId: null,
    sourceProfileVersion: null,
    originalityPolicyVersion: "originality-policy-v2",
    failureStage: null,
    report: {},
    createdAt: new Date(),
    completedAt: new Date(),
    ...overrides,
  };
}

/** Select call counts per scenario:
 *  With projects:  6 (template, pipelineRuns, projects, assessments, chapters, generations)
 *  Without projects: 4 (template, pipelineRuns, projects, chapters)
 */

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("auditTemplate", () => {
  it("classifies clean_v2 when template has a supported clean pipeline run", async () => {
    mockDbSelect
      .mockReturnValueOnce(
        selectChain([
          templateFixture({ activePipelineRunId: UUID.PIPELINE_RUN }),
        ]),
      )
      .mockReturnValueOnce(selectChain([pipelineRunFixture()]))
      .mockReturnValueOnce(selectChain([{ id: UUID.PROJECT }]))
      .mockReturnValueOnce(selectChain([]))
      .mockReturnValueOnce(
        selectChain([{ id: UUID.CHAPTER_1 }, { id: UUID.CHAPTER_2 }]),
      )
      .mockReturnValueOnce(selectChain([{ id: UUID.GENERATION }]));

    const result = await auditTemplate(UUID.TEMPLATE);

    expect(result.classification).toBe("clean_v2");
    expect(result.recommendedAction).toBe("none — template is clean");
    expect(result.pipelineVersion).toBe(COMPILER_VERSION_MOCK);
    expect(result.pipelineRunId).toBe(UUID.PIPELINE_RUN);
  });

  it("classifies legacy_unverified when no pipeline run and no assessments exist", async () => {
    mockDbSelect
      .mockReturnValueOnce(selectChain([templateFixture()]))
      .mockReturnValueOnce(selectChain([]))
      .mockReturnValueOnce(selectChain([]))
      .mockReturnValueOnce(selectChain([]));

    const result = await auditTemplate(UUID.TEMPLATE);

    expect(result.classification).toBe("legacy_unverified");
    expect(result.recommendedAction).toBe(
      "review manually or regenerate with sources",
    );
  });

  it("classifies suspect when an originality assessment has a suspect decision", async () => {
    mockDbSelect
      .mockReturnValueOnce(selectChain([templateFixture()]))
      .mockReturnValueOnce(selectChain([]))
      .mockReturnValueOnce(selectChain([{ id: UUID.PROJECT }]))
      .mockReturnValueOnce(selectChain([{ decision: "suspect" }]))
      .mockReturnValueOnce(selectChain([{ id: UUID.CHAPTER_1 }]))
      .mockReturnValueOnce(selectChain([]));

    const result = await auditTemplate(UUID.TEMPLATE);

    expect(result.classification).toBe("suspect");
    expect(result.recommendedAction).toBe(
      "regenerate with sources recommended",
    );
  });

  it("classifies contaminated when an originality assessment has a contaminated decision", async () => {
    mockDbSelect
      .mockReturnValueOnce(selectChain([templateFixture()]))
      .mockReturnValueOnce(selectChain([]))
      .mockReturnValueOnce(selectChain([{ id: UUID.PROJECT }]))
      .mockReturnValueOnce(selectChain([{ decision: "contaminated" }]))
      .mockReturnValueOnce(selectChain([{ id: UUID.CHAPTER_1 }]))
      .mockReturnValueOnce(selectChain([]));

    const result = await auditTemplate(UUID.TEMPLATE);

    expect(result.classification).toBe("contaminated");
    expect(result.recommendedAction).toBe(
      "regenerate with sources required",
    );
  });

  it("does not leak snippets, canonicalLabel, or regex patterns in JSON output", async () => {
    mockDbSelect
      .mockReturnValueOnce(selectChain([templateFixture()]))
      .mockReturnValueOnce(selectChain([]))
      .mockReturnValueOnce(selectChain([]))
      .mockReturnValueOnce(selectChain([]));

    const result = await auditTemplate(UUID.TEMPLATE);
    const json = JSON.stringify(result);

    expect(json).not.toContain("snippet");
    expect(json).not.toContain("canonicalLabel");
    // Backslash-b regex patterns (e.g. /\bword\b/ in JSON becomes \\b in string)
    expect(json).not.toContain("\\\\b");
  });

  it("includes derived project IDs and project count", async () => {
    const projectIds = [
      { id: "p0000001-0000-0000-0000-000000000001" },
      { id: "p0000002-0000-0000-0000-000000000002" },
      { id: "p0000003-0000-0000-0000-000000000003" },
    ];

    mockDbSelect
      .mockReturnValueOnce(selectChain([templateFixture()]))
      .mockReturnValueOnce(selectChain([]))
      .mockReturnValueOnce(selectChain(projectIds))
      .mockReturnValueOnce(selectChain([]))
      .mockReturnValueOnce(selectChain([]))
      .mockReturnValueOnce(selectChain([]));

    const result = await auditTemplate(UUID.TEMPLATE);

    expect(result.derivedProjectIds).toHaveLength(3);
    expect(result.derivedProjectIds[0]).toBe(
      "p0000001-0000-0000-0000-000000000001",
    );
    expect(result.projectCount).toBe(3);
  });

  it("includes templateName, chapterCount, and pipelineVersion when available", async () => {
    mockDbSelect
      .mockReturnValueOnce(
        selectChain([
          templateFixture({ name: "Template Alpha" }),
        ]),
      )
      .mockReturnValueOnce(
        selectChain([
          pipelineRunFixture({ pipelineVersion: "v2.0" }),
        ]),
      )
      .mockReturnValueOnce(selectChain([]))
      .mockReturnValueOnce(
        selectChain([
          { id: UUID.CHAPTER_1 },
          { id: UUID.CHAPTER_2 },
          { id: UUID.CHAPTER_3 },
        ]),
      );

    const result = await auditTemplate(UUID.TEMPLATE);

    expect(result.templateName).toBe("Template Alpha");
    expect(result.chapterCount).toBe(3);
    expect(result.pipelineVersion).toBe("v2.0");
  });

  it("returns a safe audit report with non-empty recommended action", async () => {
    mockDbSelect
      .mockReturnValueOnce(selectChain([{ id: UUID.TEMPLATE }]))
      .mockReturnValueOnce(selectChain([templateFixture()]))
      .mockReturnValueOnce(selectChain([]))
      .mockReturnValueOnce(selectChain([]))
      .mockReturnValueOnce(selectChain([]));

    const results = await auditAllTemplates();

    expect(results).toHaveLength(1);
    for (const r of results) {
      expect(r.recommendedAction).toBeTruthy();
      expect(typeof r.recommendedAction).toBe("string");
    }
  });
});
