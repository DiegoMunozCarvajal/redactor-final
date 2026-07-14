import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  promptDefaults,
  promptRevisions,
  promptDefinitions,
  promptKindValues,
} from "@/lib/db/schema/prompt-registry";
import { eq } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { requireAdmin } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";
import { resolvePromptRevision } from "@/lib/prompts/repository";
import type { PromptKind } from "@/lib/db/schema/prompt-registry";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ kind: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { kind } = await params;
  if (!(promptKindValues as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: `invalid kind: ${kind}` }, { status: 400 });
  }

  const [def] = await db
    .select({
      kind: promptDefaults.kind,
      promptRevisionId: promptDefaults.promptRevisionId,
      versionLabel: promptRevisions.versionLabel,
      revisionNumber: promptRevisions.revisionNumber,
      definitionName: promptDefinitions.name,
    })
    .from(promptDefaults)
    .innerJoin(promptRevisions, eq(promptDefaults.promptRevisionId, promptRevisions.id))
    .innerJoin(promptDefinitions, eq(promptRevisions.promptDefinitionId, promptDefinitions.id))
    .where(eq(promptDefaults.kind, kind))
    .limit(1);

  if (!def) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json(def);
}

const setDefaultSchema = z.object({
  promptRevisionId: z.string().uuid(),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ kind: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const admin = await requireAdmin();
  if (!admin.authorized) return admin.response;

  const { kind } = await params;
  if (!(promptKindValues as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: `invalid kind: ${kind}` }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = setDefaultSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Verify revision exists, is executable, and kind matches
  try {
    await resolvePromptRevision({
      kind: kind as PromptKind,
      runRevisionId: parsed.data.promptRevisionId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  await db
    .insert(promptDefaults)
    .values({
      kind: kind as PromptKind,
      promptRevisionId: parsed.data.promptRevisionId,
      updatedBy: admin.user.id,
    })
    .onConflictDoUpdate({
      target: promptDefaults.kind,
      set: {
        promptRevisionId: parsed.data.promptRevisionId,
        updatedBy: admin.user.id,
        updatedAt: new Date(),
      },
    });

  return NextResponse.json({ kind, promptRevisionId: parsed.data.promptRevisionId });
}
