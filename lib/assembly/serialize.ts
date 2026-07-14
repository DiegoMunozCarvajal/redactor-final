import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { AssemblyPlanV1 } from './plan-schema';

// ---------------------------------------------------------------------------
// Fragment XML serialization
// ---------------------------------------------------------------------------

export interface AssemblyFragmentInput {
  id: string;
  title: string;
  content: string;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function serializeAssemblyFragments(fragments: AssemblyFragmentInput[]): string {
  if (fragments.length === 0) {
    return '<fragments>\n</fragments>';
  }
  const items = fragments.map((f) =>
    `  <fragment id="${esc(f.id)}" title="${esc(f.title)}">\n${esc(f.content)}\n  </fragment>`,
  );
  return `<fragments>\n${items.join('\n')}\n</fragments>`;
}

// ---------------------------------------------------------------------------
// Plan JSON serialization
// ---------------------------------------------------------------------------

export function serializeAssemblyPlan(plan: AssemblyPlanV1): string {
  return JSON.stringify(plan);
}

// ---------------------------------------------------------------------------
// Output schema serialization (JSON Schema via zod-to-json-schema)
// ---------------------------------------------------------------------------

export function serializeOutputSchema(schema: z.ZodTypeAny): string {
  const jsonSchema = zodToJsonSchema(schema, { target: 'openApi3', $refStrategy: 'none' });
  return JSON.stringify(jsonSchema, null, 2);
}
