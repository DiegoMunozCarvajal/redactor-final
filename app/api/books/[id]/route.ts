import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  bookTemplates,
  chapters,
  projects,
  templatePipelineRuns,
  templateRunArtifacts,
  originalityAssessments,
  pipelineMaintenanceOperations,
} from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/admin";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { logAudit } from "@/lib/audit";
import { COMPILER_VERSION } from "@/lib/template-pipeline/compiler";
import { SAFE_PIPELINE_VERSION } from "@/lib/template-pipeline/contracts";
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
    .select({
      id: bookTemplates.id,
      name: bookTemplates.name,
      description: bookTemplates.description,
      status: bookTemplates.status,
      activePipelineRunId: bookTemplates.activePipelineRunId,
      createdAt: bookTemplates.createdAt,
    })
    .from(bookTemplates)
    .where(eq(bookTemplates.id, id))
    .limit(1);

  if (!book) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Attach pipeline run info when available (never expose report/profiles)
  let pipelineRun: Record<string, unknown> | null = null;
  if (book.activePipelineRunId) {
    const [run] = await db
      .select({
        id: templatePipelineRuns.id,
        status: templatePipelineRuns.status,
        pipelineVersion: templatePipelineRuns.pipelineVersion,
        compilerHash: templatePipelineRuns.compilerHash,
        failureStage: templatePipelineRuns.failureStage,
        completedAt: templatePipelineRuns.completedAt,
        originalityPolicyVersion: templatePipelineRuns.originalityPolicyVersion,
      })
      .from(templatePipelineRuns)
      .where(eq(templatePipelineRuns.id, book.activePipelineRunId))
      .limit(1);

    if (run) {
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(templateRunArtifacts)
        .where(eq(templateRunArtifacts.pipelineRunId, run.id));

      const [{ totalChapters }] = await db
        .select({ totalChapters: sql<number>`count(*)::int` })
        .from(chapters)
        .where(and(eq(chapters.bookTemplateId, id), isNull(chapters.projectId)));

      pipelineRun = {
        id: run.id,
        status: run.status,
        completedArtifacts: count,
        totalChapters,
        failureStage: run.failureStage,
        compilerHash: run.compilerHash,
        originalityPolicyVersion: run.originalityPolicyVersion,
      };
    }
  }

  // ---- Safety classification ----
  let classification: "legacy_unverified" | "suspect" | "contaminated" | "clean_v2" = "legacy_unverified";
  let replacementTemplateId: string | undefined;

  // 1. Check templatePipelineRuns for a clean run with valid compilerVersion
  const [cleanRun] = await db
    .select({ id: templatePipelineRuns.id })
    .from(templatePipelineRuns)
    .where(
      and(
        eq(templatePipelineRuns.bookTemplateId, id),
        eq(templatePipelineRuns.status, "clean"),
        eq(templatePipelineRuns.compilerVersion, COMPILER_VERSION),
        eq(templatePipelineRuns.pipelineVersion, SAFE_PIPELINE_VERSION),
      ),
    )
    .orderBy(desc(templatePipelineRuns.createdAt))
    .limit(1);

  if (cleanRun) {
    classification = "clean_v2";
  } else {
    // 2. Aggregate ALL originalityAssessments for this template's projects.
    //    Precedence: contaminated > suspect. A single contaminated assessment
    //    is never masked by a later suspect assessment.
    const assessments = await db
      .selectDistinct({ decision: originalityAssessments.decision })
      .from(originalityAssessments)
      .innerJoin(projects, eq(originalityAssessments.projectId, projects.id))
      .where(eq(projects.bookTemplateId, id));

    const decisions = new Set(assessments.map((a) => a.decision));
    if (decisions.has("contaminated")) {
      classification = "contaminated";
    } else if (decisions.has("suspect")) {
      classification = "suspect";
    }
  }

  // 3. Check pipelineMaintenanceOperations for a replacement template
  const [replacementOp] = await db
    .select({ resultTemplateId: pipelineMaintenanceOperations.resultTemplateId })
    .from(pipelineMaintenanceOperations)
    .where(
      and(
        eq(pipelineMaintenanceOperations.kind, "template_regeneration"),
        eq(pipelineMaintenanceOperations.status, "completed"),
        sql`${pipelineMaintenanceOperations.report}->>'legacyTemplateId' = ${id}`,
      ),
    )
    .limit(1);

  if (replacementOp?.resultTemplateId) {
    replacementTemplateId = replacementOp.resultTemplateId;
  }

  const safety = {
    classification,
    ...(replacementTemplateId && { replacementTemplateId }),
  };

  return NextResponse.json({ ...book, pipelineRun, safety });
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

  await logAudit({
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

  await logAudit({
    userId: admin.user.id,
    action: "template.delete",
    resourceType: "book_template",
    resourceId: id,
    metadata: template ? { name: template.name } : undefined,
  });

  return NextResponse.json({ ok: true });
}
