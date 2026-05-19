import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { prompts, promptVersions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { requireAdmin } from "@/lib/auth/admin";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const admin = await requireAdmin();
  if (!admin.authorized) return admin.response;

  const { id } = await params;

  const [version] = await db
    .select()
    .from(promptVersions)
    .where(eq(promptVersions.id, id))
    .limit(1);

  if (!version) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Save current prompt as a new version
  const [current] = await db
    .select()
    .from(prompts)
    .where(eq(prompts.id, version.promptId))
    .limit(1);

  if (current) {
    await db.insert(promptVersions).values({
      promptId: current.id,
      title: current.title,
      content: current.content,
    });
  }

  // Restore the version content
  const [restored] = await db
    .update(prompts)
    .set({ title: version.title, content: version.content })
    .where(eq(prompts.id, version.promptId))
    .returning();

  if (!restored) return NextResponse.json({ error: "prompt not found" }, { status: 404 });
  return NextResponse.json(restored);
}
