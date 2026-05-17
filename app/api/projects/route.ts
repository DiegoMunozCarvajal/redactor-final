import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, desc } from "drizzle-orm";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const result = await db
    .select()
    .from(projects)
    .where(eq(projects.userId, user.id))
    .orderBy(desc(projects.createdAt));
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, topic, bookTemplateId } = body;

  if (!name || !topic || !bookTemplateId) {
    return NextResponse.json({ error: "name, topic, and bookTemplateId are required" }, { status: 400 });
  }

  const [project] = await db
    .insert(projects)
    .values({ userId: user.id, name, topic, bookTemplateId })
    .returning();
  return NextResponse.json(project);
}
