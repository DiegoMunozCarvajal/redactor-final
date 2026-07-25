import { db } from "@/lib/db/drizzle";
import {
  bookTemplates,
  templatePipelineRuns,
  originalityAssessments,
  projects,
  chapters,
  chapterGenerations,
} from "@/lib/db/schema";
import { eq, inArray, desc } from "drizzle-orm";
import { COMPILER_VERSION } from "@/lib/template-pipeline/compiler";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TemplateClassification =
  | "clean_v2"
  | "legacy_unverified"
  | "suspect"
  | "contaminated";

export interface SafeAuditReport {
  templateId: string;
  templateName: string;
  classification: TemplateClassification;
  pipelineVersion: string | null;
  pipelineRunId: string | null;
  sourceFilesAvailable: boolean;
  historicalExecutionRecoverable: boolean;
  chapterCount: number;
  derivedProjectIds: string[];
  projectCount: number;
  generationCount: number;
  recommendedAction: string;
}

// ---------------------------------------------------------------------------
// Action map
// ---------------------------------------------------------------------------

const ACTIONS: Record<TemplateClassification, string> = {
  clean_v2: "none — template is clean",
  legacy_unverified: "review manually or regenerate with sources",
  suspect: "regenerate with sources recommended",
  contaminated: "regenerate with sources required",
};

// ---------------------------------------------------------------------------
// Single template audit
// ---------------------------------------------------------------------------

export async function auditTemplate(
  templateId: string,
): Promise<SafeAuditReport> {
  // 1. Load template
  const [template] = await db
    .select()
    .from(bookTemplates)
    .where(eq(bookTemplates.id, templateId));

  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }

  // 2. Check for active clean v2 pipeline run
  const pipelineRuns = await db
    .select()
    .from(templatePipelineRuns)
    .where(eq(templatePipelineRuns.bookTemplateId, templateId))
    .orderBy(desc(templatePipelineRuns.createdAt));

  const cleanActiveRun = pipelineRuns.find(
    (r) => r.status === "clean" && r.compilerVersion === COMPILER_VERSION,
  );

  // 3. Check for originality assessments via linked projects
  const templateProjects = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.bookTemplateId, templateId));

  const projectIds = templateProjects.map((p) => p.id);

  let hasContaminated = false;
  let hasSuspect = false;
  if (projectIds.length > 0) {
    const assessments = await db
      .select({ decision: originalityAssessments.decision })
      .from(originalityAssessments)
      .where(inArray(originalityAssessments.projectId, projectIds));

    hasContaminated = assessments.some(
      (a) => a.decision === "contaminated",
    );
    hasSuspect = assessments.some((a) => a.decision === "suspect");
  }

  // 4. Classify
  let classification: TemplateClassification;
  if (cleanActiveRun) {
    classification = "clean_v2";
  } else if (hasContaminated) {
    classification = "contaminated";
  } else if (hasSuspect) {
    classification = "suspect";
  } else {
    classification = "legacy_unverified";
  }

  // 5. Load chapter count
  const templateChapters = await db
    .select({ id: chapters.id })
    .from(chapters)
    .where(eq(chapters.bookTemplateId, templateId));

  // 6. Count generations via linked projects
  let generationCount = 0;
  if (projectIds.length > 0) {
    const generations = await db
      .select({ id: chapterGenerations.id })
      .from(chapterGenerations)
      .where(inArray(chapterGenerations.projectId, projectIds));
    generationCount = generations.length;
  }

  // 7. Source / historical metadata
  const pipelineRun = cleanActiveRun ?? pipelineRuns[0] ?? null;
  const hasCompletedRuns = pipelineRuns.some(
    (r) =>
      r.status === "clean" ||
      r.status === "quarantined" ||
      r.status === "failed",
  );

  return {
    templateId: template.id,
    templateName: template.name,
    classification,
    pipelineVersion: pipelineRun?.pipelineVersion ?? null,
    pipelineRunId: pipelineRun?.id ?? null,
    sourceFilesAvailable: pipelineRuns.length > 0,
    historicalExecutionRecoverable: hasCompletedRuns,
    chapterCount: templateChapters.length,
    derivedProjectIds: projectIds,
    projectCount: projectIds.length,
    generationCount,
    recommendedAction: ACTIONS[classification],
  };
}

// ---------------------------------------------------------------------------
// Bulk audit
// ---------------------------------------------------------------------------

export async function auditAllTemplates(): Promise<SafeAuditReport[]> {
  const templates = await db
    .select({ id: bookTemplates.id })
    .from(bookTemplates);

  return Promise.all(templates.map((t) => auditTemplate(t.id)));
}
