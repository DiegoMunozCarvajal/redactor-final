import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bookTemplates, chapters, templatePipelineRuns } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/admin";
import { sql, desc, eq, and } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { logAudit } from "@/lib/audit";
import { isTemplateEligible } from "@/lib/template-pipeline/eligibility";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const templates = await db
    .select({
      id: bookTemplates.id,
      name: bookTemplates.name,
      description: bookTemplates.description,
      status: bookTemplates.status,
      activePipelineRunId: bookTemplates.activePipelineRunId,
      runStatus: templatePipelineRuns.status,
      pipelineVersion: templatePipelineRuns.pipelineVersion,
      originalityPolicyVersion: templatePipelineRuns.originalityPolicyVersion,
      createdAt: bookTemplates.createdAt,
      chapterCount: sql<number>`cast(count(${chapters.id}) as int)`,
    })
    .from(bookTemplates)
    .leftJoin(
      templatePipelineRuns,
      and(
        eq(bookTemplates.activePipelineRunId, templatePipelineRuns.id),
        eq(templatePipelineRuns.bookTemplateId, bookTemplates.id),
      ),
    )
    .leftJoin(chapters, sql`${bookTemplates.id} = ${chapters.bookTemplateId} AND ${chapters.projectId} IS NULL`)
    .groupBy(bookTemplates.id, templatePipelineRuns.id)
    .orderBy(desc(bookTemplates.createdAt))
    .limit(100);

  const result = templates.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    status: t.status,
    createdAt: t.createdAt,
    chapterCount: Number(t.chapterCount),
    eligibleForProjects: isTemplateEligible({
      templateStatus: t.status,
      activeRunId: t.activePipelineRunId ?? null,
      runStatus: t.runStatus ?? null,
      pipelineVersion: t.pipelineVersion ?? null,
      originalityPolicyVersion: t.originalityPolicyVersion ?? null,
    }),
  }));

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const admin = await requireAdmin();
  if (!admin.authorized) return admin.response;

  const body = await req.json().catch(() => ({}));
  const { name, description } = body;

  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const [template] = await db.insert(bookTemplates).values({ name, description }).returning();

  await logAudit({
    userId: admin.user.id,
    action: "template.create",
    resourceType: "book_template",
    resourceId: template.id,
    metadata: { name: template.name },
  });

  return NextResponse.json(template);
}
