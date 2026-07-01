import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { critiquePrompts } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/admin";
import { asc } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { logAudit } from "@/lib/audit";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.authorized) return admin.response;

  const rows = await db
    .select()
    .from(critiquePrompts)
    .orderBy(asc(critiquePrompts.createdAt));

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

  const [critiquePrompt] = await db
    .insert(critiquePrompts)
    .values({ name, description: description ?? null, content, userPrompt: userPrompt ?? null })
    .returning();

  logAudit({
    userId: admin.user.id,
    action: "critique_prompt.create",
    resourceType: "critique_prompt",
    resourceId: critiquePrompt.id,
    metadata: { name: critiquePrompt.name },
  });

  return NextResponse.json(critiquePrompt);
}
