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
  function: string | null | undefined;
  notes: string | null | undefined;
  projectTopic: string | null;
  promptContents: string[];
  sourceContexts?: string[];
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
