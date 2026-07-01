import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock NextRequest since it requires internal Next.js runtime
function mockRequest(method: string, headers: Record<string, string> = {}): {
  method: string;
  headers: Headers;
} {
  return {
    method,
    headers: new Headers(headers),
  };
}

describe("csrfCheck", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://example.com");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  describe("method gating", () => {
    it("allows GET requests without origin check", async () => {
      const { csrfCheck } = await import("@/lib/api/csrf");
      const req = mockRequest("GET", { origin: "https://evil.com" }) as unknown as Request;
      const result = csrfCheck(req as unknown as import("next/server").NextRequest);
      expect(result).toBeNull();
    });

    it("allows HEAD requests without origin check", async () => {
      const { csrfCheck } = await import("@/lib/api/csrf");
      const req = mockRequest("HEAD", { origin: "https://evil.com" }) as unknown as Request;
      const result = csrfCheck(req as unknown as import("next/server").NextRequest);
      expect(result).toBeNull();
    });

    it("allows OPTIONS requests without origin check", async () => {
      const { csrfCheck } = await import("@/lib/api/csrf");
      const req = mockRequest("OPTIONS", { origin: "https://evil.com" }) as unknown as Request;
      const result = csrfCheck(req as unknown as import("next/server").NextRequest);
      expect(result).toBeNull();
    });

    it("checks POST requests", async () => {
      const { csrfCheck } = await import("@/lib/api/csrf");
      const req = mockRequest("POST", {
        origin: "https://evil.com",
        host: "example.com:3000",
      }) as unknown as Request;
      const result = csrfCheck(req as unknown as import("next/server").NextRequest);
      expect(result).not.toBeNull();
      expect(result?.status).toBe(403);
    });

    it("checks PUT requests", async () => {
      const { csrfCheck } = await import("@/lib/api/csrf");
      const req = mockRequest("PUT", {
        origin: "https://evil.com",
        host: "example.com:3000",
      }) as unknown as Request;
      const result = csrfCheck(req as unknown as import("next/server").NextRequest);
      expect(result?.status).toBe(403);
    });

    it("checks PATCH requests", async () => {
      const { csrfCheck } = await import("@/lib/api/csrf");
      const req = mockRequest("PATCH", {
        origin: "https://evil.com",
        host: "example.com:3000",
      }) as unknown as Request;
      const result = csrfCheck(req as unknown as import("next/server").NextRequest);
      expect(result?.status).toBe(403);
    });

    it("checks DELETE requests", async () => {
      const { csrfCheck } = await import("@/lib/api/csrf");
      const req = mockRequest("DELETE", {
        origin: "https://evil.com",
        host: "example.com:3000",
      }) as unknown as Request;
      const result = csrfCheck(req as unknown as import("next/server").NextRequest);
      expect(result?.status).toBe(403);
    });
  });

  describe("origin validation", () => {
    it("allows requests with missing Origin header (same-origin)", async () => {
      const { csrfCheck } = await import("@/lib/api/csrf");
      const req = mockRequest("POST", { host: "example.com" }) as unknown as Request;
      const result = csrfCheck(req as unknown as import("next/server").NextRequest);
      expect(result).toBeNull();
    });

    it("allows requests where origin ends with ://host", async () => {
      const { csrfCheck } = await import("@/lib/api/csrf");
      const req = mockRequest("POST", {
        origin: "https://example.com:3000",
        host: "example.com:3000",
      }) as unknown as Request;
      const result = csrfCheck(req as unknown as import("next/server").NextRequest);
      expect(result).toBeNull();
    });

    it("rejects requests where origin does not match host", async () => {
      const { csrfCheck } = await import("@/lib/api/csrf");
      const req = mockRequest("POST", {
        origin: "https://evil.com",
        host: "example.com",
      }) as unknown as Request;
      const result = csrfCheck(req as unknown as import("next/server").NextRequest);
      expect(result).not.toBeNull();
      expect(result?.status).toBe(403);
    });

    it("rejects requests with invalid origin URL", async () => {
      const { csrfCheck } = await import("@/lib/api/csrf");
      const req = mockRequest("POST", {
        origin: "not-a-valid-url",
        host: "example.com",
      }) as unknown as Request;
      const result = csrfCheck(req as unknown as import("next/server").NextRequest);
      expect(result).not.toBeNull();
    });
  });

  describe("ALLOWED_ORIGINS matching", () => {
    it("allows exact match against NEXT_PUBLIC_SITE_URL", async () => {
      vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://example.com");
      const { csrfCheck } = await import("@/lib/api/csrf");
      const req = mockRequest("POST", {
        origin: "https://example.com",
        host: "other-host.com",
      }) as unknown as Request;
      const result = csrfCheck(req as unknown as import("next/server").NextRequest);
      expect(result).toBeNull();
    });

    it("rejects mismatched origin against NEXT_PUBLIC_SITE_URL", async () => {
      process.env.NEXT_PUBLIC_SITE_URL = "https://example.com";
      const { csrfCheck } = await import("@/lib/api/csrf");
      const req = mockRequest("POST", {
        origin: "https://attacker.com",
        host: "example.com",
      }) as unknown as Request;
      // origin endsWith ://host? "https://attacker.com".endsWith("://example.com") → false
      // ALLOWED_ORIGINS match? "https://attacker.com" !== "https://example.com" → false
      // Fallback hostname check: "attacker.com" !== "example.com" → reject
      const result = csrfCheck(req as unknown as import("next/server").NextRequest);
      expect(result?.status).toBe(403);
    });
  });

  describe("localhost in non-production", () => {
    it("allows localhost origins in test environment", async () => {
      const { csrfCheck } = await import("@/lib/api/csrf");
      const req = mockRequest("POST", {
        origin: "http://localhost:3000",
        host: "example.com",
      }) as unknown as Request;
      const result = csrfCheck(req as unknown as import("next/server").NextRequest);
      expect(result).toBeNull();
    });

    it("allows localhost without port in test environment", async () => {
      const { csrfCheck } = await import("@/lib/api/csrf");
      const req = mockRequest("POST", {
        origin: "http://localhost",
        host: "example.com",
      }) as unknown as Request;
      const result = csrfCheck(req as unknown as import("next/server").NextRequest);
      expect(result).toBeNull();
    });
  });

  describe("error response shape", () => {
    it("returns JSON with error message on CSRF rejection", async () => {
      const { csrfCheck } = await import("@/lib/api/csrf");
      const req = mockRequest("POST", {
        origin: "https://evil.com",
        host: "example.com",
      }) as unknown as Request;
      const result = csrfCheck(req as unknown as import("next/server").NextRequest);
      expect(result).not.toBeNull();
      const body = await result!.json();
      expect(body).toEqual({ error: "invalid origin" });
    });

    it("returns 403 status on CSRF rejection", async () => {
      const { csrfCheck } = await import("@/lib/api/csrf");
      const req = mockRequest("POST", {
        origin: "https://evil.com",
        host: "example.com",
      }) as unknown as Request;
      const result = csrfCheck(req as unknown as import("next/server").NextRequest);
      expect(result?.status).toBe(403);
    });
  });
});
