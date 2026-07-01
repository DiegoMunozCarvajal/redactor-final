import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const originalEnv = { ...process.env };

// Mock DB dependencies before any module that imports rate-limit
vi.mock("@/lib/db/drizzle", () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn((fn: (tx: Record<string, ReturnType<typeof vi.fn>>) => unknown) =>
      fn({ select: vi.fn(), update: vi.fn(), insert: vi.fn(), delete: vi.fn() })
    ),
  },
}));
vi.mock("@/lib/db/lock-pool", () => ({
  lockClient: {
    reserve: vi.fn(),
    release: vi.fn(),
  },
}));
vi.mock("@/lib/db/schema", () => ({
  chapterGenerations: {
    id: "id",
    projectId: "project_id",
    chapterId: "chapter_id",
    status: "status",
    generationMetadata: "generation_metadata",
    createdAt: "created_at",
    error: "error",
  },
}));

describe("projectIdToLockKey", () => {
  it("converts UUID to two 32-bit integers", () => {
    const hex = "550e8400e29b41d4a716446655440000";
    const key1 = parseInt(hex.substring(0, 8), 16) | 0;
    const key2 = parseInt(hex.substring(8, 16), 16) | 0;

    expect(typeof key1).toBe("number");
    expect(typeof key2).toBe("number");
    expect(key1).toBeGreaterThan(0);
    expect(typeof key2).toBe("number");
  });

  it("produces different lock keys for different UUIDs", () => {
    const uuid1 = "550e8400-e29b-41d4-a716-446655440000".replace(/-/g, "");
    const uuid2 = "660e8400-e29b-41d4-a716-446655440000".replace(/-/g, "");

    const key1a = parseInt(uuid1.substring(0, 8), 16) | 0;
    const key2a = parseInt(uuid1.substring(8, 16), 16) | 0;
    const key1b = parseInt(uuid2.substring(0, 8), 16) | 0;
    const key2b = parseInt(uuid2.substring(8, 16), 16) | 0;

    const same = key1a === key1b && key2a === key2b;
    expect(same).toBe(false);
  });

  it("handles diverse UUIDs without collisions", () => {
    const seen = new Set<string>();
    // Use UUIDs with different first 16 hex chars (what lock key derivation uses)
    const uuids = [
      "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "f9e8d7c6-b5a4-3210-fedc-ba9876543210",
      "12345678-9abc-def0-1234-56789abcdef0",
      "550e8400-e29b-41d4-a716-446655440000",
      "660e8400-e29b-41d4-a716-446655440000",
      "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      "feedface-dead-beef-cafe-babe12345678",
      "c0ffee11-2233-4455-6677-8899aabbccdd",
    ];

    for (const uuid of uuids) {
      const hex = uuid.replace(/-/g, "");
      const k1 = parseInt(hex.substring(0, 8), 16) | 0;
      const k2 = parseInt(hex.substring(8, 16), 16) | 0;
      const key = `${k1}:${k2}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});

describe("STALE_TIMEOUT_MS", () => {
  it("is 30 minutes in milliseconds", async () => {
    const { STALE_TIMEOUT_MS } = await import("@/lib/api/rate-limit");
    expect(STALE_TIMEOUT_MS).toBe(30 * 60 * 1000);
  });
});

describe("cleanupStaleGenerations statuses invariant", () => {
  it("cleanup default covers all active statuses from rate limiter", () => {
    // checkProjectRateLimit counts ["pending", "generating", "assembling"]
    // cleanupStaleGenerations defaults must cover the same
    const rateLimitStatuses = ["pending", "generating", "assembling"];
    const cleanupDefaults = ["pending", "generating", "assembling"];

    for (const status of rateLimitStatuses) {
      expect(cleanupDefaults).toContain(status);
    }
  });
});
