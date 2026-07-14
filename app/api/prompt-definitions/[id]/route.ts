import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  promptDefinitions,
  promptRevisions,
  promptDefaults,
  projectPromptBindings,
} from "@/lib/db/schema/prompt-registry";
import { eq, desc, or, and } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { requireAdmin } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";

const updateDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  archived: z.boolean().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;

  const [def] = await db
    .select()
    .from(promptDefinitions)
    .where(eq(promptDefinitions.id, id))
    .limit(1);

  if (!def) return NextResponse.json({ error: "not found" }, { status: 404 });

  const revisions = await db
    .select()
    .from(promptRevisions)
    .where(eq(promptRevisions.promptDefinitionId, id))
    .orderBy(desc(promptRevisions.revisionNumber));

  return NextResponse.json({ ...def, revisions });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const admin = await requireAdmin();
  if (!admin.authorized) return admin.response;

  const { id } = await params;

  const [def] = await db
    .select()
    .from(promptDefinitions)
    .where(eq(promptDefinitions.id, id))
    .limit(1);

  if (!def) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const parsed = updateDefinitionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  if (parsed.data.archived) {
    // Safety check: reject if any current default or binding references a revision of this definition
    const revisions = await db
      .select({ id: promptRevisions.id })
      .from(promptRevisions)
      .where(eq(promptRevisions.promptDefinitionId, id));

    const revisionIds = revisions.map((r) => r.id);

    if (revisionIds.length > 0) {
      const [defaultRef] = await db
        .select({ kind: promptDefaults.kind })
        .from(promptDefaults)
        .where(
          or(...revisionIds.map((rid) => eq(promptDefaults.promptRevisionId, rid))),
        )
        .limit(1);

      if (defaultRef) {
        return NextResponse.json(
          { error: `definition is in use as default for kind "${defaultRef.kind}"` },
          { status: 409 },
        );
      }

      const [bindingRef] = await db
        .select({ kind: projectPromptBindings.kind })
        .from(projectPromptBindings)
        .where(
          or(...revisionIds.map((rid) => eq(projectPromptBindings.promptRevisionId, rid))),
        )
        .limit(1);

      if (bindingRef) {
        return NextResponse.json(
          { error: `definition is in use by project binding for kind "${bindingRef.kind}"` },
          { status: 409 },
        );
      }
    }

    const [updated] = await db
      .update(promptDefinitions)
      .set({ archivedAt: new Date() })
      .where(eq(promptDefinitions.id, id))
      .returning();

    return NextResponse.json(updated);
  }

  const [updated] = await db
    .update(promptDefinitions)
    .set({
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.description !== undefined && { description: parsed.data.description }),
    })
    .where(eq(promptDefinitions.id, id))
    .returning();

  return NextResponse.json(updated);
}
