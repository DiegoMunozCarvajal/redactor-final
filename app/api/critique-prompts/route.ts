import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { critiquePrompts } from "@/lib/db/schema";
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
    .from(critiquePrompts)
    .orderBy(asc(critiquePrompts.createdAt));

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

  const [critiquePrompt] = await db
    .insert(critiquePrompts)
    .values({ name, description: description ?? null, content, userPrompt: userPrompt ?? null })
    .returning();

  logAudit({
    userId: user.id,
    action: "critique_prompt.create",
    resourceType: "critique_prompt",
    resourceId: critiquePrompt.id,
    metadata: { name: critiquePrompt.name },
  });

  return NextResponse.json(critiquePrompt);
}
