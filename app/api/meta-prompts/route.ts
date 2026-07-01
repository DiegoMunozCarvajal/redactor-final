import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { metaPrompts } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/admin";
import { desc } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { logAudit } from "@/lib/audit";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.authorized) return admin.response;

  const rows = await db
    .select()
    .from(metaPrompts)
    .orderBy(desc(metaPrompts.createdAt))
    .limit(100);

  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const admin = await requireAdmin();
  if (!admin.authorized) return admin.response;

  const body = await req.json().catch(() => ({}));
  const { name, description, content, userPrompt } = body;

  if (!name || !content) {
    return NextResponse.json({ error: "name and content are required" }, { status: 400 });
  }
  if (typeof content !== "string" || content.length > 20000) {
    return NextResponse.json({ error: "content too long" }, { status: 400 });
  }

  const [metaPrompt] = await db
    .insert(metaPrompts)
    .values({ name, description: description ?? null, content, userPrompt: userPrompt ?? null })
    .returning();

  await logAudit({
    userId: admin.user.id,
    action: "meta_prompt.create",
    resourceType: "meta_prompt",
    resourceId: metaPrompt.id,
    metadata: { name: metaPrompt.name },
  });

  return NextResponse.json(metaPrompt);
}
