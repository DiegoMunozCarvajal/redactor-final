import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — hoisted before module mocks
// ---------------------------------------------------------------------------

const {
  mockDbInsert,
  mockDbSelect,
  mockDbTransaction,
  mockBeginRegeneration,
  mockTriggerEnqueue,
  mockReaddir,
  mockReadFile,
  mockResolvePromptRevision,
} = vi.hoisted(() => ({
  mockDbInsert: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbTransaction: vi.fn(),
  mockBeginRegeneration: vi.fn(),
  mockTriggerEnqueue: vi.fn(),
  mockReaddir: vi.fn(),
  mockReadFile: vi.fn(),
  mockResolvePromptRevision: vi.fn(),
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
  beginRegeneration: mockBeginRegeneration,
}));

vi.mock("@/trigger/generate-template", () => ({
  generateTemplate: { trigger: mockTriggerEnqueue },
}));

vi.mock("fs/promises", () => ({
  readdir: mockReaddir,
  readFile: mockReadFile,
}));

vi.mock("@/lib/prompts/repository", () => ({
  resolvePromptRevision: mockResolvePromptRevision,
}));

// ---------------------------------------------------------------------------
// Imports — must follow mocks
// ---------------------------------------------------------------------------

import {
  planTemplateRegeneration,
  executeTemplateRegeneration,
  TemplateValidationError,
} from "../regenerate-template";

import type { PlanRegenerationInput } from "../regenerate-template";
import { OperationInputConflictError } from "../contracts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Drizzle select chain: .from().where().orderBy().limit() */
function selectChain(data: unknown) {
  const result = Promise.resolve(data);
  const limitableResult = Object.assign(Promise.resolve(data), {
    limit: vi.fn(() => result),
  });
  const whereResult = Object.assign(Promise.resolve(data), {
    orderBy: vi.fn(() => limitableResult),
  });
  const fromResult = Object.assign(Promise.resolve(data), {
    where: vi.fn(() => whereResult),
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

/** Dirent-like object for fs.readdir withFileTypes:true */
function dirEnt(name: string, isFileVal = true) {
  return { name, isFile: () => isFileVal };
}

// ---------------------------------------------------------------------------
// UUID constants
// ---------------------------------------------------------------------------

const UUID = {
  TEMPLATE: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  NEW_TEMPLATE: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  OP: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  REV_RHET: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  REV_PROF: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  CH_1: "f0000000-0000-0000-0000-000000000001",
  CH_2: "f0000000-0000-0000-0000-000000000002",
  CH_3: "f0000000-0000-0000-0000-000000000003",
  PIPELINE_RUN: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  BAD_REV: "00000000-0000-4000-8000-000000000000",
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function templateFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: UUID.TEMPLATE,
    name: "Legacy Template",
    description: null,
    status: "ready",
    activePipelineRunId: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function chapterFixture(id: string, position: number, title: string) {
  return { id, position, title };
}

function newTemplateFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: UUID.NEW_TEMPLATE,
    name: "Legacy Template (clean v2)",
    status: "generating",
    ...overrides,
  };
}

function pipelineRunFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: UUID.PIPELINE_RUN,
    bookTemplateId: UUID.NEW_TEMPLATE,
    status: "running",
    pipelineVersion: "template-pipeline-v2",
    report: {
      operationId: UUID.OP,
      legacyTemplateId: UUID.TEMPLATE,
    },
    ...overrides,
  };
}

function opRow(overrides: Record<string, unknown> = {}) {
  return {
    id: UUID.OP,
    kind: "template_regeneration",
    inputHash: "",
    status: "running",
    resultTemplateId: null,
    resultProjectId: null,
    report: {},
    createdAt: new Date("2026-07-25T00:00:00Z"),
    completedAt: null,
    ...overrides,
  };
}

function validInput(overrides: Partial<PlanRegenerationInput> = {}): PlanRegenerationInput {
  return {
    operationId: UUID.OP,
    legacyTemplateId: UUID.TEMPLATE,
    rhetoricTraceRevisionId: UUID.REV_RHET,
    sourceProfilerRevisionId: UUID.REV_PROF,
    sourceDir: "/tmp/sources",
    dryRun: false,
    ...overrides,
  };
}

