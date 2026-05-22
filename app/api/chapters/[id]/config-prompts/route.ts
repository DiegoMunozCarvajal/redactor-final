import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chapterConfigPrompts } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { requireAdmin } from "@/lib/auth/admin";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const rows = await db
    .select()
    .from(chapterConfigPrompts)
    .where(eq(chapterConfigPrompts.chapterId, id));
  return NextResponse.json(rows);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const admin = await requireAdmin();
  if (!admin.authorized) return admin.response;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const prompts: { type: string; content: string }[] = body.prompts ?? [];

  if (!Array.isArray(prompts)) {
    return NextResponse.json({ error: "prompts must be an array" }, { status: 400 });
  }

  for (const p of prompts) {
    if (!p.type || !p.content) continue;
    await db
      .insert(chapterConfigPrompts)
      .values({ chapterId: id, type: p.type, content: p.content })
      .onConflictDoUpdate({
        target: [chapterConfigPrompts.chapterId, chapterConfigPrompts.type],
        set: { content: p.content },
      });
  }

  const rows = await db
    .select()
    .from(chapterConfigPrompts)
    .where(eq(chapterConfigPrompts.chapterId, id));
  return NextResponse.json(rows);
}
