import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicEnvOrThrow } from "@/lib/auth/supabase-config";

export function createClient() {
  const { supabaseUrl, supabaseAnonKey } = getSupabasePublicEnvOrThrow(
    "Browser authentication",
  );

  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
