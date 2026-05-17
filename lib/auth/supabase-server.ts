import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabasePublicEnvOrThrow } from "@/lib/auth/supabase-config";

export async function createClient() {
  const { supabaseUrl, supabaseAnonKey } = getSupabasePublicEnvOrThrow(
    "Server authentication",
  );

  const cookieStore = await cookies();

  return createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // In Server Components, setting cookies is not supported.
            // Middleware handles the refresh.
          }
        },
      },
    }
  );
}
