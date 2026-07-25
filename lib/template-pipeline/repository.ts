import { db } from "@/lib/db/drizzle";
import {
  bookTemplates,
  templatePipelineRuns,
  templateSourceProfiles,
  projects,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export interface PipelineProjection {
  projectId: string;
  bookTemplateId: string | null;
  templateStatus?: string;
  run: {
    id: string;
    status: string;
    pipelineVersion: string;
    originalityPolicyVersion: string;
  } | null;
  profiles: Array<{
    id: string;
    chapterId: string;
    sourceHash: string;
  }>;
}

export async function loadProjectPipeline(
  projectId: string,
): Promise<PipelineProjection | null> {
  const [project] = await db
    .select({ bookTemplateId: projects.bookTemplateId })
    .from(projects)
    .where(eq(projects.id, projectId));

  if (!project) return null;

  // Source-free project
  if (!project.bookTemplateId) {
    return { projectId, bookTemplateId: null, run: null, profiles: [] };
  }

  // Load template + active run joined by active_pipeline_run_id
  const [template] = await db
    .select({
      bookTemplateId: bookTemplates.id,
      templateStatus: bookTemplates.status,
      runId: templatePipelineRuns.id,
      runStatus: templatePipelineRuns.status,
      pipelineVersion: templatePipelineRuns.pipelineVersion,
      originalityPolicyVersion:
        templatePipelineRuns.originalityPolicyVersion,
    })
    .from(bookTemplates)
    .leftJoin(
      templatePipelineRuns,
      and(
        eq(bookTemplates.activePipelineRunId, templatePipelineRuns.id),
        eq(templatePipelineRuns.bookTemplateId, bookTemplates.id),
      ),
    )
    .where(eq(bookTemplates.id, project.bookTemplateId));

  if (!template) {
    return { projectId, bookTemplateId: project.bookTemplateId, run: null, profiles: [] };
  }

  // Load profiles only when run exists
  let profiles: PipelineProjection["profiles"] = [];
  if (template.runId) {
    profiles = await db
      .select({
        id: templateSourceProfiles.id,
        chapterId: templateSourceProfiles.chapterId,
        sourceHash: templateSourceProfiles.sourceHash,
      })
      .from(templateSourceProfiles)
      .where(eq(templateSourceProfiles.pipelineRunId, template.runId))
      .orderBy(templateSourceProfiles.chapterId);
  }

  return {
    projectId,
    bookTemplateId: project.bookTemplateId,
    templateStatus: template.templateStatus,
    run: template.runId
      ? {
          id: template.runId,
          status: template.runStatus!,
          pipelineVersion: template.pipelineVersion!,
          originalityPolicyVersion: template.originalityPolicyVersion!,
        }
      : null,
    profiles,
  };
}
