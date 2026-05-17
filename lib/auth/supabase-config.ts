export class SupabaseConfigurationError extends Error {
  readonly missingKeys: string[];

  constructor(context: string, missingKeys: string[]) {
    super(
      `${context} is unavailable because Supabase is not configured. Missing ${missingKeys.join(
        ", ",
      )}.`,
    );
    this.name = "SupabaseConfigurationError";
    this.missingKeys = missingKeys;
  }
}

export interface SupabasePublicEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

interface SupabaseEnvLike {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
}

export function getMissingSupabasePublicEnvKeys(
  env?: SupabaseEnvLike,
) {
  const supabaseUrl =
    env?.NEXT_PUBLIC_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey =
    env?.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const missing: string[] = [];
  if (!supabaseUrl) {
    missing.push("NEXT_PUBLIC_SUPABASE_URL");
  }
  if (!supabaseAnonKey) {
    missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return missing;
}

export function getSupabasePublicEnv(
  env?: SupabaseEnvLike,
): SupabasePublicEnv | null {
  const supabaseUrl =
    env?.NEXT_PUBLIC_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey =
    env?.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const missingKeys = getMissingSupabasePublicEnvKeys({
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseAnonKey,
  });
  if (missingKeys.length > 0) {
    return null;
  }

  return {
    supabaseUrl: supabaseUrl as string,
    supabaseAnonKey: supabaseAnonKey as string,
  };
}

export function getSupabasePublicEnvOrThrow(
  context = "Supabase client",
  env?: SupabaseEnvLike,
) {
  const config = getSupabasePublicEnv(env);
  if (config) {
    return config;
  }

  throw new SupabaseConfigurationError(
    context,
    getMissingSupabasePublicEnvKeys(env),
  );
}
