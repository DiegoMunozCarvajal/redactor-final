import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { prompts } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, asc, sql } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { logAudit } from "@/lib/audit";
import { syncChapterPlaceholders } from "@/lib/placeholders";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const result = await db
    .select()
    .from(prompts)
    .where(eq(prompts.chapterId, id))
    .orderBy(asc(prompts.position));
  return NextResponse.json(result);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const { title, content, position, isAssembly } = body;

  if (!title || !content) {
    return NextResponse.json({ error: "title and content are required" }, { status: 400 });
  }

  const existing = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(prompts)
    .where(eq(prompts.chapterId, id));

  const pos = position ?? (existing[0]?.count ?? 0);

  const [prompt] = await db
    .insert(prompts)
    .values({
      chapterId: id,
      title,
      content,
      position: pos,
      isAssembly: isAssembly ?? false,
    })
    .returning();

  logAudit({
    userId: user.id,
    action: "prompt.create",
    resourceType: "prompt",
    resourceId: prompt.id,
    metadata: { title: prompt.title, isAssembly: prompt.isAssembly, chapterId: id },
  });

  // Sync placeholders for this chapter
  const allPrompts = await db
    .select({ content: prompts.content })
    .from(prompts)
    .where(eq(prompts.chapterId, id));
  await syncChapterPlaceholders(id, allPrompts.map((p) => p.content));

  return NextResponse.json(prompt);
}
