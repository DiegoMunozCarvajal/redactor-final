import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      authorized: false as const,
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }

  if (user.app_metadata?.role !== "admin") {
    return {
      authorized: false as const,
      response: NextResponse.json({ error: "forbidden" }, { status: 403 }),
    };
  }

  return { authorized: true as const, user };
}
