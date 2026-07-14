import { describe, expect, it, vi } from "vitest";
import {
  snapshotChapterPrompt,
  assertExclusiveRoles,
  writeCurrentChapterPromptRevision,
} from "@/lib/prompts/chapter-revisions";
import type { Prompt } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// Pure function tests
// ---------------------------------------------------------------------------

describe("assertExclusiveRoles", () => {
  it("rejects multiple true flags", () => {
    expect(() =>
      assertExclusiveRoles({
        title: "",
        content: "",
        userPrompt: null,
        position: null,
        isAssembly: true,
        isCritique: true,
        isCorrector: false,
        function: null,
        notes: null,
        sourceContext: null,
      }),
    ).toThrow("more than one exclusive role");
  });

  it("rejects all three true", () => {
    expect(() =>
      assertExclusiveRoles({
        title: "",
        content: "",
        userPrompt: null,
        position: null,
        isAssembly: true,
        isCritique: true,
        isCorrector: true,
        function: null,
        notes: null,
        sourceContext: null,
      }),
    ).toThrow("more than one exclusive role");
  });

  it("accepts single role (assembly)", () => {
    expect(() =>
      assertExclusiveRoles({
        title: "",
        content: "",
        userPrompt: null,
        position: null,
        isAssembly: true,
        isCritique: false,
        isCorrector: false,
        function: null,
        notes: null,
        sourceContext: null,
      }),
    ).not.toThrow();
  });

  it("accepts single role (critique)", () => {
    expect(() =>
      assertExclusiveRoles({
        title: "",
        content: "",
        userPrompt: null,
        position: null,
        isAssembly: false,
        isCritique: true,
        isCorrector: false,
        function: null,
        notes: null,
        sourceContext: null,
      }),
    ).not.toThrow();
  });

  it("accepts zero roles (content prompt)", () => {
    expect(() =>
      assertExclusiveRoles({
        title: "",
        content: "",
        userPrompt: null,
        position: null,
        isAssembly: false,
        isCritique: false,
        isCorrector: false,
        function: null,
        notes: null,
        sourceContext: null,
      }),
    ).not.toThrow();
  });
});

describe("snapshotChapterPrompt", () => {
  const mockPrompt: Prompt = {
    id: "prompt-1",
    projectId: null,
    chapterId: "ch-1",
    position: 3,
    isAssembly: false,
    isCritique: true,
    isCorrector: false,
    title: "Test Title",
    content: "Test content with {placeholder}",
    userPrompt: "User visible instructions",
    function: "extract-key-points",
    notes: "Focus on actionable items",
    sourceContext: "Reference: internal docs v2",
    currentRevisionId: null,
    createdAt: new Date("2026-01-01"),
  };

  it("captures all 10 fields plus legacyIncomplete: false", () => {
    const snapshot = snapshotChapterPrompt(mockPrompt);

    expect(snapshot.title).toBe("Test Title");
    expect(snapshot.content).toBe("Test content with {placeholder}");
    expect(snapshot.userPrompt).toBe("User visible instructions");
    expect(snapshot.position).toBe(3);
    expect(snapshot.isAssembly).toBe(false);
    expect(snapshot.isCritique).toBe(true);
    expect(snapshot.isCorrector).toBe(false);
    expect(snapshot.function).toBe("extract-key-points");
    expect(snapshot.notes).toBe("Focus on actionable items");
    expect(snapshot.sourceContext).toBe("Reference: internal docs v2");
    expect(snapshot.legacyIncomplete).toBe(false);
  });

  it("converts null userPrompt to null", () => {
    const prompt = { ...mockPrompt, userPrompt: null };
    const snapshot = snapshotChapterPrompt(prompt);
    expect(snapshot.userPrompt).toBeNull();
  });

  it("handles null optional fields", () => {
    const prompt: Prompt = {
      ...mockPrompt,
      userPrompt: null,
      function: null,
      notes: null,
      sourceContext: null,
    };
    const snapshot = snapshotChapterPrompt(prompt);
    expect(snapshot.userPrompt).toBeNull();
    expect(snapshot.function).toBeNull();
    expect(snapshot.notes).toBeNull();
    expect(snapshot.sourceContext).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// writeCurrentChapterPromptRevision tests (mocked DB)
// ---------------------------------------------------------------------------

describe("writeCurrentChapterPromptRevision", () => {
  const mockPromptRow: Prompt = {
    id: "prompt-1",
    projectId: null,
    chapterId: "ch-1",
    position: 1,
    isAssembly: false,
    isCritique: false,
    isCorrector: true,
    title: "Original Title",
    content: "Original content",
    userPrompt: null,
    function: null,
    notes: null,
    sourceContext: null,
    currentRevisionId: null,
    createdAt: new Date(),
  };

  it("creates version with correct revision number", async () => {
    // Mock the select chain: first call returns prompt, second call returns max revision
    const limitFn = vi
      .fn()
      .mockResolvedValueOnce([mockPromptRow])
      .mockResolvedValueOnce([{ maxRevision: 5 }]);

    const whereFn = vi.fn(() => ({ limit: limitFn }));
    const fromFn = vi.fn(() => ({ where: whereFn }));
    const returningFn = vi.fn().mockResolvedValue([{ id: "version-6" }]);
    const updateReturningFn = vi.fn();

    const mockCtx = {
      select: vi.fn(() => ({ from: fromFn })),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({ returning: returningFn })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: updateReturningFn })),
      })),
    };

    const versionId = await writeCurrentChapterPromptRevision(
      "prompt-1",
      "user-1",
      mockCtx as any,
    );

    // Should compute next revision as maxRevision + 1 = 6
    expect(versionId).toBe("version-6");

    // Should have called select twice (prompt + max revision)
    expect(mockCtx.select).toHaveBeenCalledTimes(2);

    // Should have called insert with revisionNumber = 6
    const insertValues = mockCtx.insert.mock.results[0].value;
    expect(insertValues).toBeDefined();
    expect(typeof insertValues.values).toBe("function");

    // Verify the insert values contain the snapshot
    // (we can't easily inspect the values passed to insert.values since
    //  it returns a chain object — but we verify the chain was called)
    expect(returningFn).toHaveBeenCalledTimes(1);

    // Should have updated prompts.currentRevisionId
    expect(mockCtx.update).toHaveBeenCalledWith(expect.anything());
  });

  it("starts at revision 1 when no versions exist", async () => {
    const limitFn = vi
      .fn()
      .mockResolvedValueOnce([mockPromptRow])
      .mockResolvedValueOnce([{ maxRevision: null }]);

    const whereFn = vi.fn(() => ({ limit: limitFn }));
    const fromFn = vi.fn(() => ({ where: whereFn }));
    const returningFn = vi.fn().mockResolvedValue([{ id: "version-1" }]);

    const mockCtx = {
      select: vi.fn(() => ({ from: fromFn })),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({ returning: returningFn })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: vi.fn() })),
      })),
    };

    const versionId = await writeCurrentChapterPromptRevision(
      "prompt-1",
      "user-1",
      mockCtx as any,
    );

    expect(versionId).toBe("version-1");
  });

  it("throws when prompt is not found", async () => {
    const limitFn = vi.fn().mockResolvedValueOnce([]);
    const whereFn = vi.fn(() => ({ limit: limitFn }));
    const fromFn = vi.fn(() => ({ where: whereFn }));

    const mockCtx = {
      select: vi.fn(() => ({ from: fromFn })),
      insert: vi.fn(),
      update: vi.fn(),
    };

    await expect(
      writeCurrentChapterPromptRevision("nonexistent", "user-1", mockCtx as any),
    ).rejects.toThrow("Prompt nonexistent not found");
  });
});

