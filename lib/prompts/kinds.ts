import type { PromptKind } from "@/lib/db/schema/prompt-registry";

export const CORE_PROMPT_KINDS = [
  "assembly-planner",
  "assembly",
  "critique",
  "corrector",
  "generation-system",
  "meta-template",
] as const satisfies readonly PromptKind[];

export const UTILITY_PROMPT_KINDS = [
  "title",
  "placeholder-fill",
  "editorial-brief-extractor",
] as const satisfies readonly PromptKind[];

export const KIND_LABELS: Record<PromptKind, string> = {
  "assembly-planner": "Planificador",
  assembly: "Ensamblaje",
  critique: "Crítica",
  corrector: "Corrector",
  "generation-system": "Sistema",
  "meta-template": "Meta-prompt",
  title: "Título",
  "placeholder-fill": "Placeholders",
  "editorial-brief-extractor": "Extractor editorial",
};

export const ALL_PROMPT_KINDS = [
  ...CORE_PROMPT_KINDS,
  ...UTILITY_PROMPT_KINDS,
] as const satisfies readonly PromptKind[];

const ALL = new Set<PromptKind>(ALL_PROMPT_KINDS);

export function parsePromptKind(value: string | null): PromptKind {
  return value && ALL.has(value as PromptKind) ? (value as PromptKind) : "generation-system";
}

export function isUtilityKind(kind: PromptKind): boolean {
  return (UTILITY_PROMPT_KINDS as readonly PromptKind[]).includes(kind);
}
