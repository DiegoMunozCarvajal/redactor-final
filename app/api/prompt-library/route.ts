import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { promptLibrary } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { requireAdmin } from "@/lib/auth/admin";
import { logAudit } from "@/lib/audit";

const VALID_CATEGORIES = ["assembly", "critique", "corrector"] as const;

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.authorized) return admin.response;

  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");

  const base = db.select().from(promptLibrary).$dynamic();
  if (category && VALID_CATEGORIES.includes(category as (typeof VALID_CATEGORIES)[number])) {
    base.where(eq(promptLibrary.category, category));
  }
  const rows = await base.orderBy(asc(promptLibrary.createdAt));

  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const admin = await requireAdmin();
  if (!admin.authorized) return admin.response;

  const body = await req.json().catch(() => ({}));
  const { category, name, description, content, userPrompt } = body;

  if (!name || !content) {
    return NextResponse.json({ error: "name and content are required" }, { status: 400 });
  }
  if (!category || !VALID_CATEGORIES.includes(category)) {
    return NextResponse.json(
      { error: `category must be one of: ${VALID_CATEGORIES.join(", ")}` },
      { status: 400 },
    );
  }

  const [row] = await db
    .insert(promptLibrary)
    .values({ category, name, description: description ?? null, content, userPrompt: userPrompt ?? null })
    .returning();

  logAudit({
    userId: admin.user.id,
    action: "prompt_library.create",
    resourceType: "prompt_library",
    resourceId: row.id,
    metadata: { name: row.name, category: row.category },
  });

  return NextResponse.json(row);
}
