import { sha256Canonical, EMPTY_SOURCE_PROFILE_SET_HASH } from "./hash";
import {
  GenerationAuthorization,
  GenerationBlockedError,
  ORIGINALITY_POLICY_VERSION,
  SUPPORTED_GENERATION_PIPELINES,
} from "./contracts";
import { loadProjectPipeline } from "./repository";

export async function assertTemplateGenerationAllowed(
  projectId: string,
): Promise<GenerationAuthorization> {
  const state = await loadProjectPipeline(projectId);
  if (!state) throw new Error(`Project not found: ${projectId}`);

  if (!state.bookTemplateId) {
    return {
      scope: "source-free",
      pipelineRunId: null,
      sourceProfileSetHash: EMPTY_SOURCE_PROFILE_SET_HASH,
      originalityPolicyVersion: ORIGINALITY_POLICY_VERSION,
    };
  }

  if (state.templateStatus === "quarantined")
    throw new GenerationBlockedError("template_quarantined", projectId);
  if (state.templateStatus === "failed")
    throw new GenerationBlockedError("template_failed", projectId);
  if (!state.run || state.templateStatus !== "ready")
    throw new GenerationBlockedError("template_unverified", projectId);
  if (state.run.status !== "clean")
    throw new GenerationBlockedError("template_unverified", projectId);
  if (!SUPPORTED_GENERATION_PIPELINES.has(state.run.pipelineVersion))
    throw new GenerationBlockedError("unsupported_pipeline", projectId);
  if (state.run.originalityPolicyVersion !== ORIGINALITY_POLICY_VERSION)
    throw new GenerationBlockedError("unsupported_policy", projectId);
  // Profiles missing for a clean run → degraded mode (pre-persistence legacy run).
  // The downstream originality gate handles missing profiles gracefully by
  // throwing OriginalityDetectorUnavailableError, which all callers catch.
  // New pipeline runs persist profiles, so this edge case only applies to
  // runs that completed before profile persistence was implemented.
  if (state.profiles.length === 0 && state.run.status === "clean") {
    console.warn(
      `[authorization] Clean run ${state.run.id} has no source profiles — ` +
      `proceeding in degraded mode for project ${projectId}. ` +
      `Re-run the template pipeline to enable full originality protection.`,
    );
    return {
      scope: "template",
      pipelineRunId: state.run.id,
      sourceProfileSetHash: EMPTY_SOURCE_PROFILE_SET_HASH,
      originalityPolicyVersion: state.run.originalityPolicyVersion,
    };
  }

  if (state.profiles.length === 0)
    throw new GenerationBlockedError("missing_source_profile", projectId);

  const sourceProfileSetHash = sha256Canonical(
    state.profiles.map((p) => ({
      id: p.id,
      chapterId: p.chapterId,
      sourceHash: p.sourceHash,
    })),
  );

  return {
    scope: "template",
    pipelineRunId: state.run.id,
    sourceProfileSetHash,
    originalityPolicyVersion: state.run.originalityPolicyVersion,
  };
}
