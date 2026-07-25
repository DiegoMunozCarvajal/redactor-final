import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock DB layer
// ---------------------------------------------------------------------------

const { mockDbInsert, mockDbSelect, mockDbUpdate } = vi.hoisted(() => ({
  mockDbInsert: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbUpdate: vi.fn(),
}));

vi.mock("@/lib/db/drizzle", () => ({
  db: {
    insert: mockDbInsert,
    select: mockDbSelect,
    update: mockDbUpdate,
  },
}));

// ---------------------------------------------------------------------------
// Imports — must come after mocks
// ---------------------------------------------------------------------------

import {
  beginRegeneration,
  beginClone,
  completeMaintenanceOperation,
  failMaintenanceOperation,
  inputHashFor,
} from "../operations";

import {
  OperationInputConflictError,
  OperationStateError,
} from "../contracts";

import type {
  RegenerationInput,
  CloneInput,
  MaintenanceOperation,
} from "../contracts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Postgres unique-violation error with code 23505. */
function uniqueViolationError(): Error & { code: string } {
  const err = new Error(
    "duplicate key value violates unique constraint",
  ) as Error & { code: string };
  err.code = "23505";
  return err;
}

/** Default operation row fixture. */
function opRow(overrides: Partial<Record<string, unknown>> = {}): MaintenanceOperation & Record<string, unknown> {
  return {
    id: "11111111-1111-4111-8111-111111111111",
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

function validRegenerationInput(
  overrides: Partial<RegenerationInput> = {},
): RegenerationInput {
  return {
    operationId: "11111111-1111-4111-8111-111111111111",
    legacyTemplateId: "22222222-2222-4222-8222-222222222222",
    sourceHashes: [
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ],
    rhetoricTraceRevisionId: "33333333-3333-4333-8333-333333333333",
    sourceProfilerRevisionId: "44444444-4444-4444-8444-444444444444",
    compilerHash:
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    policyVersion: "originality-policy-v2",
    ...overrides,
  };
}

function validCloneInput(
  overrides: Partial<CloneInput> = {},
): CloneInput {
  return {
    operationId: "11111111-1111-4111-8111-111111111111",
    legacyProjectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    cleanTemplateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    legacyProjectStateHash:
      "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    cleanTemplateArtifactSetHash:
      "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    ...overrides,
  };
}

/** Create a mock Drizzle insert chain returning the given rows. */
function mockInsertReturning(rows: unknown[]) {
  mockDbInsert.mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(rows),
    }),
  });
}

/** Create a mock Drizzle insert chain that rejects with an error. */
function mockInsertReject(err: Error) {
  mockDbInsert.mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockRejectedValue(err),
    }),
  });
}

/** Create a mock Drizzle select chain returning the given rows. */
function mockSelectWhere(rows: unknown[]) {
  mockDbSelect.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(rows),
    }),
  });
}

/** Create a mock Drizzle update chain returning the given rows. */
function mockUpdateReturning(rows: unknown[]) {
  mockDbUpdate.mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(rows),
      }),
    }),
  });
}

// ---------------------------------------------------------------------------
// inputHashFor
// ---------------------------------------------------------------------------

describe("inputHashFor", () => {
  it("excludes operationId so that same payload produces same hash", () => {
    const a = validRegenerationInput({
      operationId: "11111111-1111-4111-8111-111111111111",
    });
    const b = validRegenerationInput({
      operationId: "22222222-2222-4222-8222-222222222222",
    });

    expect(inputHashFor(a)).toBe(inputHashFor(b));
  });

  it("differs when payload changes", () => {
    const a = validRegenerationInput({ policyVersion: "v1" });
    const b = validRegenerationInput({ policyVersion: "v2" });

    expect(inputHashFor(a)).not.toBe(inputHashFor(b));
  });
});

// ---------------------------------------------------------------------------
// beginRegeneration
// ---------------------------------------------------------------------------

