import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockValues, mockInsert } = vi.hoisted(() => {
  const mockValues = vi.fn();
  const mockInsert = vi.fn(() => ({ values: mockValues }));
  return { mockValues, mockInsert };
});

vi.mock("@/lib/db", () => ({
  db: { insert: mockInsert },
}));

import { logAudit, auditMetrics } from "@/lib/audit";

describe("logAudit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auditMetrics.failures = 0;
    auditMetrics.total = 0;
  });

  it("inserts the audit entry into the DB", async () => {
    mockValues.mockResolvedValueOnce(undefined);

    await logAudit({
      userId: "user-1",
      action: "project.create",
      resourceType: "project",
      resourceId: "proj-1",
      metadata: { topic: "test" },
    });

    expect(mockInsert).toHaveBeenCalledWith(expect.any(Object)); // auditLogs table
    expect(mockValues).toHaveBeenCalledWith({
      userId: "user-1",
      action: "project.create",
      resourceType: "project",
      resourceId: "proj-1",
      metadata: JSON.stringify({ topic: "test" }),
    });
  });

  it("increments total on every call", async () => {
    mockValues.mockResolvedValue(undefined);
    expect(auditMetrics.total).toBe(0);

    await logAudit({ userId: "u1", action: "a", resourceType: "t" });
    expect(auditMetrics.total).toBe(1);

    await logAudit({ userId: "u1", action: "b", resourceType: "t" });
    expect(auditMetrics.total).toBe(2);
  });

  it("increments failures when DB insert throws", async () => {
    mockValues.mockRejectedValueOnce(new Error("DB down"));

    await logAudit({ userId: "u1", action: "a", resourceType: "t" });

    expect(auditMetrics.failures).toBe(1);
    expect(auditMetrics.total).toBe(1);
  });

  it("never throws — swallows errors gracefully", async () => {
    mockValues.mockRejectedValueOnce(new Error("connection refused"));

    // Should not throw
    await expect(
      logAudit({ userId: "u1", action: "a", resourceType: "t" }),
    ).resolves.toBeUndefined();
  });

  it("handles missing resourceId and metadata", async () => {
    mockValues.mockResolvedValueOnce(undefined);

    await logAudit({ userId: "u1", action: "login", resourceType: "auth" });

    expect(mockValues).toHaveBeenCalledWith({
      userId: "u1",
      action: "login",
      resourceType: "auth",
      resourceId: null,
      metadata: null,
    });
  });
});
