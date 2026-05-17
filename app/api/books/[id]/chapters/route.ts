import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chapters } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, asc, sql } from "drizzle-orm";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const result = await db
    .select()
    .from(chapters)
    .where(eq(chapters.bookTemplateId, id))
    .orderBy(asc(chapters.position));
  return NextResponse.json(result);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const { title, position } = body;

  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });

  const existing = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(chapters)
    .where(eq(chapters.bookTemplateId, id));

  const pos = position ?? (existing[0]?.count ?? 0);

  const [chapter] = await db
    .insert(chapters)
    .values({ bookTemplateId: id, title, position: pos })
    .returning();
  return NextResponse.json(chapter);
}
