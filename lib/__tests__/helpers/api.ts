/**
 * API route testing helpers.
 *
 * Usage:
 *   import { createTestRequest, mockAdminAuth } from "@/lib/__tests__/helpers/api";
 *   mockAdminAuth();
 *   const { POST } = await import("@/app/api/prompt-library/route");
 *   const req = createTestRequest({ method: "POST", body: { name: "Test" } });
 *   const res = await POST(req);
 */

import { NextRequest } from "next/server";
import { vi } from "vitest";

export function createTestRequest({
  method = "GET",
  url = "http://localhost:3000/api/test",
  body,
  headers = {},
}: {
  method?: string;
  url?: string;
  body?: unknown;
  headers?: Record<string, string>;
} = {}): NextRequest {
  const req = new NextRequest(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
      ...headers,
    },
  });

  if (body !== undefined) {
    return new NextRequest(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
        ...headers,
      },
      body: JSON.stringify(body),
    });
  }

  return req;
}

/**
 * Mock the admin auth module so routes using requireAdmin() pass.
 * Call BEFORE dynamically importing the route handler.
 */
export function mockAdminAuth(): void {
  vi.mock("@/lib/auth/admin", () => ({
    requireAdmin: vi.fn().mockResolvedValue({
      authorized: true,
      user: {
        id: "00000000-0000-0000-0000-000000000000",
        email: "admin@test.com",
        app_metadata: { role: "admin" },
      },
    }),
  }));
}

/**
 * Mock Supabase server client for routes using createClient() + getUser().
 * Call BEFORE dynamically importing the route handler.
 */
export function mockSupabaseAuth(userId = "00000000-0000-0000-0000-000000000000"): void {
  vi.mock("@/lib/supabase/server", () => ({
    createClient: vi.fn().mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: userId, email: "test@test.com" } },
          error: null,
        }),
      },
    }),
  }));
}

/**
 * Mock the CSRF check so mutation routes pass.
 */
export function mockCsrfCheck(): void {
  vi.mock("@/lib/api/csrf", () => ({
    csrfCheck: vi.fn().mockReturnValue(null),
  }));
}
