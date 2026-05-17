import { requireCurrentUser } from "@/lib/auth/current-user";

export async function requireAuthenticatedUser() {
  return requireCurrentUser();
}
