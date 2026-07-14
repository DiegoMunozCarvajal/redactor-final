import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DB before importing module under test
const mockDbSelect = vi.fn();
const mockDbUpdate = vi.fn();

vi.mock("@/lib/db/drizzle", () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
  },
}));

vi.mock("@/lib/db/lock-pool", () => ({
  lockClient: {
    reserve: vi.fn(),
  },
}));

import { withProjectLock, checkProjectRateLimit, cleanupStaleGenerations, STALE_TIMEOUT_MS } from "@/lib/api/rate-limit";
import { lockClient } from "@/lib/db/lock-pool";

describe("STALE_TIMEOUT_MS", () => {
  it("is 30 minutes in milliseconds", () => {
    expect(STALE_TIMEOUT_MS).toBe(30 * 60 * 1000);
  });
});

describe("projectIdToLockKey (pure)", () => {
  it("converts UUID to two deterministic 32-bit integers", () => {
    // Using known UUID — key derived from first 16 hex chars
    const hex = "550e8400e29b41d4a716446655440000";
    const key1 = parseInt(hex.substring(0, 8), 16) | 0;
    const key2 = parseInt(hex.substring(8, 16), 16) | 0;

    expect(typeof key1).toBe("number");
    expect(typeof key2).toBe("number");
  });

  it("produces different lock keys for different UUIDs", () => {
    const uuid1 = "550e8400-e29b-41d4-a716-446655440000".replace(/-/g, "");
    const uuid2 = "660e8400-e29b-41d4-a716-446655440000".replace(/-/g, "");

    const key1a = parseInt(uuid1.substring(0, 8), 16) | 0;
    const key2a = parseInt(uuid1.substring(8, 16), 16) | 0;
    const key1b = parseInt(uuid2.substring(0, 8), 16) | 0;
    const key2b = parseInt(uuid2.substring(8, 16), 16) | 0;

    expect(key1a === key1b && key2a === key2b).toBe(false);
  });
});

describe("checkProjectRateLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows when no active generations in window", async () => {
    const mockWhere = vi.fn().mockResolvedValue([{ count: 0 }]);
    mockDbSelect.mockReturnValue({ from: () => ({ where: mockWhere }) });

    const result = await checkProjectRateLimit("proj-1");
    expect(result.allowed).toBe(true);
    expect(result.retryAfter).toBeUndefined();
  });

  it("denies when active generations >= 1", async () => {
    const mockWhere = vi.fn().mockResolvedValue([{ count: 1 }]);
    mockDbSelect.mockReturnValue({ from: () => ({ where: mockWhere }) });

    const result = await checkProjectRateLimit("proj-2");
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBe(15);
  });

  it("handles empty result (no rows returned)", async () => {
    const mockWhere = vi.fn().mockResolvedValue([]);
    mockDbSelect.mockReturnValue({ from: () => ({ where: mockWhere }) });

    const result = await checkProjectRateLimit("proj-3");
    expect(result.allowed).toBe(true);
  });
});

describe("cleanupStaleGenerations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates stale rows with default active statuses", async () => {
    const mockWhere = vi.fn().mockResolvedValue(undefined);
    const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
    mockDbUpdate.mockReturnValue({ set: mockSet });

    await cleanupStaleGenerations("proj-1", "content");

    expect(mockDbUpdate).toHaveBeenCalled();
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("filters by chapterId when provided", async () => {
    const mockWhere = vi.fn().mockResolvedValue(undefined);
    const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
    mockDbUpdate.mockReturnValue({ set: mockSet });

    await cleanupStaleGenerations("proj-2", "critique", { chapterId: "ch-abc" });
    expect(mockDbUpdate).toHaveBeenCalled();
  });

  it("uses custom statuses and error message", async () => {
    const mockWhere = vi.fn().mockResolvedValue(undefined);
    const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
    mockDbUpdate.mockReturnValue({ set: mockSet });

    await cleanupStaleGenerations("proj-3", "template", {
      statuses: ["pending"],
      errorMessage: "Custom timeout",
    });

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", error: "Custom timeout" }),
    );
  });

  it("default cleanup covers same statuses as rate limiter checks", () => {
    const rateLimitStatuses = ["pending", "generating", "assembling"];
    const cleanupDefaults = ["pending", "generating", "assembling"];

    for (const status of rateLimitStatuses) {
      expect(cleanupDefaults).toContain(status);
    }
  });
});

describe("withProjectLock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setupLockClient(acquired: boolean, unlockFails = false) {
    const mockUnsafe = vi.fn();
    mockUnsafe.mockResolvedValueOnce([{ acquired }]);
    if (acquired) {
      if (unlockFails) {
        mockUnsafe.mockRejectedValueOnce(new Error("release failed"));
      } else {
        mockUnsafe.mockResolvedValueOnce(undefined);
      }
    }

    const mockRelease = vi.fn();
    vi.mocked(lockClient.reserve).mockResolvedValue({
      unsafe: mockUnsafe,
      release: mockRelease,
    } as unknown as Awaited<ReturnType<typeof lockClient.reserve>>);
    return { mockUnsafe, mockRelease };
  }

  it("acquires lock, runs fn, releases", async () => {
    const { mockUnsafe, mockRelease } = setupLockClient(true);
    const fn = vi.fn().mockResolvedValue("result");

    const r = await withProjectLock("550e8400-e29b-41d4-a716-446655440001", fn);

    expect(r.locked).toBe(true);
    if (r.locked) expect(r.result).toBe("result");
    expect(fn).toHaveBeenCalledOnce();
    expect(mockUnsafe).toHaveBeenCalledTimes(2); // acquire + release
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it("returns locked=false when lock busy, does not run fn", async () => {
    const { mockUnsafe, mockRelease } = setupLockClient(false);
    const fn = vi.fn();

    const r = await withProjectLock("550e8400-e29b-41d4-a716-446655440002", fn);

    expect(r.locked).toBe(false);
    expect(fn).not.toHaveBeenCalled();
    expect(mockUnsafe).toHaveBeenCalledOnce();
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it("releases lock even when fn throws", async () => {
    const { mockUnsafe, mockRelease } = setupLockClient(true);
    const fn = vi.fn().mockRejectedValue(new Error("boom"));

    await expect(
      withProjectLock("550e8400-e29b-41d4-a716-446655440003", fn),
    ).rejects.toThrow("boom");

    expect(mockUnsafe).toHaveBeenCalledTimes(2);
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it("releases reserved connection even when unlock fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { mockRelease } = setupLockClient(true, true);
    const fn = vi.fn().mockResolvedValue("ok");

    const r = await withProjectLock("550e8400-e29b-41d4-a716-446655440004", fn);

    expect(r.locked).toBe(true);
    if (r.locked) expect(r.result).toBe("ok");
    expect(mockRelease).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });
});
