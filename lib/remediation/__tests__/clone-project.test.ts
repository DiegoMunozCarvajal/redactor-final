import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — hoisted before module mocks
// ---------------------------------------------------------------------------

const {
  mockDbInsert,
  mockDbSelect,
  mockDbTransaction,
  mockBeginClone,
  mockCompleteMaintenanceOp,
  mockIsTemplateEligible,
  mockCopyPrompts,
  mockCopyPlaceholders,
} = vi.hoisted(() => ({
  mockDbInsert: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbTransaction: vi.fn(),
  mockBeginClone: vi.fn(),
  mockCompleteMaintenanceOp: vi.fn(),
  mockIsTemplateEligible: vi.fn(),
  mockCopyPrompts: vi.fn(),
  mockCopyPlaceholders: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/db/drizzle", () => ({
  db: {
    insert: mockDbInsert,
    select: mockDbSelect,
    transaction: mockDbTransaction,
  },
}));

vi.mock("@/lib/remediation/operations", () => ({
  beginClone: mockBeginClone,
  completeMaintenanceOperation: mockCompleteMaintenanceOp,
}));

vi.mock("@/lib/template-pipeline/eligibility", () => ({
  isTemplateEligible: mockIsTemplateEligible,
}));

vi.mock("@/lib/db/queries/copy-template-prompts", () => ({
  copyTemplatePromptsToChapter: mockCopyPrompts,
  copyTemplatePlaceholdersBatch: mockCopyPlaceholders,
}));

// ---------------------------------------------------------------------------
// Imports — must follow mocks
// ---------------------------------------------------------------------------

import {
  planProjectClone,
  executeProjectClone,
  CloneValidationError,
} from "../clone-project";

import type { CloneInput } from "../contracts";
import { OperationStateError } from "../contracts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Drizzle select chain: .from().where().orderBy().limit() */
function selectChain<T>(data: T) {
  const result = Promise.resolve(data);

  // after .orderBy() or direct .limit() on afterWhere
  const withLimit = Object.assign(Promise.resolve(data), {
    limit: vi.fn(() => result),
  });

  // after .where(): returns a thenable with .orderBy() and .limit()
  const afterWhere = Object.assign(Promise.resolve(data), {
    orderBy: vi.fn(() => withLimit),
    limit: vi.fn(() => result),
  });

  // .from() returns object with .where()
  const fromResult = Object.assign(Promise.resolve(data), {
    where: vi.fn(() => afterWhere),
  });

  return {
    from: vi.fn(() => fromResult),
  };
}

/** Drizzle insert chain: .values().returning() */
function insertReturning(rows: unknown[]) {
  return {
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(rows),
    }),
  };
}

// ---------------------------------------------------------------------------
// UUID constants
// ---------------------------------------------------------------------------

const UUID = {
  LEGACY_PROJECT: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  LEGACY_TEMPLATE: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  CLEAN_TEMPLATE: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  OP: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  NEW_PROJECT: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  CH_1: "f0000000-0000-0000-0000-000000000001",
  CH_2: "f0000000-0000-0000-0000-000000000002",
  NEW_CH_1: "f0000000-0000-0000-0000-000000000011",
  NEW_CH_2: "f0000000-0000-0000-0000-000000000012",
  SRC_1: "f0000000-0000-0000-0000-000000000101",
  SRC_2: "f0000000-0000-0000-0000-000000000102",
  PIPELINE_RUN: "ffffffff-ffff-4fff-8fff-ffffffffffff",
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function legacyProjectFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: UUID.LEGACY_PROJECT,
    userId: "user-0000-0000-0000-000000000001",
    name: "My Legacy Project",
    topic: "AI Safety",
    bookTemplateId: UUID.LEGACY_TEMPLATE,
    title: null,
    subtitle: null,
    supersedesProjectId: null,
    createdAt: new Date("2026-01-01"),
    lastAccessedAt: null,
    ...overrides,
  };
}

function legacyTemplateFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: UUID.LEGACY_TEMPLATE,
    name: "Legacy Template v1",
    description: null,
    status: "ready",
    activePipelineRunId: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function cleanTemplateFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: UUID.CLEAN_TEMPLATE,
    name: "Clean Template v2",
    description: null,
    status: "ready",
    activePipelineRunId: UUID.PIPELINE_RUN,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function pipelineRunFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: UUID.PIPELINE_RUN,
    bookTemplateId: UUID.CLEAN_TEMPLATE,
    status: "clean",
    pipelineVersion: "template-pipeline-v2",
    originalityPolicyVersion: "originality-policy-v2",
    report: {},
    createdAt: new Date("2026-07-25T00:00:00Z"),
    completedAt: new Date("2026-07-25T01:00:00Z"),
    ...overrides,
  };
}