/** Setup standard mock chain for planTemplateRegeneration validation path. */
function setupPlanMocks(chapterCount: number, fileCount: number) {
  const chapters = Array.from({ length: chapterCount }, (_, i) => {
    const ids = [UUID.CH_1, UUID.CH_2, UUID.CH_3];
    return chapterFixture(ids[i] ?? `${ids[0]}-${i}`, i, `Capítulo ${i + 1}`);
  });
  const files = Array.from({ length: fileCount }, (_, i) => dirEnt(`file${i + 1}.md`));
  const contents = Array.from({ length: fileCount }, (_, i) => `# Content ${i + 1}`);

  mockDbSelect
    .mockReturnValueOnce(selectChain([templateFixture()]))
    .mockReturnValueOnce(selectChain(chapters));
  mockReaddir.mockResolvedValue(files);
  for (let i = 0; i < fileCount; i++) {
    mockReadFile.mockResolvedValueOnce(contents[i]);
  }
  mockResolvePromptRevision
    .mockResolvedValueOnce({ configuration: { pipelineContract: "trace-ir-v2" } })
    .mockResolvedValueOnce({ configuration: { pipelineContract: "source-profile-v1" } });
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockDbSelect.mockReset();
  mockDbInsert.mockReset();
  mockDbTransaction.mockReset();
  mockBeginRegeneration.mockReset();
  mockTriggerEnqueue.mockReset();
  mockReaddir.mockReset();
  mockReadFile.mockReset();
  mockResolvePromptRevision.mockReset();
});

// ---------------------------------------------------------------------------
// planTemplateRegeneration
// ---------------------------------------------------------------------------

