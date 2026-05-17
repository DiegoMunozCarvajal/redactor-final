import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bookTemplates } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq } from "drizzle-orm";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const { name, description } = body;

  const [template] = await db
    .update(bookTemplates)
    .set({ name, description })
    .where(eq(bookTemplates.id, id))
    .returning();

  if (!template) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(template);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  await db.delete(bookTemplates).where(eq(bookTemplates.id, id));
  return NextResponse.json({ ok: true });
}