function chapterFixture(id: string, position: number, title: string) {
  return { id, position, title };
}

function sourceFixture(
  id: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    projectId: UUID.LEGACY_PROJECT,
    fileName: `source-${id.slice(0, 8)}.md`,
    fileType: "markdown",
    sourceKind: "reference",
    extractedText: "Some extracted text content",
    citation: null,
    processed: true,
    chunkCount: 1,
    ...overrides,
  };
}

function sourceChunkFixture(
  sourceId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `chunk-${sourceId}`,
    sourceId,
    projectId: UUID.LEGACY_PROJECT,
    chunkIndex: 0,
    content: "Chunk content",
    tokenCount: 50,
    embedding: Array.from({ length: 1536 }, () => 0.01),
    ...overrides,
  };
}

function editorialBriefFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "brief-0000-0000-0000-000000000001",
    projectId: UUID.LEGACY_PROJECT,
    version: 2,
    status: "approved",
    content: {
      centralTopic: "AI Safety Fundamentals",
      market: { region: "global", researchLanguage: "en", manuscriptLanguage: "en" },
      audience: {
        primaryReader: "AI researchers",
        situation: "Research setting",
        pain: "Lack of clarity",
        awareness: "Aware",
        objections: ["Too technical"],
      },
      thesis: {
        coreProblem: "Safety alignment",
        desiredOutcome: "Safe AI",
        promise: "Framework for safety",
        mechanism: ["Alignment techniques"],
        realisticBoundary: "Not covering all scenarios",
      },
      voice: {
        tone: ["Academic"],
        posture: "Expert",
        readingLevel: "Advanced",
        avoid: ["Jargon"],
      },
      contentStrategy: {
        pillars: ["Safety"],
        requiredScenarios: ["Training"],
        recurringPattern: ["Case studies"],
        examplePolicy: "Include examples",
      },
      guardrails: {
        ethicalPrinciples: ["Beneficence"],
        forbiddenClaims: ["AGI timelines"],
        forbiddenFraming: ["Fear mongering"],
      },
      evidence: {
        mode: "rag_optional",
        citationPolicy: "APA",
      },
      packaging: {
        titleAngle: "Practical AI Safety",
        hook: "How to align",
        seoTerms: ["AI safety"],
      },
      researchBasis: {
        findings: ["Alignment is hard"],
        inferences: ["Need more research"],
        limitations: ["Limited compute"],
      },
    },
    contentHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    approvedAt: new Date("2026-07-01"),
    createdAt: new Date("2026-06-01"),
    updatedAt: new Date("2026-07-01"),
    ...overrides,
  };
}

function contractFixture(
  chapterId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `contract-${chapterId}`,
    editorialBriefId: "brief-0000-0000-0000-000000000001",
    chapterId,
    content: {
      chapterId,
      jobToBeDone: "Explain safety",
      readerShift: "Understand risks",
      mustCover: ["Alignment"],
      requiredScenarios: ["Training"],
      evidenceNeeds: [],
      toneAdjustment: "Neutral",
      avoidOverlapWith: [],
      transitionToNext: "Next chapter",
    },
    contentHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    createdAt: new Date("2026-06-01"),
    ...overrides,
  };
}

function briefSourceFixture(
  sourceId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `briefsrc-${sourceId}`,
    editorialBriefId: "brief-0000-0000-0000-000000000001",
    sourceId,
    useForExtraction: true,
    useForEvidence: true,
    createdAt: new Date("2026-06-01"),
    ...overrides,
  };
}

function opRow(overrides: Record<string, unknown> = {}) {
  return {
    id: UUID.OP,
    kind: "project_clone",
    inputHash: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    status: "running",
    resultTemplateId: null,
    resultProjectId: null,
    report: {},
    createdAt: new Date("2026-07-25T00:00:00Z"),
    completedAt: null,
    ...overrides,
  };
}

