import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { promptRevisions } from "@/lib/db/schema/prompt-registry";
import { eq, desc } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { requireAdmin } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";
import { createPromptRevision } from "@/lib/prompts/repository";
import { promptRevisionInputSchema } from "@/lib/prompts/contracts";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;

  const revisions = await db
    .select()
    .from(promptRevisions)
    .where(eq(promptRevisions.promptDefinitionId, id))
    .orderBy(desc(promptRevisions.revisionNumber));

  return NextResponse.json(revisions);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const admin = await requireAdmin();
  if (!admin.authorized) return admin.response;

  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const parsed = promptRevisionInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const revision = await createPromptRevision(id, parsed.data, admin.user.id);
    return NextResponse.json(revision, { status: 201 });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json(
        { error: "versionLabel already exists for this definition" },
        { status: 409 },
      );
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message.includes("archived")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    if (message.includes("Missing required marker") || message.includes("Unknown runtime marker") || message.includes("Reserved configuration key")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
