import { createClient } from "@/lib/auth/supabase-server";
import { NextResponse } from "next/server";

function safeRedirectPath(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.includes("://") || raw.includes("@")) {
    return "/projects";
  }
  return raw;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeRedirectPath(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login`);
}
