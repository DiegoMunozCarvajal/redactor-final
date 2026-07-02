import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { promptLibrary, projects } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { requireAdmin } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const [row] = await db.select().from(promptLibrary).where(eq(promptLibrary.id, id)).limit(1);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json(row);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const admin = await requireAdmin();
  if (!admin.authorized) return admin.response;

  const { id } = await params;

  // Fetch existing row for marker validation
  const [existing] = await db
    .select()
    .from(promptLibrary)
    .where(eq(promptLibrary.id, id))
    .limit(1);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const { name, description, content, userPrompt, category } = body;

  if (content !== undefined && (typeof content !== "string" || content.length > 100_000)) {
    return NextResponse.json({ error: "content too long" }, { status: 400 });
  }
  if (userPrompt !== undefined && (typeof userPrompt !== "string" || userPrompt.length > 50_000)) {
    return NextResponse.json({ error: "userPrompt too long" }, { status: 400 });
  }

  const effectiveCategory = category ?? existing.category;
  if (category !== undefined && !["assembly", "critique", "corrector"].includes(category)) {
    return NextResponse.json(
      { error: "category must be one of: assembly, critique, corrector" },
      { status: 400 },
    );
  }

  // Validate required content markers per category so the LLM actually
  // receives the material it needs. Check against the merged content
  // (new values + existing values for fields not being updated).
  const MARKERS_BY_CATEGORY: Record<string, RegExp> = {
    assembly: /\{\{SECCIONES_GENERADAS\}\}|\[PEGAR AQUÍ TODOS LOS FRAGMENTOS DEL CAPÍTULO\]|\[PASTE ALL CHAPTER FRAGMENTS HERE\]/,
    critique: /\{\{CONTENIDO_CAPITULO\}\}|\[PEGAR AQUÍ EL CAPÍTULO A CRITICAR\]|\[PEGAR AQUÍ EL CAPÍTULO COMPLETO\]/,
    corrector: /\{\{CONTENIDO_CAPITULO\}\}|\{\{CONTENIDO_CRITICA\}\}/,
  };
  const markerRegex = MARKERS_BY_CATEGORY[effectiveCategory];
  if (markerRegex) {
    const effectiveContent = content !== undefined ? content : existing.content;
    const effectiveUserPrompt = userPrompt !== undefined ? userPrompt : existing.userPrompt;
    const checkText = [effectiveContent, effectiveUserPrompt]
      .filter((s): s is string => typeof s === "string" && s.length > 0)
      .join("\n");
    if (!markerRegex.test(checkText)) {
      return NextResponse.json(
        { error: `prompt content must include a content marker for category "${effectiveCategory}". See prompt library docs for required markers.` },
        { status: 400 },
      );
    }
  }

  const [updated] = await db
    .update(promptLibrary)
    .set({
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(content !== undefined ? { content } : {}),
      ...(userPrompt !== undefined ? { userPrompt } : {}),
      ...(category !== undefined ? { category } : {}),
      updatedAt: new Date(),
    })
    .where(eq(promptLibrary.id, id))
    .returning();

  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });

  await logAudit({
    userId: admin.user.id,
    action: "prompt_library.update",
    resourceType: "prompt_library",
    resourceId: updated.id,
    metadata: { name: updated.name, category: updated.category },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const admin = await requireAdmin();
  if (!admin.authorized) return admin.response;

  const { id } = await params;

  // Check if any projects reference this prompt as their assembly prompt.
  // FK ON DELETE SET NULL would silently deconfigure those projects.
  const [refCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projects)
    .where(eq(projects.assemblyPromptId, id));
  if (refCount && refCount.count > 0) {
    return NextResponse.json(
      { error: `Cannot delete: referenced by ${refCount.count} project(s) as assembly prompt` },
      { status: 409 },
    );
  }

  const [deleted] = await db.delete(promptLibrary).where(eq(promptLibrary.id, id)).returning();
  if (!deleted) return NextResponse.json({ error: "not found" }, { status: 404 });

  await logAudit({
    userId: admin.user.id,
    action: "prompt_library.delete",
    resourceType: "prompt_library",
    resourceId: deleted.id,
    metadata: { name: deleted.name, category: deleted.category },
  });

  return NextResponse.json({ ok: true });
}