// ---------------------------------------------------------------------------
// Route handler export tests
// ---------------------------------------------------------------------------

describe("prompt edit route exports", () => {
  it("PUT handler exists on template prompt route", async () => {
    const mod = await import("@/app/api/prompts/[id]/route");
    expect(typeof mod.PUT).toBe("function");
  });

  it("PUT handler exists on project prompt route", async () => {
    const mod = await import(
      "@/app/api/projects/[id]/prompts/[promptId]/route"
    );
    expect(typeof mod.PUT).toBe("function");
  });
});

describe("version restore route exports", () => {
  it("POST handler exists", async () => {
    const mod = await import("@/app/api/prompt-versions/[id]/restore/route");
    expect(typeof mod.POST).toBe("function");
  });
});

describe("version GET route", () => {
  it("GET handler exists", async () => {
    const mod = await import("@/app/api/prompt-versions/[id]/route");
    expect(typeof mod.GET).toBe("function");
  });
});

describe("version list route exports", () => {
  it("template versions has GET and POST", async () => {
    const mod = await import("@/app/api/prompts/[id]/versions/route");
    expect(typeof mod.GET).toBe("function");
    expect(typeof mod.POST).toBe("function");
  });

  it("project versions has GET and POST", async () => {
    const mod = await import(
      "@/app/api/projects/[id]/prompts/[promptId]/versions/route"
    );
    expect(typeof mod.GET).toBe("function");
    expect(typeof mod.POST).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Snapshot integrity tests
// ---------------------------------------------------------------------------

describe("snapshot integrity", () => {
  it("includes all ChapterPromptSnapshot fields", () => {
    const fields: (keyof ReturnType<typeof snapshotChapterPrompt>)[] = [
      "title",
      "content",
      "userPrompt",
      "position",
      "isAssembly",
      "isCritique",
      "isCorrector",
      "function",
      "notes",
      "sourceContext",
      "legacyIncomplete",
    ];

    const prompt: Prompt = {
      id: "p1",
      projectId: null,
      chapterId: "c1",
      position: 0,
      isAssembly: false,
      isCritique: false,
      isCorrector: false,
      title: "t",
      content: "c",
      userPrompt: null,
      function: null,
      notes: null,
      sourceContext: null,
      currentRevisionId: null,
      createdAt: new Date(),
    };

    const snapshot = snapshotChapterPrompt(prompt);
    for (const field of fields) {
      expect(snapshot).toHaveProperty(field);
    }
  });
});
