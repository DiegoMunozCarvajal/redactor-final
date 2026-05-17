import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicEnv, SupabaseConfigurationError } from "@/lib/auth/supabase-config";

// Deduplicate concurrent getUser() calls across requests to prevent
// single-use refresh token race conditions.
// Supabase refresh tokens can only be used once. When multiple requests
// arrive simultaneously (rapid navigation, prefetch), each calls getUser()
// which tries to refresh the same token → first succeeds, second fails
// with "Invalid Refresh Token: Already Used" → silent session loss.
// This map ensures only one refresh is in flight per session at a time.
const inFlightRefresh = new Map<string, Promise<unknown>>();

async function dedupedGetUser(
  supabase: ReturnType<typeof createServerClient>,
  refreshTokenHint: string,
) {
  const existing = inFlightRefresh.get(refreshTokenHint);
  if (existing) {
    try { await existing; } catch { /* will retry below */ }
  }

  const promise = supabase.auth.getUser();
  inFlightRefresh.set(refreshTokenHint, promise);

  try {
    const result = await promise;
    return result;
  } finally {
    if (inFlightRefresh.get(refreshTokenHint) === promise) {
      inFlightRefresh.delete(refreshTokenHint);
    }
  }
}

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });
  const supabaseConfig = getSupabasePublicEnv();

  if (!supabaseConfig) {
    const error = new SupabaseConfigurationError(
      "Authentication middleware",
      ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"].filter(
        (key) => !process.env[key],
      ),
    );
    console.error(error.message);
    return new NextResponse(error.message, {
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
  const publicPaths = new Set(["/login", "/signup", "/register", "/forgot-password", "/reset-password", "/callback"]);
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

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
