import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetUser, mockSupabase } = vi.hoisted(() => {
  const mockGetUser = vi.fn();
  const mockSupabase = { auth: { getUser: mockGetUser } };
  return { mockGetUser, mockSupabase };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => mockSupabase),
}));

import { requireAdmin } from "@/lib/auth/admin";

describe("requireAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no user is authenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });

    const result = await requireAdmin();

    expect(result.authorized).toBe(false);
    expect(result.response).toBeDefined();
    expect(result.response!.status).toBe(401);
    const body = await result.response!.json();
    expect(body.error).toBe("unauthorized");
  });

  it("returns 403 when user is not an admin", async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: "user-1", app_metadata: { role: "user" } } },
    });

    const result = await requireAdmin();

    expect(result.authorized).toBe(false);
    expect(result.response).toBeDefined();
    expect(result.response!.status).toBe(403);
    const body = await result.response!.json();
    expect(body.error).toBe("forbidden");
  });

  it("returns 403 when user has no app_metadata", async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: "user-1" } },
    });

    const result = await requireAdmin();

    expect(result.authorized).toBe(false);
    expect(result.response!.status).toBe(403);
  });

  it("returns authorized when user is admin", async () => {
    const adminUser = { id: "admin-1", app_metadata: { role: "admin" } };
    mockGetUser.mockResolvedValueOnce({
      data: { user: adminUser },
    });

    const result = await requireAdmin();

    expect(result.authorized).toBe(true);
    if (result.authorized) {
      expect(result.user).toEqual(adminUser);
    }
  });
});
