import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { editorialBriefBundleInputSchema } from "@/lib/editorial-brief/schema";
import { createClient } from "@/lib/supabase/server";
import { eq } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { sanitizeError } from "@/lib/sanitize-error";
import { logAudit } from "@/lib/audit";
import {
  getEditorialBriefBundle,
  replaceEditorialBriefDraft,
  deleteEditorialBriefDraft,
} from "@/lib/editorial-brief/repository";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapRepoError(err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : "Unknown error";
  if (message.includes("not found") || message.includes("do not belong")) {
    return NextResponse.json({ error: message }, { status: 404 });
  }
  if (message.includes("non-draft") || message.includes("hash mismatch")) {
    return NextResponse.json({ error: message }, { status: 409 });
  }
  if (message.includes("Invalid bundle")) {
    return NextResponse.json({ error: message }, { status: 400 });
  }
  return NextResponse.json({ error: sanitizeError(err) }, { status: 500 });
}

// ---------------------------------------------------------------------------
// GET — load a single editorial brief by id
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; briefId: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId, briefId } = await params;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Parse optional expectedHash query param
  const url = new URL(_req.url);
  const expectedHash = url.searchParams.get("expectedHash") ?? undefined;

  try {
    const brief = await getEditorialBriefBundle({
      projectId,
      briefId,
      expectedHash,
    });
    if (!brief) {
      return NextResponse.json(
        { error: "Editorial brief not found" },
        { status: 404 },
      );
    }
    return NextResponse.json(brief);
  } catch (err) {
    return mapRepoError(err);
  }
}

// ---------------------------------------------------------------------------
// PATCH — replace a draft bundle (content + contracts + sources)
// ---------------------------------------------------------------------------

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; briefId: string }> },
) {
  const csrfError = csrfCheck(_req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId, briefId } = await params;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Parse and validate body
  let body: unknown;
  try {
    const text = await _req.text();
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = editorialBriefBundleInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: `Invalid body: ${parsed.error.errors.map((e) => e.message).join("; ")}`,
      },
      { status: 400 },
    );
  }

  try {
    const brief = await replaceEditorialBriefDraft({
      briefId,
      projectId,
      content: parsed.data.content,
      contracts: parsed.data.contracts,
      evidenceSourceIds: parsed.data.evidenceSourceIds,
    });

    await logAudit({
      userId: user.id,
      action: "editorial-brief.update",
      resourceType: "editorial_brief",
      resourceId: brief.id,
      metadata: { projectId, version: brief.version },
    });

    return NextResponse.json(brief);
  } catch (err) {
    return mapRepoError(err);
  }
}

// ---------------------------------------------------------------------------
// DELETE — delete a draft brief
// ---------------------------------------------------------------------------

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; briefId: string }> },
) {
  const csrfError = csrfCheck(_req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId, briefId } = await params;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  try {
    await deleteEditorialBriefDraft({ briefId, projectId });

    await logAudit({
      userId: user.id,
      action: "editorial-brief.delete",
      resourceType: "editorial_brief",
      resourceId: briefId,
      metadata: { projectId },
    });

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return mapRepoError(err);
  }
}
