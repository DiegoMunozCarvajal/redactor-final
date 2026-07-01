import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { correctorPrompts } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/admin";
import { asc } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { logAudit } from "@/lib/audit";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.authorized) return admin.response;

  const rows = await db
    .select()
    .from(correctorPrompts)
    .orderBy(asc(correctorPrompts.createdAt));

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

  const [correctorPrompt] = await db
    .insert(correctorPrompts)
    .values({ name, description: description ?? null, content, userPrompt: userPrompt ?? null })
    .returning();

  logAudit({
    userId: admin.user.id,
    action: "corrector_prompt.create",
    resourceType: "corrector_prompt",
    resourceId: correctorPrompt.id,
    metadata: { name: correctorPrompt.name },
  });

  return NextResponse.json(correctorPrompt);
}
