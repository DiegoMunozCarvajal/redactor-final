import {
  assertOriginalEnough,
  OriginalityError,
} from "@/lib/ai/originality-check";
import type { PipelineStage } from "@/lib/ai/originality-check";

// ---------------------------------------------------------------------------
// Field flattening for exhaustive template scanning
// ---------------------------------------------------------------------------

export interface TemplateField {
  path: string;
  value: string;
}

export interface TemplateBlockLike {
  name: string;
  content: string;
  userPrompt: string;
  function?: string | null;
  sourceContext?: string | null;
  notes?: string | null;
  placeholders: Array<{
    name: string;
    function: string;
  }>;
}

export function collectTemplateFields(
  blocks: TemplateBlockLike[],
): TemplateField[] {
  return blocks.flatMap((block, blockIndex) => {
    const prefix = `templates[${blockIndex}]`;
    const fields: TemplateField[] = [
      { path: `${prefix}.name`, value: block.name },
      { path: `${prefix}.content`, value: block.content },
      { path: `${prefix}.userPrompt`, value: block.userPrompt },
    ];
    for (const key of ["function", "sourceContext", "notes"] as const) {
      if (block[key]) {
        fields.push({ path: `${prefix}.${key}`, value: block[key]! });
      }
    }
    block.placeholders.forEach((placeholder, index) => {
      fields.push(
        {
          path: `${prefix}.placeholders[${index}].name`,
          value: placeholder.name,
        },
        {
          path: `${prefix}.placeholders[${index}].function`,
          value: placeholder.function,
        },
      );
    });
    return fields;
  });
}

// ---------------------------------------------------------------------------
// Fail-closed template scan
// ---------------------------------------------------------------------------

export function assertTemplateFieldsClean(
  blocks: TemplateBlockLike[],
): void {
  const stage: PipelineStage = "metaprompt-block";
  for (const field of collectTemplateFields(blocks)) {
    assertOriginalEnough(field.value, {
      stage,
      throwOnFail: true,
    });
  }
}

// ---------------------------------------------------------------------------
// Safe report helpers
// ---------------------------------------------------------------------------

export interface SafeOriginalityReport {
  fieldPath: string;
  signalId: string;
  score: number;
  blocklistHits: string[];
}

export function toSafeOriginalityReport(
  error: OriginalityError,
): SafeOriginalityReport[] {
  // Extract only hash/signal metadata, never candidate prose or source text.
  return [
    {
      fieldPath: "unknown",
      signalId: error.result.blocklistHits.join(",") || "containment",
      score: error.result.shingleSimilarity,
      blocklistHits: error.result.blocklistHits,
    },
  ];
}
