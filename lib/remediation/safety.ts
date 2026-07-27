import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@/lib/db/schema";
import {
  projects,
  chapterGenerations,
  templatePipelineRuns,
} from "@/lib/db/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { COMPILER_VERSION } from "@/lib/template-pipeline/compiler";
import { SAFE_PIPELINE_VERSION } from "@/lib/template-pipeline/contracts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SafetyState = "source_free" | "clean_v2" | "legacy_read_only";

export interface ProjectSafety {
  state: SafetyState;
  replacementProjectId?: string;
}

// ---------------------------------------------------------------------------
// Shared safety classification
// ---------------------------------------------------------------------------

/**
 * Classify a project's safety state.
 *
 * Order of precedence:
 * 1. Superseded → legacy_read_only (with replacement)
 * 2. Generation metadata templateAuthorization → clean_v2 / source_free
 * 3. Fallback: template eligibility via bookTemplateId → clean_v2
 * 4. Otherwise → legacy_read_only
 *
 * The fallback (step 3) ensures cloned projects and source-free projects
 * that have no generation metadata yet are NOT misclassified as legacy.
 */
export async function computeProjectSafety(
  projectId: string,
  db_: PostgresJsDatabase<typeof schema>,
): Promise<ProjectSafety> {
  // 1. Check if another project supersedes this one
  const [supersedingProject] = await db_
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.supersedesProjectId, projectId))
    .limit(1);

  if (supersedingProject) {
    return { state: "legacy_read_only", replacementProjectId: supersedingProject.id };
  }

  // 2. Check latest generation metadata for templateAuthorization
  const [genWithAuth] = await db_
    .select({ generationMetadata: chapterGenerations.generationMetadata })
    .from(chapterGenerations)
    .where(
      and(
        eq(chapterGenerations.projectId, projectId),
        sql`${chapterGenerations.generationMetadata}->'templateAuthorization' IS NOT NULL`,
      ),
    )
    .orderBy(desc(chapterGenerations.createdAt))
    .limit(1);

  if (genWithAuth?.generationMetadata) {
    const auth = genWithAuth.generationMetadata.templateAuthorization;
    if (auth?.scope === "template" && auth?.pipelineRunId) {
      return { state: "clean_v2" };
    }
    if (auth?.scope === "source-free") {
      return { state: "source_free" };
    }
  }

  // 3. Fallback: no generation metadata → check template eligibility.
  //    Cloned projects and source-free projects that haven't generated yet
  //    must NOT be classified as legacy_read_only.
  const [project] = await db_
    .select({ bookTemplateId: projects.bookTemplateId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (project?.bookTemplateId) {
    const [eligibleRun] = await db_
      .select({ id: templatePipelineRuns.id })
      .from(templatePipelineRuns)
      .where(
        and(
          eq(templatePipelineRuns.bookTemplateId, project.bookTemplateId),
          eq(templatePipelineRuns.status, "clean"),
          eq(templatePipelineRuns.compilerVersion, COMPILER_VERSION),
          eq(templatePipelineRuns.pipelineVersion, SAFE_PIPELINE_VERSION),
        ),
      )
      .orderBy(desc(templatePipelineRuns.createdAt))
      .limit(1);

    if (eligibleRun) {
      return { state: "clean_v2" };
    }
  }

  // 4. Default: legacy
  return { state: "legacy_read_only" };
}
