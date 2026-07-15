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

class PromptValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromptValidationError";
  }
}

const DOMAIN_ERRORS = [
  "not found",
  "archived",
  "Prompt kind mismatch",
  "non-executable",
  "Missing required marker",
  "Unknown runtime marker",
  "Reserved configuration key",
];

function isDomainError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return DOMAIN_ERRORS.some((p) => message.includes(p));
}

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

  // Lock the definition row before any validation so a concurrent archive
  // cannot commit between a stale read and the upsert.  Only lock
  // promptDefinitions — revisions are immutable, and locking both tables
  // in a different order than the archive path would risk deadlocks.
  try {
    await db.transaction(async (tx) => {
      // 1. Read the definition id from the revision (no lock needed — immutable)
      const [rev] = await tx
        .select({ definitionId: promptRevisions.promptDefinitionId })
        .from(promptRevisions)
        .where(eq(promptRevisions.id, parsed.data.promptRevisionId))
        .limit(1);

      if (!rev) {
        throw new PromptValidationError("Prompt revision not found");
      }

      // 2. Lock only the definition row — same order as archive path
      const [def] = await tx
        .select({ id: promptDefinitions.id, archivedAt: promptDefinitions.archivedAt })
        .from(promptDefinitions)
        .where(eq(promptDefinitions.id, rev.definitionId))
        .for("update");

      if (!def) {
        throw new PromptValidationError("Prompt definition not found");
      }
      if (def.archivedAt !== null) {
        throw new PromptValidationError("Prompt definition is archived");
      }

      // 3. Full validation (kind match, non-executable, markers) under lock
      await resolvePromptRevision(
        { kind: kind as PromptKind, runRevisionId: parsed.data.promptRevisionId },
        tx,
      );

      // 4. Upsert
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
    if (error instanceof PromptValidationError || isDomainError(error)) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return NextResponse.json({ error: message }, { status: 400 });
    }
    // Re-throw unexpected errors (DB failures, etc.) → 500
    throw error;
  }

  return NextResponse.json({ kind, promptRevisionId: parsed.data.promptRevisionId });
}
