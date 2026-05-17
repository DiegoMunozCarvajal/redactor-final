import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bookTemplates } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const templates = await db.select().from(bookTemplates).orderBy(bookTemplates.createdAt);
  return NextResponse.json(templates);
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, description } = body;

  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const [template] = await db.insert(bookTemplates).values({ name, description }).returning();
  return NextResponse.json(template);
}
