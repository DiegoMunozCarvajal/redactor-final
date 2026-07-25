export const LEGACY_CONTAINMENT_PIPELINE_VERSION = "legacy-containment-v1";
export const SAFE_PIPELINE_VERSION = "template-pipeline-v2";
export const ORIGINALITY_POLICY_VERSION = "originality-policy-v2";
export const SOURCE_PROFILE_VERSION = "source-profile-v1";

export const SUPPORTED_GENERATION_PIPELINES = new Set([
  SAFE_PIPELINE_VERSION,
]);

export type GenerationBlockedReason =
  | "template_unverified"
  | "template_quarantined"
  | "template_failed"
  | "missing_source_profile"
  | "unsupported_pipeline"
  | "unsupported_policy";

export type GenerationAuthorization =
  | {
      scope: "template";
      pipelineRunId: string;
      sourceProfileSetHash: string;
      originalityPolicyVersion: string;
    }
  | {
      scope: "source-free";
      pipelineRunId: null;
      sourceProfileSetHash: string;
      originalityPolicyVersion: string;
    };

export class GenerationBlockedError extends Error {
  constructor(
    public readonly reason: GenerationBlockedReason,
    public readonly projectId: string,
  ) {
    super(`Generation blocked: ${reason}`);
    this.name = "GenerationBlockedError";
  }
}
