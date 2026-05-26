import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { metaPrompts } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { asc } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { logAudit } from "@/lib/audit";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await db
    .select()
    .from(metaPrompts)
    .orderBy(asc(metaPrompts.createdAt));

  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { name, description, content, userPrompt } = body;

  if (!name || !content) {
    return NextResponse.json({ error: "name and content are required" }, { status: 400 });
  }

  const [metaPrompt] = await db
    .insert(metaPrompts)
    .values({ name, description: description ?? null, content, userPrompt: userPrompt ?? null })
    .returning();

  logAudit({
    userId: user.id,
    action: "meta_prompt.create",
    resourceType: "meta_prompt",
    resourceId: metaPrompt.id,
    metadata: { name: metaPrompt.name },
  });

  return NextResponse.json(metaPrompt);
}
