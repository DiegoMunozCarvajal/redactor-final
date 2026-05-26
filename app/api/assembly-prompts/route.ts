import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { assemblyPrompts } from "@/lib/db/schema";
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
    .from(assemblyPrompts)
    .orderBy(asc(assemblyPrompts.createdAt));

  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { name, description, content } = body;

  if (!name || !content) {
    return NextResponse.json({ error: "name and content are required" }, { status: 400 });
  }

  const [assemblyPrompt] = await db
    .insert(assemblyPrompts)
    .values({ name, description: description ?? null, content })
    .returning();

  logAudit({
    userId: user.id,
    action: "assembly_prompt.create",
    resourceType: "assembly_prompt",
    resourceId: assemblyPrompt.id,
    metadata: { name: assemblyPrompt.name },
  });

  return NextResponse.json(assemblyPrompt);
}