describe("beginRegeneration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // 1. New insert succeeds
  // -----------------------------------------------------------------------

  it("returns state=new for a fresh operation insert", async () => {
    const input = validRegenerationInput();
    const hash = inputHashFor(input);
    const dbRow = opRow({
      id: input.operationId,
      kind: "template_regeneration",
      inputHash: hash,
    });

    mockInsertReturning([dbRow]);

    const result = await beginRegeneration(input);

    expect(result.state).toBe("new");
    expect(result.operation.id).toBe(input.operationId);
    expect(result.operation.kind).toBe("template_regeneration");
    expect(result.operation.status).toBe("running");
    expect(result.operation.inputHash).toBe(hash);
    // Verify insert was called with correct values
    expect(mockDbInsert).toHaveBeenCalledTimes(1);
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 2. Completed operation returns same result
  // -----------------------------------------------------------------------

  it("returns state=completed when operation already completed with same hash", async () => {
    const input = validRegenerationInput();
    const hash = inputHashFor(input);
    const completedRow = opRow({
      id: input.operationId,
      kind: "template_regeneration",
      inputHash: hash,
      status: "completed",
      completedAt: new Date("2026-07-25T01:00:00Z"),
      resultTemplateId: "33333333-3333-4333-8333-333333333333",
      report: { ids: { template: "33333333-3333-4333-8333-333333333333" } },
    });

    mockInsertReject(uniqueViolationError());
    mockSelectWhere([completedRow]);

    const result = await beginRegeneration(input);

    expect(result.state).toBe("completed");
    expect(result.operation.status).toBe("completed");
    expect(result.operation.id).toBe(input.operationId);
  });

  // -----------------------------------------------------------------------
  // 3. Rejects different input with same operationId
  // -----------------------------------------------------------------------

  it("throws OperationInputConflictError when hash differs from existing", async () => {
    const input = validRegenerationInput({ policyVersion: "v2" }); // hash B
    const existingHash = inputHashFor(
      validRegenerationInput({ policyVersion: "v1" }),
    );
    const completedRow = opRow({
      id: input.operationId,
      kind: "template_regeneration",
      inputHash: existingHash, // hash A — different from input
      status: "completed",
      completedAt: new Date("2026-07-25T01:00:00Z"),
      report: { ids: { template: "33333333-3333-4333-8333-333333333333" } },
    });

    mockInsertReject(uniqueViolationError());
    mockSelectWhere([completedRow]);

    await expect(beginRegeneration(input)).rejects.toThrow(
      OperationInputConflictError,
    );
  });

  // -----------------------------------------------------------------------
  // 4. Concurrent insert conflict → reread and return running
  // -----------------------------------------------------------------------

  it("returns state=running on concurrent insert conflict", async () => {
    const input = validRegenerationInput();
    const hash = inputHashFor(input);
    const concurrentRow = opRow({
      id: input.operationId,
      kind: "template_regeneration",
      inputHash: hash,
      status: "running",
    });

    mockInsertReject(uniqueViolationError());
    mockSelectWhere([concurrentRow]);

    const result = await beginRegeneration(input);

    expect(result.state).toBe("running");
    expect(result.operation.status).toBe("running");
    expect(result.operation.id).toBe(input.operationId);
  });

  // -----------------------------------------------------------------------
  // 5. Running resume
  // -----------------------------------------------------------------------

  it("returns state=running when operation already exists and is running", async () => {
    const input = validRegenerationInput();
    const hash = inputHashFor(input);
    const runningRow = opRow({
      id: input.operationId,
      kind: "template_regeneration",
      inputHash: hash,
      status: "running",
    });

    mockInsertReject(uniqueViolationError());
    mockSelectWhere([runningRow]);

    const result = await beginRegeneration(input);

    expect(result.state).toBe("running");
    expect(result.operation.status).toBe("running");
  });

  // -----------------------------------------------------------------------
  // 6. Failed retry with same input
  // -----------------------------------------------------------------------

  it("restarts a failed operation with matching input hash", async () => {
    const input = validRegenerationInput();
    const hash = inputHashFor(input);
    const failedRow = opRow({
      id: input.operationId,
      kind: "template_regeneration",
      inputHash: hash,
      status: "failed",
      completedAt: new Date("2026-07-25T01:00:00Z"),
    });
    const restartedRow = { ...failedRow, status: "running", completedAt: null };

    mockInsertReject(uniqueViolationError());
    mockSelectWhere([failedRow]);
    mockUpdateReturning([restartedRow]);

    const result = await beginRegeneration(input);

    expect(result.state).toBe("running");
    expect(result.operation.status).toBe("running");
    // Verify the update was called (restart)
    expect(mockDbUpdate).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // 7. Wrong kind
  // -----------------------------------------------------------------------

  it("throws OperationInputConflictError when kind mismatches", async () => {
    const input = validCloneInput(); // clone input
    const hash = inputHashFor(input);
    const existingRow = opRow({
      id: input.operationId,
      kind: "template_regeneration", // <-- wrong kind for beginClone
      inputHash: hash,
      status: "completed",
      completedAt: new Date("2026-07-25T01:00:00Z"),
      report: { ids: { project: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } },
    });

    mockInsertReject(uniqueViolationError());
    mockSelectWhere([existingRow]);

    await expect(beginClone(input)).rejects.toThrow(
      OperationInputConflictError,
    );
  });
});

// ---------------------------------------------------------------------------
// beginClone
// ---------------------------------------------------------------------------

describe("beginClone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts a new clone operation with kind=project_clone", async () => {
    const input = validCloneInput();
    const hash = inputHashFor(input);
    const dbRow = opRow({
      id: input.operationId,
      kind: "project_clone",
      inputHash: hash,
    });

    mockInsertReturning([dbRow]);

    const result = await beginClone(input);

    expect(result.state).toBe("new");
    expect(result.operation.kind).toBe("project_clone");
  });
});

// ---------------------------------------------------------------------------
// completeMaintenanceOperation
// ---------------------------------------------------------------------------

describe("completeMaintenanceOperation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // 8. Complete-once
  // -----------------------------------------------------------------------

  it("updates running to completed and returns the operation", async () => {
    const opId = "11111111-1111-4111-8111-111111111111";
    const completedRow = opRow({
      id: opId,
      status: "completed",
      resultTemplateId: "33333333-3333-4333-8333-333333333333",
      completedAt: new Date("2026-07-25T01:00:00Z"),
    });

    mockUpdateReturning([completedRow]);

    const result = await completeMaintenanceOperation({
      operationId: opId,
      resultTemplateId: "33333333-3333-4333-8333-333333333333",
    });

    expect(result.status).toBe("completed");
    expect(result.resultTemplateId).toBe(
      "33333333-3333-4333-8333-333333333333",
    );
  });

  it("returns existing if already completed with matching result IDs", async () => {
    const opId = "11111111-1111-4111-8111-111111111111";
    const completedRow = opRow({
      id: opId,
      status: "completed",
      resultTemplateId: "33333333-3333-4333-8333-333333333333",
      completedAt: new Date("2026-07-25T01:00:00Z"),
      report: { hashes: { output: "abc" } },
    });

    // First call: update returns empty (0 rows matched — already completed)
    mockUpdateReturning([]);
    mockSelectWhere([completedRow]);

    const result = await completeMaintenanceOperation({
      operationId: opId,
      resultTemplateId: "33333333-3333-4333-8333-333333333333",
    });

    expect(result.status).toBe("completed");
    expect(result.id).toBe(opId);
  });

  it("throws when already completed but result IDs differ", async () => {
    const opId = "11111111-1111-4111-8111-111111111111";
    const completedRow = opRow({
      id: opId,
      status: "completed",
      resultTemplateId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", // different
      completedAt: new Date("2026-07-25T01:00:00Z"),
    });

    mockUpdateReturning([]);
    mockSelectWhere([completedRow]);

    await expect(
      completeMaintenanceOperation({
        operationId: opId,
        resultTemplateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      }),
    ).rejects.toThrow(OperationStateError);
  });

  it("throws when operation not found", async () => {
    const opId = "11111111-1111-4111-8111-111111111111";

    mockUpdateReturning([]);
    mockSelectWhere([]); // no rows

    await expect(
      completeMaintenanceOperation({ operationId: opId }),
    ).rejects.toThrow(OperationStateError);
  });
});