describe("planTemplateRegeneration", () => {
  // -----------------------------------------------------------------------
  // Test 1: dry-run validates and plans without writes
  // -----------------------------------------------------------------------

  it("dry-run validates and plans without writes", async () => {
    setupPlanMocks(2, 2);

    const plan = await planTemplateRegeneration(validInput({ dryRun: true }));

    expect(plan.legacyTemplateId).toBe(UUID.TEMPLATE);
    expect(plan.legacyTemplateName).toBe("Legacy Template");
    expect(plan.chapterCount).toBe(2);
    expect(plan.sourceHashes).toHaveLength(2);
    for (const hash of plan.sourceHashes) {
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(plan.compilerHash).toMatch(/^[a-f0-9]{64}$/);
    expect(plan.policyVersion).toBe("originality-policy-v2");
    expect(plan.pipelineVersion).toBe("template-pipeline-v2");
    expect(plan.dryRun).toBe(true);
    expect(plan.chapters).toHaveLength(2);
    expect(plan.chapters[0].contentMd).toBe("# Content 1");
    expect(plan.chapters[1].contentMd).toBe("# Content 2");
    // No DB writes
    expect(mockDbInsert).not.toHaveBeenCalled();
    expect(mockTriggerEnqueue).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Test 4: source file count mismatch
  // -----------------------------------------------------------------------

  it("throws validation error when source file count does not match chapter count", async () => {
    setupPlanMocks(3, 1);

    await expect(
      planTemplateRegeneration(validInput({ dryRun: true })),
    ).rejects.toThrow(TemplateValidationError);

    // Second call — setup mocks again since first consumed them
    setupPlanMocks(3, 1);
    await expect(
      planTemplateRegeneration(validInput({ dryRun: true })),
    ).rejects.toThrow(/match|count|file/i);
  });

  // -----------------------------------------------------------------------
  // Test 5: incompatible revisions
  // -----------------------------------------------------------------------

  it("throws validation error when rhetoric revision is not found", async () => {
    // Template + chapters mocks (will be consumed if we reach them)
    mockDbSelect
      .mockReturnValueOnce(selectChain([templateFixture()]))
      .mockReturnValueOnce(selectChain([chapterFixture(UUID.CH_1, 0, "Ch1")]));
    mockReaddir.mockResolvedValue([dirEnt("file1.md")]);
    mockReadFile.mockResolvedValueOnce("# Content");

    // First resolvePromptRevision call rejects
    mockResolvePromptRevision.mockRejectedValueOnce(new Error("Revision not found"));

    await expect(
      planTemplateRegeneration(
        validInput({
          rhetoricTraceRevisionId: UUID.BAD_REV,
          dryRun: true,
        }),
      ),
    ).rejects.toThrow(TemplateValidationError);
  });

  it("throws validation error when source profiler revision is not found", async () => {
    mockDbSelect
      .mockReturnValueOnce(selectChain([templateFixture()]))
      .mockReturnValueOnce(selectChain([chapterFixture(UUID.CH_1, 0, "Ch1")]));
    mockReaddir.mockResolvedValue([dirEnt("file1.md")]);
    mockReadFile.mockResolvedValueOnce("# Content");

    // Rhetoric resolves ok, profiler rejects
    mockResolvePromptRevision
      .mockResolvedValueOnce({ configuration: { pipelineContract: "trace-ir-v2" } })
      .mockRejectedValueOnce(new Error("Revision not found"));

    await expect(
      planTemplateRegeneration(
        validInput({
          sourceProfilerRevisionId: UUID.BAD_REV,
          dryRun: true,
        }),
      ),
    ).rejects.toThrow(TemplateValidationError);
  });

  // -----------------------------------------------------------------------
  // Test 6: legacy template not found
  // -----------------------------------------------------------------------

  it("throws validation error when legacy template does not exist", async () => {
    mockResolvePromptRevision
      .mockResolvedValueOnce({ configuration: { pipelineContract: "trace-ir-v2" } })
      .mockResolvedValueOnce({ configuration: { pipelineContract: "source-profile-v1" } });

    mockDbSelect.mockReturnValueOnce(selectChain([]));

    await expect(
      planTemplateRegeneration(validInput({ dryRun: true })),
    ).rejects.toThrow(TemplateValidationError);
  });

  // -----------------------------------------------------------------------
  // Test 7: clean compiler/policy versions
  // -----------------------------------------------------------------------

  it("plan includes compilerHash and policyVersion from current constants", async () => {
    setupPlanMocks(1, 1);

    const plan = await planTemplateRegeneration(validInput({ dryRun: true }));

    expect(plan.compilerHash).toMatch(/^[a-f0-9]{64}$/);
    expect(plan.compilerHash).not.toBe("");
    expect(plan.policyVersion).toBe("originality-policy-v2");
    expect(plan.pipelineVersion).toBe("template-pipeline-v2");
  });

  // -----------------------------------------------------------------------
  // Test 8: historical recovery — allowExecutionSource flag
  // -----------------------------------------------------------------------

  it("accepts --allow-execution-source flag for historical recovery", async () => {
    mockResolvePromptRevision
      .mockResolvedValueOnce({ configuration: { pipelineContract: "trace-ir-v2" } })
      .mockResolvedValueOnce({ configuration: { pipelineContract: "source-profile-v1" } });
    // bookTemplates → chapters → templatePipelineRuns → templateRunArtifacts (allowExecutionSource path)
    mockDbSelect
      .mockReturnValueOnce(selectChain([templateFixture()]))
      .mockReturnValueOnce(selectChain([chapterFixture(UUID.CH_1, 0, "Capítulo 1")]))
      .mockReturnValueOnce(selectChain([{ id: "legacy-run-id" }]))
      .mockReturnValueOnce(
        selectChain([
          {
            id: "artifact-1",
            pipelineRunId: "legacy-run-id",
            chapterId: UUID.CH_1,
            compiledTemplate: [
              {
                name: "content_prompt",
                content: "Contenido histórico del capítulo",
                userPrompt: null,
                function: "content",
                sourceContext: null,
                notes: null,
                placeholders: [],
              },
            ],
          },
        ]),
      );

    const plan = await planTemplateRegeneration(
      validInput({
        sourceDir: undefined,
        allowExecutionSource: true,
        dryRun: true,
      }),
    );

    expect(plan.chapterCount).toBe(1);
    expect(plan.sourceHashes).toHaveLength(1);
    expect(plan.sourceHashes[0]).toMatch(/^[a-f0-9]{64}$/);
    // No file I/O was performed
    expect(mockReaddir).not.toHaveBeenCalled();
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("throws when neither sourceDir nor allowExecutionSource is provided", async () => {
    await expect(
      planTemplateRegeneration(
        validInput({
          sourceDir: undefined,
          allowExecutionSource: undefined,
          dryRun: true,
        }),
      ),
    ).rejects.toThrow(TemplateValidationError);
  });

  it("throws when both sourceDir and allowExecutionSource are provided", async () => {
    await expect(
      planTemplateRegeneration(
        validInput({
          sourceDir: "/tmp/sources",
          allowExecutionSource: true,
          dryRun: true,
        }),
      ),
    ).rejects.toThrow(TemplateValidationError);
  });
});

// ---------------------------------------------------------------------------
// executeTemplateRegeneration
// ---------------------------------------------------------------------------

describe("executeTemplateRegeneration", () => {
  // -----------------------------------------------------------------------
  // Test 1 (cont): dry-run returns plan without writes
  // -----------------------------------------------------------------------

  it("dry-run returns result with empty templateId and no writes", async () => {
    setupPlanMocks(2, 2);

    const result = await executeTemplateRegeneration(validInput({ dryRun: true }));

    expect(result.templateId).toBe("");
    expect(result.pipelineRunId).toBe("");
    expect(result.operationId).toBe(UUID.OP);
    expect(mockDbInsert).not.toHaveBeenCalled();
    expect(mockTriggerEnqueue).not.toHaveBeenCalled();
    expect(mockBeginRegeneration).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Test 2: same completed operation returns original template ID
  // -----------------------------------------------------------------------

  it("returns existing template ID when operation is already completed", async () => {
    // --- First call: operation is "new", creates template ---
    setupPlanMocks(2, 2);
    mockBeginRegeneration.mockResolvedValueOnce({
      state: "new",
      operation: opRow(),
    });

    // Transaction mock: creates template, 2 chapters, pipeline run
    mockDbTransaction.mockImplementationOnce(
      async (cb: (tx: Record<string, unknown>) => Promise<unknown>) => {
        const txInsert = vi.fn()
          .mockReturnValueOnce(insertReturning([newTemplateFixture()]))
          .mockReturnValueOnce(insertReturning([{ id: UUID.CH_1, position: 0, title: "Capítulo 1" }]))
          .mockReturnValueOnce(insertReturning([{ id: UUID.CH_2, position: 1, title: "Capítulo 2" }]))
          .mockReturnValueOnce(insertReturning([pipelineRunFixture()]));
        return cb({ insert: txInsert });
      },
    );
    mockTriggerEnqueue.mockResolvedValueOnce(undefined);

    const result1 = await executeTemplateRegeneration(validInput());

    expect(result1.templateId).toBe(UUID.NEW_TEMPLATE);
    expect(result1.pipelineRunId).toBe(UUID.PIPELINE_RUN);
    expect(result1.operationId).toBe(UUID.OP);
    expect(mockTriggerEnqueue).toHaveBeenCalledTimes(1);

    // --- Second call: operation is "completed", returns existing ---
    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
    mockDbTransaction.mockReset();
    mockBeginRegeneration.mockReset();
    mockTriggerEnqueue.mockReset();
    mockReaddir.mockReset();
    mockReadFile.mockReset();
    mockResolvePromptRevision.mockReset();
    setupPlanMocks(2, 2);
    mockBeginRegeneration.mockResolvedValueOnce({
      state: "completed",
      operation: opRow({
        status: "completed",
        resultTemplateId: UUID.NEW_TEMPLATE,
        completedAt: new Date("2026-07-25T01:00:00Z"),
      }),
    });

    const result2 = await executeTemplateRegeneration(validInput());

    expect(result2.templateId).toBe(UUID.NEW_TEMPLATE);
    expect(mockDbTransaction).not.toHaveBeenCalled();
    expect(mockTriggerEnqueue).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Test 3: changed hash conflict
  // -----------------------------------------------------------------------

  it("throws OperationInputConflictError when input hash conflicts", async () => {
    setupPlanMocks(2, 2);

    mockBeginRegeneration.mockRejectedValueOnce(
      new OperationInputConflictError(
        UUID.OP,
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      ),
    );

    await expect(
      executeTemplateRegeneration(validInput()),
    ).rejects.toThrow(OperationInputConflictError);
  });
});
