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
      id: promptRevisions.id,
      kind: promptDefaults.kind,
      promptRevisionId: promptDefaults.promptRevisionId,
      versionLabel: promptRevisions.versionLabel,
      revisionNumber: promptRevisions.revisionNumber,
      name: promptDefinitions.name,
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

  // Verify revision exists, is executable, kind matches, and definition is
  // not archived — all inside a transaction that locks the definition row so
  // a concurrent archive cannot slip between check and upsert.
  try {
    await db.transaction(async (tx) => {
      // Resolve the revision first (validates kind match, non-executable, etc.)
      const resolved = await resolvePromptRevision(
        { kind: kind as PromptKind, runRevisionId: parsed.data.promptRevisionId },
        tx,
      );

      // Lock the definition row and re-validate archivedAt AFTER acquiring
      // the lock.  This serialises with setPromptDefinitionArchived which
      // also locks the definition FOR UPDATE before changing archivedAt.
      const [def] = await tx
        .select({ id: promptDefinitions.id, archivedAt: promptDefinitions.archivedAt })
        .from(promptDefinitions)
        .where(eq(promptDefinitions.id, resolved.definitionId))
        .for("update");

      if (!def) {
        throw new Error("Prompt definition not found");
      }
      if (def.archivedAt !== null) {
        throw new Error("Prompt definition is archived");
      }

      await tx
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
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    // Domain errors → 400; unexpected errors re-throw → 500
    if (
      message.includes("not found") ||
      message.includes("archived") ||
      message.includes("Prompt kind mismatch") ||
      message.includes("non-executable") ||
      message.includes("Missing required marker") ||
      message.includes("Unknown runtime marker") ||
      message.includes("Reserved configuration key")
    ) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    throw error;
  }

  return NextResponse.json({ kind, promptRevisionId: parsed.data.promptRevisionId });
}
