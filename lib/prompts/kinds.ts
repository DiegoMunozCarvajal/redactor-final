import type { PromptKind } from "@/lib/db/schema/prompt-registry";

export const CORE_PROMPT_KINDS = [
  "editorial-brief-extractor",
  "rhetoric-trace",
  "template-generator",
  "source-risk-profiler",
  "source-leakage-review",
  "placeholder-fill",
  "generation-system",
  "assembly-planner",
  "assembly",
  "title",
  "critique",
  "corrector",
] as const satisfies readonly PromptKind[];

export const UTILITY_PROMPT_KINDS = [] as const satisfies readonly PromptKind[];

export const KIND_LABELS: Record<PromptKind, string> = {
  "assembly-planner": "Planificador",
  assembly: "Ensamblaje",
  critique: "Crítica",
  corrector: "Corrector",
  "generation-system": "Sistema",
  "rhetoric-trace": "Traza retórica",
  "template-generator": "Generador de templates",
  title: "Título",
  "placeholder-fill": "Placeholders",
  "editorial-brief-extractor": "Extractor editorial",
  "source-risk-profiler": "Perfil de riesgo de fuente",
  "source-leakage-review": "Revisor de fuga de fuente",
};

export const ALL_PROMPT_KINDS = [
  ...CORE_PROMPT_KINDS,
  ...UTILITY_PROMPT_KINDS,
] as const satisfies readonly PromptKind[];

const ALL = new Set<PromptKind>(ALL_PROMPT_KINDS);

export function parsePromptKind(value: string | null): PromptKind {
  return value && ALL.has(value as PromptKind) ? (value as PromptKind) : ALL_PROMPT_KINDS[0];
}

export function isUtilityKind(kind: PromptKind): boolean {
  return (UTILITY_PROMPT_KINDS as readonly PromptKind[]).includes(kind);
}
