import { createClient } from "@/lib/auth/supabase-server";
import { AuthError } from "@/lib/auth/errors";

export async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user ?? null;
}

export async function requireCurrentUser() {
  const user = await getCurrentUser();
  if (!user) {
    throw new AuthError("Authentication required", "unauthenticated");
  }

  return user;
}

export async function requireCurrentUserId() {
  const user = await requireCurrentUser();
  return user.id;
}
