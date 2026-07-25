import { z } from 'zod';
import type { PromptKind } from '@/lib/db/schema/prompt-registry';

export const RUNTIME_MARKER_RE = /\{\{[A-Z][A-Z0-9_]*\}\}/g;

export const requiredMarkersByKind: Record<PromptKind, readonly string[]> = {
  'generation-system': ['{{EDITORIAL_CONTEXT}}'],
  'rhetoric-trace': ['{{CAPITULO_FUENTE}}', '{{OUTPUT_SCHEMA}}'],
  'template-generator': ['{{RHETORIC_TRACE}}', '{{OUTPUT_SCHEMA}}'],
  'assembly-planner': ['{{EDITORIAL_CONTEXT}}', '{{SECCIONES_GENERADAS}}', '{{OUTPUT_SCHEMA}}'],
  assembly: ['{{EDITORIAL_CONTEXT}}', '{{ASSEMBLY_PLAN}}', '{{SECCIONES_GENERADAS}}'],
  critique: ['{{EDITORIAL_CONTEXT}}', '{{CONTENIDO_CAPITULO}}'],
  corrector: ['{{EDITORIAL_CONTEXT}}', '{{CONTENIDO_CAPITULO}}', '{{CONTENIDO_CRITICA}}'],
  title: ['{{EDITORIAL_CONTEXT}}', '{{PROJECT_TOPIC}}', '{{OUTPUT_SCHEMA}}'],
  'placeholder-fill': [
    '{{EDITORIAL_CONTEXT}}',
    '{{PLACEHOLDER_CONTEXT}}',
    '{{RESEARCH_RESULTS}}',
    '{{VALIDATION_FEEDBACK}}',
    '{{OUTPUT_SCHEMA}}',
  ],
  'editorial-brief-extractor': [
    '{{PROJECT_TOPIC}}',
    '{{CHAPTER_CONTEXT}}',
    '{{RESEARCH_DOCUMENT}}',
    '{{OUTPUT_SCHEMA}}',
  ],
  'source-risk-profiler': [
    '{{CAPITULO_FUENTE}}',
    '{{OUTPUT_SCHEMA}}',
  ],
};

export const promptRevisionInputSchema = z.object({
  versionLabel: z.string().trim().min(1).max(80),
  systemTemplate: z.string().max(100_000),
  userTemplate: z.string().max(100_000),
  outputContract: z.string().trim().max(120).nullable().optional(),
  configuration: z.record(z.unknown()).default({}),
});

export function assertPromptMarkers(kind: PromptKind, system: string, user: string): string[] {
  const text = `${system}\n${user}`;
  const found = [...new Set(text.match(RUNTIME_MARKER_RE) ?? [])];
  for (const required of requiredMarkersByKind[kind]) {
    if (!found.includes(required))
      throw new Error(`Missing required marker ${required} for ${kind}`);
  }
  const allowed = new Set(requiredMarkersByKind[kind]);
  for (const marker of found) {
    if (!allowed.has(marker)) throw new Error(`Unknown runtime marker ${marker} for ${kind}`);
  }
  return found;
}
