import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicEnv } from "@/lib/auth/supabase-config";
import type { UserResponse } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Auth deduplication
// ---------------------------------------------------------------------------

// Deduplicate concurrent getUser() calls across requests to prevent
// single-use refresh token race conditions.
// Supabase refresh tokens can only be used once. When multiple requests
// arrive simultaneously (rapid navigation, prefetch), each calls getUser()
// which tries to refresh the same token → first succeeds, second fails
// with "Invalid Refresh Token: Already Used" → silent session loss.
// This map ensures only one refresh is in flight per session at a time.
const MAX_INFLIGHT = 500;
const inFlightRefresh = new Map<string, Promise<UserResponse>>();
const lastAccess = new Map<string, number>();

async function dedupedGetUser(
  supabase: ReturnType<typeof createServerClient>,
  refreshTokenHint: string,
): Promise<UserResponse> {
  const existing = inFlightRefresh.get(refreshTokenHint);
  if (existing) {
    lastAccess.set(refreshTokenHint, Date.now());
    try {
      return await existing;
    } catch {
      // Existing refresh failed — retry below with fresh call
    }
  }

  const promise = supabase.auth.getUser();
  // Prune oldest entries if map grows too large (LRU-style eviction)
  if (inFlightRefresh.size >= MAX_INFLIGHT) {
    const sorted = [...lastAccess.entries()].sort(([, a], [, b]) => a - b);
    // Evict oldest 10%
    const toEvict = Math.floor(MAX_INFLIGHT / 10);
    for (let i = 0; i < toEvict && i < sorted.length; i++) {
      const [key] = sorted[i];
      inFlightRefresh.delete(key);
      lastAccess.delete(key);
    }
  }
  lastAccess.set(refreshTokenHint, Date.now());
  inFlightRefresh.set(refreshTokenHint, promise);

  try {
    const result = await promise;
    return result;
  } finally {
    if (inFlightRefresh.get(refreshTokenHint) === promise) {
      inFlightRefresh.delete(refreshTokenHint);
      lastAccess.delete(refreshTokenHint);
    }
  }
}

// ---------------------------------------------------------------------------
// Route configuration
// ---------------------------------------------------------------------------

const publicPaths = new Set(["/login", "/forgot-password", "/reset-password", "/callback"]);

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });
  const supabaseConfig = getSupabasePublicEnv();

  if (!supabaseConfig) {
    console.error("Authentication middleware: missing Supabase environment variables");
    return new NextResponse("Service Unavailable", {
      status: 503,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }

  const { supabaseUrl, supabaseAnonKey } = supabaseConfig;

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Use any Supabase auth cookie value as dedup key. Different sessions
  // have different tokens → map key keeps them isolated. Requests without
  // cookies (first visit) fall back to a shared key — harmless since
  // there's no refresh token to race on.
  const refreshTokenHint =
    request.cookies.getAll().find((c) => c.name.startsWith("sb-") && c.name.endsWith("-auth-token"))?.value ??
    "no-session";

  const {
    data: { user },
  } = await dedupedGetUser(supabase, refreshTokenHint);

  // If not authenticated and not on an auth page, redirect to login
  if (
    !user &&
    !publicPaths.has(request.nextUrl.pathname)
  ) {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Add Content-Security-Policy header
  const isProduction = process.env.NODE_ENV === "production";
  const supabaseUrlCsp = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://*.supabase.co";
  const connectSrc = [
    "'self'",
    supabaseUrlCsp,
    "https://api.anthropic.com",
    "https://api.openai.com",
    "https://generativelanguage.googleapis.com",
    "https://api.deepseek.com",
    "https://api.trigger.dev",
    "https://api.exa.ai",
    "https://api.tavily.com",
    "https://api.cohere.com",
  ].join(" ");
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'" + (isProduction ? "" : " 'unsafe-eval'"),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    `connect-src ${connectSrc}`,
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join("; ");

  supabaseResponse.headers.set(
    isProduction
      ? "Content-Security-Policy"
      : "Content-Security-Policy-Report-Only",
    csp
  );

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
