import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { prompts } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq } from "drizzle-orm";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const { type, title, content, styleRules, knowledgeAreas, suggestedLength, position } = body;

  const [prompt] = await db
    .update(prompts)
    .set({ type, title, content, styleRules, knowledgeAreas, suggestedLength, position })
    .where(eq(prompts.id, id))
    .returning();

  if (!prompt) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(prompt);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  await db.delete(prompts).where(eq(prompts.id, id));
  return NextResponse.json({ ok: true });
}