function validCloneInput(
  overrides: Partial<CloneInput & { dryRun: boolean }> = {},
): CloneInput & { dryRun: boolean } {
  return {
    operationId: UUID.OP,
    legacyProjectId: UUID.LEGACY_PROJECT,
    cleanTemplateId: UUID.CLEAN_TEMPLATE,
    legacyProjectStateHash:
      "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    cleanTemplateArtifactSetHash:
      "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    dryRun: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

/**
 * Setup standard mock chain for planProjectClone validation path.
 * Covers all 9 db.select() calls in the default happy path.
 */
function setupPlanMocks(
  chapterCount: number,
  sourceCount: number,
  hasApprovedBrief: boolean,
  hasProjectPrompts: boolean,
) {
  // 1. Legacy project
  mockDbSelect.mockReturnValueOnce(selectChain([legacyProjectFixture()]));
  // 2. Legacy template
  mockDbSelect.mockReturnValueOnce(selectChain([legacyTemplateFixture()]));
  // 3. Clean template
  mockDbSelect.mockReturnValueOnce(selectChain([cleanTemplateFixture()]));
  // 4. Pipeline run for clean template
  mockDbSelect.mockReturnValueOnce(selectChain([pipelineRunFixture()]));
  // 5. Legacy template chapters
  const legacyChapters = Array.from({ length: chapterCount }, (_, i) =>
    chapterFixture(
      i === 0 ? UUID.CH_1 : UUID.CH_2,
      i,
      `Chapter ${i + 1}`,
    ),
  );
  mockDbSelect.mockReturnValueOnce(selectChain(legacyChapters));
  // 6. Clean template chapters
  const cleanChapters = Array.from({ length: chapterCount }, (_, i) =>
    chapterFixture(
      i === 0 ? UUID.CH_1 : UUID.CH_2,
      i,
      `Chapter ${i + 1}`,
    ),
  );
  mockDbSelect.mockReturnValueOnce(selectChain(cleanChapters));
  // 7. Legacy sources
  const srcIds = [UUID.SRC_1, UUID.SRC_2];
  const sources = Array.from({ length: sourceCount }, (_, i) => ({
    id: srcIds[i] ?? `${UUID.SRC_1}-${i}`,
  }));
  mockDbSelect.mockReturnValueOnce(selectChain(sources));
  // 8. Editorial brief check
  mockDbSelect.mockReturnValueOnce(
    selectChain(hasApprovedBrief ? [editorialBriefFixture()] : []),
  );
  // 9. Project prompts check
  mockDbSelect.mockReturnValueOnce(
    selectChain(hasProjectPrompts ? [{ id: "prompt-1" }] : []),
  );
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockDbInsert.mockReset();
  mockDbSelect.mockReset();
  mockDbTransaction.mockReset();
  mockBeginClone.mockReset();
  mockCompleteMaintenanceOp.mockReset();
  mockIsTemplateEligible.mockReset();
  mockCopyPrompts.mockReset();
  mockCopyPlaceholders.mockReset();

  // Default: isTemplateEligible returns true
  mockIsTemplateEligible.mockReturnValue(true);
  // Default: copy helpers resolve
  mockCopyPrompts.mockResolvedValue(undefined);
  mockCopyPlaceholders.mockResolvedValue(undefined);
  // Default: beginClone returns "new"
  mockBeginClone.mockResolvedValue({
    state: "new",
    operation: opRow(),
  });
  // Default: complete succeeds
  mockCompleteMaintenanceOp.mockResolvedValue(
    opRow({ status: "completed", resultProjectId: UUID.NEW_PROJECT }),
  );
});

// ---------------------------------------------------------------------------
// planProjectClone
// ---------------------------------------------------------------------------

describe("planProjectClone", () => {
  // -----------------------------------------------------------------------
  // Test 1 (plan phase): validates successfully with no warnings
  // -----------------------------------------------------------------------

  it("validates inputs and returns plan with correct metadata", async () => {
    setupPlanMocks(2, 2, false, false);

    const plan = await planProjectClone(validCloneInput({ dryRun: true }));

    expect(plan.legacyProjectId).toBe(UUID.LEGACY_PROJECT);
    expect(plan.legacyProjectName).toBe("My Legacy Project");
    expect(plan.legacyTemplateId).toBe(UUID.LEGACY_TEMPLATE);
    expect(plan.cleanTemplateId).toBe(UUID.CLEAN_TEMPLATE);
    expect(plan.cleanTemplateName).toBe("Clean Template v2");
    expect(plan.chapterCount).toBe(2);
    expect(plan.sourceCount).toBe(2);
    expect(plan.hasApprovedBrief).toBe(false);
    expect(plan.dryRun).toBe(true);
    expect(plan.warnings).toHaveLength(0);
    expect(plan.chapterMappings).toHaveLength(2);
    expect(plan.sourceMappings).toHaveLength(2);

    // No DB writes
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Test 5 (plan phase): target not eligible
  // -----------------------------------------------------------------------

  it("throws CloneValidationError when clean template is not eligible", async () => {
    mockIsTemplateEligible.mockReturnValue(false);

    // Need to still set up the selects that happen before the eligibility check
    // (project, legacy template, clean template, pipeline run)
    mockDbSelect.mockReturnValueOnce(selectChain([legacyProjectFixture()]));
    mockDbSelect.mockReturnValueOnce(selectChain([legacyTemplateFixture()]));
    mockDbSelect.mockReturnValueOnce(selectChain([cleanTemplateFixture()]));
    mockDbSelect.mockReturnValueOnce(selectChain([pipelineRunFixture()]));

    await expect(
      planProjectClone(validCloneInput({ dryRun: true })),
    ).rejects.toThrow(CloneValidationError);
  });

  // -----------------------------------------------------------------------
  // Test 7 (plan phase): chapter count mismatch
  // -----------------------------------------------------------------------

  it("throws CloneValidationError when chapter counts differ", async () => {
    mockDbSelect.mockReturnValueOnce(selectChain([legacyProjectFixture()]));
    mockDbSelect.mockReturnValueOnce(selectChain([legacyTemplateFixture()]));
    mockDbSelect.mockReturnValueOnce(selectChain([cleanTemplateFixture()]));
    mockDbSelect.mockReturnValueOnce(selectChain([pipelineRunFixture()]));
    // Legacy: 2 chapters
    mockDbSelect.mockReturnValueOnce(
      selectChain([
        chapterFixture(UUID.CH_1, 0, "Chapter 1"),
        chapterFixture(UUID.CH_2, 1, "Chapter 2"),
      ]),
    );
    // Clean: 1 chapter
    mockDbSelect.mockReturnValueOnce(
      selectChain([chapterFixture(UUID.CH_1, 0, "Chapter 1")]),
    );

    await expect(
      planProjectClone(validCloneInput({ dryRun: true })),
    ).rejects.toThrow(CloneValidationError);

    // Second call — setup mocks again since first consumed them
    mockDbSelect.mockReturnValueOnce(selectChain([legacyProjectFixture()]));
    mockDbSelect.mockReturnValueOnce(selectChain([legacyTemplateFixture()]));
    mockDbSelect.mockReturnValueOnce(selectChain([cleanTemplateFixture()]));
    mockDbSelect.mockReturnValueOnce(selectChain([pipelineRunFixture()]));
    mockDbSelect.mockReturnValueOnce(
      selectChain([
        chapterFixture(UUID.CH_1, 0, "Chapter 1"),
        chapterFixture(UUID.CH_2, 1, "Chapter 2"),
      ]),
    );
    mockDbSelect.mockReturnValueOnce(
      selectChain([chapterFixture(UUID.CH_1, 0, "Chapter 1")]),
    );

    await expect(
      planProjectClone(validCloneInput({ dryRun: true })),
    ).rejects.toThrow(/chapter count mismatch/i);
  });

  // -----------------------------------------------------------------------
  // Test: legacy project not found
  // -----------------------------------------------------------------------

  it("throws CloneValidationError when legacy project does not exist", async () => {
    mockDbSelect.mockReturnValueOnce(selectChain([]));

    await expect(
      planProjectClone(validCloneInput({ dryRun: true })),
    ).rejects.toThrow(CloneValidationError);
  });

  // -----------------------------------------------------------------------
  // Test: legacy project has no template
  // -----------------------------------------------------------------------

  it("throws CloneValidationError when legacy project has no template", async () => {
    mockDbSelect.mockReturnValueOnce(
      selectChain([legacyProjectFixture({ bookTemplateId: null })]),
    );

    await expect(
      planProjectClone(validCloneInput({ dryRun: true })),
    ).rejects.toThrow(CloneValidationError);
  });

  // -----------------------------------------------------------------------
  // Test: clean template not found
  // -----------------------------------------------------------------------

  it("throws CloneValidationError when clean template does not exist", async () => {
    mockDbSelect.mockReturnValueOnce(selectChain([legacyProjectFixture()]));
    mockDbSelect.mockReturnValueOnce(selectChain([legacyTemplateFixture()]));
    // Clean template not found
    mockDbSelect.mockReturnValueOnce(selectChain([]));

    await expect(
      planProjectClone(validCloneInput({ dryRun: true })),
    ).rejects.toThrow(CloneValidationError);
  });

  // -----------------------------------------------------------------------
  // Test 8 (plan phase): project prompts warning
  // -----------------------------------------------------------------------

  it("includes warning when legacy project has project-specific prompts", async () => {
    setupPlanMocks(1, 1, false, true);

    const plan = await planProjectClone(validCloneInput({ dryRun: true }));

    expect(plan.warnings.length).toBeGreaterThan(0);
    expect(plan.warnings[0].toLowerCase()).toContain("prompts");
  });
});

// ---------------------------------------------------------------------------
// executeProjectClone
// ---------------------------------------------------------------------------

describe("executeProjectClone", () => {
  // -----------------------------------------------------------------------
  // Test 1 (execute): copies inputs and config but no generated content
  // -----------------------------------------------------------------------

  it("creates cloned project, copies sources, skips generated content", async () => {
    setupPlanMocks(2, 2, false, false);

    // Transaction mock: creates project, chapters, copies sources/chunks
    mockDbTransaction.mockImplementationOnce(
      async (cb: (tx: Record<string, unknown>) => Promise<unknown>) => {
        const txInsert = vi.fn();
        const txSelect = vi.fn();

        // tx.insert(projects).values(...).returning()
        txInsert.mockReturnValueOnce(
          insertReturning([{ id: UUID.NEW_PROJECT }]),
        );
        // tx.insert(chapters).values(...).returning() — 2 chapters
        txInsert.mockReturnValueOnce(
          insertReturning([{ id: UUID.NEW_CH_1 }]),
        );
        txInsert.mockReturnValueOnce(
          insertReturning([{ id: UUID.NEW_CH_2 }]),
        );
        // tx.insert(sources).values(...) — no returning used for sources
        txInsert.mockReturnValueOnce({ values: vi.fn() });
        txInsert.mockReturnValueOnce({ values: vi.fn() });
        // tx.insert(sourceChunks).values(...) — no returning
        txInsert.mockReturnValueOnce({ values: vi.fn() });
        txInsert.mockReturnValueOnce({ values: vi.fn() });

        // tx.select().from(sources).where(...) — inside transaction
        txSelect.mockReturnValueOnce(
          selectChain([
            sourceFixture(UUID.SRC_1),
            sourceFixture(UUID.SRC_2),
          ]),
        );
        // tx.select().from(sourceChunks).where(...) — per source
        txSelect.mockReturnValueOnce(
          selectChain([sourceChunkFixture(UUID.SRC_1)]),
        );
        txSelect.mockReturnValueOnce(
          selectChain([sourceChunkFixture(UUID.SRC_2)]),
        );
        // tx.select().from(editorialBriefs).where(...) — no brief
        txSelect.mockReturnValueOnce(selectChain([]));

        return cb({ insert: txInsert, select: txSelect });
      },
    );

    const result = await executeProjectClone(validCloneInput());

    expect(result.newProjectId).toBe(UUID.NEW_PROJECT);
    expect(result.operationId).toBe(UUID.OP);

    // Verify beginClone was called
    expect(mockBeginClone).toHaveBeenCalledTimes(1);
    // Verify operation was completed
    expect(mockCompleteMaintenanceOp).toHaveBeenCalledTimes(1);
    expect(mockCompleteMaintenanceOp).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: UUID.OP,
        resultProjectId: UUID.NEW_PROJECT,
      }),
    );
    // Verify copy helpers were called
    expect(mockCopyPrompts).toHaveBeenCalledTimes(2); // 2 chapters
    expect(mockCopyPlaceholders).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // Test 2 (execute): remaps brief chapter and source IDs
  // -----------------------------------------------------------------------

  it("remaps editorial brief chapter and source IDs then recomputes hashes", async () => {
    setupPlanMocks(2, 2, true, false);

    // Transaction mock with approved editorial brief
    mockDbTransaction.mockImplementationOnce(
      async (cb: (tx: Record<string, unknown>) => Promise<unknown>) => {
        const txInsert = vi.fn();
        const txSelect = vi.fn();

        // tx.insert(projects) returning
        txInsert.mockReturnValueOnce(
          insertReturning([{ id: UUID.NEW_PROJECT }]),
        );
        // tx.insert(chapters) — 2 chapters
        txInsert.mockReturnValueOnce(
          insertReturning([{ id: UUID.NEW_CH_1 }]),
        );
        txInsert.mockReturnValueOnce(
          insertReturning([{ id: UUID.NEW_CH_2 }]),
        );
        // tx.insert(sources) — 2 sources
        txInsert.mockReturnValueOnce({ values: vi.fn() });
        txInsert.mockReturnValueOnce({ values: vi.fn() });
        // tx.insert(sourceChunks) — 2 chunks
        txInsert.mockReturnValueOnce({ values: vi.fn() });
        txInsert.mockReturnValueOnce({ values: vi.fn() });
        // tx.insert(editorialBriefs) returning
        txInsert.mockReturnValueOnce(
          insertReturning([{ id: "new-brief-id" }]),
        );
        // tx.insert(chapterEditorialContracts) — 2 contracts
        txInsert.mockReturnValueOnce({ values: vi.fn() });
        txInsert.mockReturnValueOnce({ values: vi.fn() });
        // tx.insert(editorialBriefSources) — 2 brief sources
        txInsert.mockReturnValueOnce({ values: vi.fn() });
        txInsert.mockReturnValueOnce({ values: vi.fn() });

        // tx.select().from(sources) — 2 legacy sources
        txSelect.mockReturnValueOnce(
          selectChain([
            sourceFixture(UUID.SRC_1),
            sourceFixture(UUID.SRC_2),
          ]),
        );
        // tx.select().from(sourceChunks) — per source
        txSelect.mockReturnValueOnce(
          selectChain([sourceChunkFixture(UUID.SRC_1)]),
        );
        txSelect.mockReturnValueOnce(
          selectChain([sourceChunkFixture(UUID.SRC_2)]),
        );
        // tx.select().from(editorialBriefs) — approved brief found
        txSelect.mockReturnValueOnce(
          selectChain([editorialBriefFixture()]),
        );
        // tx.select().from(chapterEditorialContracts) — 2 contracts
        txSelect.mockReturnValueOnce(
          selectChain([
            contractFixture(UUID.CH_1),
            contractFixture(UUID.CH_2),
          ]),
        );
        // tx.select().from(editorialBriefSources) — 2 sources
        txSelect.mockReturnValueOnce(
          selectChain([
            briefSourceFixture(UUID.SRC_1),
            briefSourceFixture(UUID.SRC_2),
          ]),
        );

        return cb({ insert: txInsert, select: txSelect });
      },
    );

    const result = await executeProjectClone(validCloneInput());

    expect(result.newProjectId).toBe(UUID.NEW_PROJECT);
    // Verify brief was copied (hasApprovedBrief was true)
    expect(mockCompleteMaintenanceOp).toHaveBeenCalledWith(
      expect.objectContaining({
        report: expect.objectContaining({
          counts: expect.objectContaining({
            hasApprovedBrief: 1,
          }),
        }),
      }),
    );
  });

  // -----------------------------------------------------------------------
  // Test 3 (execute): dry-run performs no writes
  // -----------------------------------------------------------------------

  it("dry-run returns empty result and performs no writes", async () => {
    setupPlanMocks(2, 2, false, false);

    const result = await executeProjectClone(validCloneInput({ dryRun: true }));

    expect(result.newProjectId).toBe("");
    expect(result.operationId).toBe(UUID.OP);
    expect(mockDbInsert).not.toHaveBeenCalled();
    expect(mockDbTransaction).not.toHaveBeenCalled();
    expect(mockBeginClone).not.toHaveBeenCalled();
    expect(mockCompleteMaintenanceOp).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Test 4 (execute): same operation returns existing result
  // -----------------------------------------------------------------------

  it("returns existing project ID when operation is already completed", async () => {
    setupPlanMocks(2, 2, false, false);
    mockBeginClone.mockResolvedValueOnce({
      state: "completed",
      operation: opRow({
        status: "completed",
        resultProjectId: UUID.NEW_PROJECT,
        completedAt: new Date("2026-07-25T01:00:00Z"),
      }),
    });

    const result = await executeProjectClone(validCloneInput());

    expect(result.newProjectId).toBe(UUID.NEW_PROJECT);
    expect(mockDbTransaction).not.toHaveBeenCalled();
    expect(mockCompleteMaintenanceOp).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Test: operation running throws
  // -----------------------------------------------------------------------

  it("throws when clone operation is already running", async () => {
    setupPlanMocks(1, 1, false, false);
    mockBeginClone.mockResolvedValueOnce({
      state: "running",
      operation: opRow(),
    });

    await expect(
      executeProjectClone(validCloneInput()),
    ).rejects.toThrow(OperationStateError);
  });
});
