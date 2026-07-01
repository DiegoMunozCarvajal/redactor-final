export type AIProvider = "openai" | "anthropic" | "google" | "deepseek";

export const DEFAULT_GENERATION_MODEL = "deepseek-v4-pro";

export interface ModelDefinition {
  id: string;
  label: string;
  provider: AIProvider;
  /** Cost per million tokens */
  pricing: { input: number; output: number };
  /** Whether this model supports structured JSON output reliably */
  supportsStructuredOutput: boolean;
  /**
   * When set, temperature is locked to this value whenever reasoning/thinking
   * is active. undefined = temperature is freely configurable.
   */
  fixedTemperature?: number;
  /** Max tokens the model can produce in a single response */
  maxOutputTokens?: number;
}

/**
 * All models available for selection in the UI.
 * Grouped by provider for display.
 */
export const AVAILABLE_MODELS: ModelDefinition[] = [
  // OpenAI
  {
    id: "gpt-5.5",
    label: "GPT 5.5",
    provider: "openai",
    pricing: { input: 2.75, output: 16.5 },
    supportsStructuredOutput: true,
    fixedTemperature: 1,
    maxOutputTokens: 16384,
  },
  // Anthropic
  {
    id: "claude-opus-4-8",
    label: "Claude Opus 4.8",
    provider: "anthropic",
    pricing: { input: 15, output: 75 },
    supportsStructuredOutput: true,
    maxOutputTokens: 32768,
  },
  // DeepSeek
  {
    id: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    provider: "deepseek",
    pricing: { input: 1.74, output: 3.48 },
    supportsStructuredOutput: true,
    maxOutputTokens: 32768,
  },
];

const modelMap = new Map(AVAILABLE_MODELS.map((m) => [m.id, m]));

export function getModelDefinition(modelId: string): ModelDefinition | undefined {
  return modelMap.get(modelId);
}

export function requireModelDefinition(modelId: string): ModelDefinition {
  const definition = modelMap.get(modelId);
  if (!definition) {
    throw new Error(`Unknown model: "${modelId}"`);
  }

  return definition;
}

export function getProviderForModel(modelId: string): AIProvider {
  return requireModelDefinition(modelId).provider;
}

export function getModelPricing(modelId: string): { input: number; output: number } {
  const def = requireModelDefinition(modelId);
  return { input: def.pricing.input / 1_000_000, output: def.pricing.output / 1_000_000 };
}

/** Flat { id, label } list for UI dropdowns — derived from AVAILABLE_MODELS */
export const MODEL_OPTIONS = AVAILABLE_MODELS.map((m) => ({ id: m.id, label: m.label }));

/**
 * Models suitable for each pipeline stage.
 * Used to filter the UI dropdowns.
 */
export const MODELS_BY_STAGE = {
  book_plan: AVAILABLE_MODELS,
  unit_brief: AVAILABLE_MODELS,
  draft_small_book: AVAILABLE_MODELS,
  assemble_small_book_chapter: AVAILABLE_MODELS,
  draft_workbook: AVAILABLE_MODELS,
  critique_revise: AVAILABLE_MODELS,
  book_title: AVAILABLE_MODELS,
} as const;
