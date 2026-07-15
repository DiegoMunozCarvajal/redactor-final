import { z } from "zod";
import { executeVersionedPrompt } from "@/lib/prompts/executor";
import { serializePromptText } from "@/lib/prompts/placeholder-transform";
import { DEFAULT_GENERATION_MODEL } from "@/lib/ai/providers";
import type { ReasoningEffort } from "@/lib/ai/completion";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const titleOutputSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GenerateTitleInput {
  projectId: string;
  editorialContext: string;
  projectTopic: string;
  model?: string;
  effort?: ReasoningEffort;
  signal?: AbortSignal;
}

export interface GenerateTitleResult {
  title: string;
  subtitle: string;
  executionId: string;
  revisionId: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a book title and optional subtitle using the registry-hosted
 * "title" prompt kind.
 *
 * Resolves the active title prompt revision via project-level binding or
 * global default, composes it with editorial context and project topic,
 * and returns structured output through executeVersionedPrompt.
 */
export async function generateTitle(
  input: GenerateTitleInput,
): Promise<GenerateTitleResult> {
  const {
    projectId,
    editorialContext,
    projectTopic,
    model = DEFAULT_GENERATION_MODEL,
    effort,
    signal,
  } = input;

  const { result, executionId, revision } = await executeVersionedPrompt({
    stage: "title",
    kind: "title",
    projectId,
    markerValues: {
      "{{EDITORIAL_CONTEXT}}": editorialContext,
      "{{PROJECT_TOPIC}}": serializePromptText(projectTopic),
      "{{OUTPUT_SCHEMA}}":
        '{"title": "string (requerido)", "subtitle": "string (opcional)"}',
    },
    model,
    schema: titleOutputSchema,
    effort,
    signal,
  });

  return {
    title: result.data.title,
    subtitle: result.data.subtitle ?? "",
    executionId,
    revisionId: revision.id,
  };
}