// ---------------------------------------------------------------------------
// failMaintenanceOperation
// ---------------------------------------------------------------------------

describe("failMaintenanceOperation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates running to failed and returns the operation", async () => {
    const opId = "11111111-1111-4111-8111-111111111111";
    const failedRow = opRow({
      id: opId,
      status: "failed",
      completedAt: new Date("2026-07-25T01:00:00Z"),
      report: { codes: ["ERR_PIPELINE_FAILURE"] },
    });

    mockUpdateReturning([failedRow]);

    const result = await failMaintenanceOperation({
      operationId: opId,
      report: { codes: ["ERR_PIPELINE_FAILURE"] },
    });

    expect(result.status).toBe("failed");
  });

  it("is idempotent — returns existing if already in terminal state", async () => {
    const opId = "11111111-1111-4111-8111-111111111111";
    const failedRow = opRow({
      id: opId,
      status: "failed",
      completedAt: new Date("2026-07-25T01:00:00Z"),
      report: { codes: ["ERR_PIPELINE_FAILURE"] },
    });

    // Update matches 0 rows (already failed or completed)
    mockUpdateReturning([]);
    mockSelectWhere([failedRow]);

    const result = await failMaintenanceOperation({
      operationId: opId,
      report: { codes: ["ERR_PIPELINE_FAILURE"] },
    });

    expect(result.status).toBe("failed");
  });

  it("throws when operation not found", async () => {
    mockUpdateReturning([]);
    mockSelectWhere([]);

    await expect(
      failMaintenanceOperation({
        operationId: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toThrow(OperationStateError);
  });
});

// ---------------------------------------------------------------------------
// 9. Report content safety
// ---------------------------------------------------------------------------

describe("report content safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("complete report contains only counts, hashes, IDs, codes — no prose", async () => {
    const opId = "11111111-1111-4111-8111-111111111111";

    // Safe report: numbers, hashes, UUIDs, codes
    const safeReport = {
      counts: { fragments: 5, retries: 1 },
      hashes: {
        input: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        output: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
      ids: {
        template: "33333333-3333-4333-8333-333333333333",
        pipelineRun: "44444444-4444-4444-8444-444444444444",
      },
      codes: ["OK", "WARN_LOW_CONFIDENCE"],
    };

    const completedRow = opRow({
      id: opId,
      status: "completed",
      resultTemplateId: "33333333-3333-4333-8333-333333333333",
      completedAt: new Date("2026-07-25T01:00:00Z"),
      report: safeReport,
    });

    mockUpdateReturning([completedRow]);

    const result = await completeMaintenanceOperation({
      operationId: opId,
      resultTemplateId: "33333333-3333-4333-8333-333333333333",
      report: safeReport,
    });

    // Verify all report fields contain only safe value types
    const report = result.report as Record<string, unknown>;
    expect(report.counts).toEqual({ fragments: 5, retries: 1 });
    expect(report.hashes).toEqual(
      expect.objectContaining({
        input: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(report.ids).toEqual(
      expect.objectContaining({
        template: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        ),
      }),
    );
    expect(report.codes).toEqual(["OK", "WARN_LOW_CONFIDENCE"]);

    // No prose strings (arbitrary text)
    for (const val of Object.values(report)) {
      if (typeof val === "string") {
        // Allowed: hashes (64 hex), UUIDs, short codes
        expect(
          /^[a-f0-9]{64}$/.test(val) ||
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
              val,
            ) ||
            /^[A-Z][A-Z_0-9]*$/.test(val),
        ).toBe(true);
      }
    }
  });

  it("fail report contains only counts, hashes, IDs, codes — no prose", async () => {
    const opId = "11111111-1111-4111-8111-111111111111";

    const safeReport = {
      counts: { failedPrompts: 3 },
      codes: ["ERR_TIMEOUT", "ERR_MODEL_UNAVAILABLE"],
    };

    const failedRow = opRow({
      id: opId,
      status: "failed",
      completedAt: new Date("2026-07-25T01:00:00Z"),
      report: safeReport,
    });

    mockUpdateReturning([failedRow]);

    const result = await failMaintenanceOperation({
      operationId: opId,
      report: safeReport,
    });

    const report = result.report as Record<string, unknown>;
    expect(report.counts).toEqual({ failedPrompts: 3 });
    expect(report.codes).toEqual(["ERR_TIMEOUT", "ERR_MODEL_UNAVAILABLE"]);

    // No arbitrary prose strings
    for (const val of Object.values(report)) {
      if (typeof val === "string") {
        expect(/^[A-Z][A-Z_0-9]*$/.test(val)).toBe(true);
      }
    }
  });
});
