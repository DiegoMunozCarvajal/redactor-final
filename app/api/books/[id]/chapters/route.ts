import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chapters } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, asc, sql, and, isNull } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;

  // Validate UUID format to prevent Postgres errors on non-UUID params
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(id)) {
    return NextResponse.json([], { status: 200 });
  }

  const result = await db
    .select()
    .from(chapters)
    .where(
      and(
        eq(chapters.bookTemplateId, id),
        isNull(chapters.projectId),
      ),
    )
    .orderBy(asc(chapters.position));
  return NextResponse.json(result);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { title, position } = body;

  if (position !== undefined && (position < 0 || position > 1000))
    return NextResponse.json({ error: "position must be 0-1000" }, { status: 400 });

  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });

  const existing = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(chapters)
    .where(
      and(
        eq(chapters.bookTemplateId, id),
        isNull(chapters.projectId),
      ),
    );

  const pos = position ?? (existing[0]?.count ?? 0);

  const [chapter] = await db
    .insert(chapters)
    .values({ bookTemplateId: id, title, position: pos })
    .returning();
  return NextResponse.json(chapter);
}
