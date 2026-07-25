import {
  ORIGINALITY_POLICY_VERSION,
  SUPPORTED_GENERATION_PIPELINES,
} from "./contracts";

export interface TemplateEligibilityInput {
  templateStatus: string;
  activeRunId: string | null;
  runStatus: string | null;
  pipelineVersion: string | null;
  originalityPolicyVersion: string | null;
}

export function isTemplateEligible(input: TemplateEligibilityInput): boolean {
  return (
    input.templateStatus === "ready" &&
    input.activeRunId !== null &&
    input.runStatus === "clean" &&
    input.pipelineVersion !== null &&
    SUPPORTED_GENERATION_PIPELINES.has(input.pipelineVersion) &&
    input.originalityPolicyVersion === ORIGINALITY_POLICY_VERSION
  );
}
