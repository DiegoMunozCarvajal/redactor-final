import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bookTemplates, chapters, projects } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/admin";
import { and, eq, isNull, sql } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { logAudit } from "@/lib/audit";
import { UUID_RE } from "@/lib/constants";

// GET is open to all authenticated users — templates must be
// browsable so users can select one when creating a project.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;

  // Validate UUID format to prevent Postgres errors on non-UUID params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const [book] = await db
    .select()
    .from(bookTemplates)
    .where(eq(bookTemplates.id, id))
    .limit(1);

  if (!book) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(book);
}

// NOTE: Uses PUT for partial update (PATCH semantics).
// Kept as PUT for backward compatibility with admin UI.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const admin = await requireAdmin();
  if (!admin.authorized) return admin.response;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { name, description } = body;

  if (name !== undefined && (typeof name !== "string" || name.length > 200)) {
    return NextResponse.json({ error: "name too long" }, { status: 400 });
  }
  if (description !== undefined && (typeof description !== "string" || description.length > 2000)) {
    return NextResponse.json({ error: "description too long" }, { status: 400 });
  }

  const [template] = await db
    .update(bookTemplates)
    .set({
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
    })
    .where(eq(bookTemplates.id, id))
    .returning();

  if (!template) return NextResponse.json({ error: "not found" }, { status: 404 });

  logAudit({
    userId: admin.user.id,
    action: "template.update",
    resourceType: "book_template",
    resourceId: template.id,
    metadata: { name: template.name },
  });

  return NextResponse.json(template);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = csrfCheck(_req);
  if (csrfError) return csrfError;

  const admin = await requireAdmin();
  if (!admin.authorized) return admin.response;

  const { id } = await params;

  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projects)
    .where(eq(projects.bookTemplateId, id));

  if (result && result.count > 0) {
    return NextResponse.json(
      { error: "Template is in use and cannot be deleted. Remove associated projects first." },
      { status: 409 },
    );
  }

  // Fetch template name for audit before deleting
  const [template] = await db
    .select({ name: bookTemplates.name })
    .from(bookTemplates)
    .where(eq(bookTemplates.id, id))
    .limit(1);

  try {
    // Delete template-scoped chapters first so ON DELETE SET NULL + CHECK
    // constraint don't conflict. Cascades to prompts, briefs, configs, etc.
    await db
      .delete(chapters)
      .where(
        and(
          eq(chapters.bookTemplateId, id),
          isNull(chapters.projectId),
        ),
      );

    await db.delete(bookTemplates).where(eq(bookTemplates.id, id));

    // Belt-and-suspenders: clean up any remaining orphaned chapters
    await db.delete(chapters).where(
      and(isNull(chapters.bookTemplateId), isNull(chapters.projectId)),
    );
  } catch (error) {
    console.error("Failed to delete template", { templateId: id, error });
    return NextResponse.json(
      { error: "Failed to delete template" },
      { status: 500 },
    );
  }

  logAudit({
    userId: admin.user.id,
    action: "template.delete",
    resourceType: "book_template",
    resourceId: id,
    metadata: template ? { name: template.name } : undefined,
  });

  return NextResponse.json({ ok: true });
}
