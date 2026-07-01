import { NextRequest } from "next/server";

// Warn at startup if CSRF origin check is misconfigured in production.
// Without NEXT_PUBLIC_SITE_URL, the fallback hostname check may reject
// legitimate requests if Host/Origin headers don't match exactly.
if (process.env.NODE_ENV === "production" && !process.env.NEXT_PUBLIC_SITE_URL) {
  console.warn(
    "[csrf] NEXT_PUBLIC_SITE_URL is not set. CSRF origin validation will fall back " +
    "to hostname matching, which may reject requests with port mismatches or " +
    "proxied connections. Set NEXT_PUBLIC_SITE_URL to your production URL.",
  );
}

const ALLOWED_ORIGINS = [
  process.env.NEXT_PUBLIC_SITE_URL,
  `https://${process.env.NEXT_PUBLIC_SITE_URL?.replace(/^https?:\/\//, "")}`,
].filter(Boolean);

const LOCAL_ORIGIN = /^https?:\/\/localhost(:\d+)?$/;

/**
 * Validates the Origin header on state-changing requests to prevent CSRF.
 * Returns true if the request is allowed, false if it should be rejected.
 */
export function validateCSRF(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // Same-origin requests (no Origin header) are allowed

  // Allow localhost in development
  if (process.env.NODE_ENV !== "production" && LOCAL_ORIGIN.test(origin)) {
    return true;
  }

  // Check against allowed origins
  const host = request.headers.get("host");
  if (host && origin.endsWith(`://${host}`)) return true;

  if (ALLOWED_ORIGINS.length > 0) {
    return ALLOWED_ORIGINS.some((allowed) => origin === allowed);
  }

  // If no explicit ALLOWED_ORIGINS configured, fall back to exact hostname match
  if (host) {
    try {
      return new URL(origin).hostname === host.split(":")[0];
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Middleware-style CSRF check. Returns a 403 response if validation fails.
 */
export function csrfCheck(request: NextRequest): Response | null {
  const method = request.method.toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return null; // Safe methods

  if (!validateCSRF(request)) {
    return new Response(JSON.stringify({ error: "invalid origin" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  return null;
}
