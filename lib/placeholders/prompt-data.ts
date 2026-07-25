/**
 * Type-safe JSON serializers for placeholder-fill marker values.
 *
 * These produce the marker values that get injected into the registry-hosted
 * placeholder-fill template via executeVersionedPrompt.
 */

import type { SearchResult } from "@/lib/ai/web-search";

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface PlaceholderContextInput {
  placeholderName: string;
  /** Narrative role of the placeholder — describes the pattern (abstract role), not the instance.
   *  Answers "what does the writer need this variable for?".
   *  Produced by the template-generator with semantic nullity (domain-agnostic). */
  function?: string | null;
  /** Project topic (from editorial brief or project.topic). Used as minimal domain signal. */
  projectTopic: string | null;
  /** Already-filled sibling placeholder definitions for consistency. */
  existingDefinitions: Record<string, string>;
}

export interface ResearchResultInput {
  ragContext?: string;
  sources?: SearchResult[];
  provider: string;
  evidenceQuery?: string;
  optionalEvidenceEmpty?: boolean;
  skipResearch?: boolean;
}

export interface ValidationFeedback {
  status: "initial" | "retry";
  reason?: string;
  hint?: string;
}

// ---------------------------------------------------------------------------
// Serializers
// ---------------------------------------------------------------------------

export function serializePlaceholderContext(input: PlaceholderContextInput): string {
  return JSON.stringify(input);
}

export function serializeResearchResults(input: ResearchResultInput): string {
  return JSON.stringify(input);
}

export function serializeValidationFeedback(input: ValidationFeedback): string {
  return JSON.stringify(input);
}
