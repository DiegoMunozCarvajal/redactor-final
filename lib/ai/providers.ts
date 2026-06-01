export type AIProvider = "openai" | "anthropic" | "google" | "deepseek";

export const DEFAULT_GENERATION_MODEL = "deepseek-v4-flash";

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
}

/**
 * All models available for selection in the UI.
 * Grouped by provider for display.
 */
export const AVAILABLE_MODELS: ModelDefinition[] = [
  // OpenAI
  {
    id: "gpt-5.4",
    label: "GPT 5.4",
    provider: "openai",
    pricing: { input: 2.5, output: 15 },
    supportsStructuredOutput: true,
    fixedTemperature: 1,
  },
  {
    id: "gpt-5.4-mini",
    label: "GPT 5.4 Mini",
    provider: "openai",
    pricing: { input: 0.75, output: 4.5 },
    supportsStructuredOutput: true,
    fixedTemperature: 1,
  },
  {
    id: "gpt-5.5",
    label: "GPT 5.5",
    provider: "openai",
    pricing: { input: 2.75, output: 16.5 },
    supportsStructuredOutput: true,
    fixedTemperature: 1,
  },
  {
    id: "gpt-5.5-mini",
    label: "GPT 5.5 Mini",
    provider: "openai",
    pricing: { input: 0.85, output: 5 },
    supportsStructuredOutput: true,
    fixedTemperature: 1,
  },
  // Anthropic
  {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    provider: "anthropic",
    pricing: { input: 1, output: 5 },
    supportsStructuredOutput: true,
  },
  {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    provider: "anthropic",
    pricing: { input: 3, output: 15 },
    supportsStructuredOutput: true,
  },
  {
    id: "claude-opus-4-6",
    label: "Claude Opus 4.6",
    provider: "anthropic",
    pricing: { input: 15, output: 75 },
    supportsStructuredOutput: true,
  },
  {
    id: "claude-opus-4-8",
    label: "Claude Opus 4.8",
    provider: "anthropic",
    pricing: { input: 15, output: 75 },
    supportsStructuredOutput: true,
  },
  {
    id: "claude-opus-4-7",
    label: "Claude Opus 4.7",
    provider: "anthropic",
    pricing: { input: 15, output: 75 },
    supportsStructuredOutput: true,
  },
  // Google
  {
    id: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    provider: "google",
    pricing: { input: 1.25, output: 10 },
    supportsStructuredOutput: true,
  },
  {
    id: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    provider: "google",
    pricing: { input: 0.15, output: 0.6 },
    supportsStructuredOutput: true,
  },
  // DeepSeek
  {
    id: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    provider: "deepseek",
    pricing: { input: 1.74, output: 3.48 },
    supportsStructuredOutput: true,
  },
  {
    id: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    provider: "deepseek",
    pricing: { input: 0.14, output: 0.28 },
    supportsStructuredOutput: true,
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

export const EFFORT_OPTIONS = [
  { value: "max", label: "Max" },
  { value: "off", label: "Apagado" },
] as const;

/**
 * Models suitable for each pipeline stage.
 * Used to filter the UI dropdowns.
 */
export const MODELS_BY_STAGE = {
  book_plan: AVAILABLE_MODELS.filter((m) =>
    ["claude-haiku-4-5", "gpt-5.5-mini", "gpt-5.5", "gpt-5.4-mini", "gpt-5.4", "gemini-2.5-flash", "gemini-2.5-pro", "deepseek-v4-flash", "deepseek-v4-pro"].includes(m.id),
  ),
  unit_brief: AVAILABLE_MODELS.filter((m) =>
    ["claude-haiku-4-5", "gpt-5.5-mini", "gpt-5.5", "gpt-5.4-mini", "gpt-5.4", "gemini-2.5-flash", "gemini-2.5-pro", "deepseek-v4-flash", "deepseek-v4-pro"].includes(m.id),
  ),
  draft_small_book: AVAILABLE_MODELS.filter((m) =>
    ["claude-opus-4-8", "claude-opus-4-7", "claude-sonnet-4-6", "gpt-5.5", "gpt-5.4", "gemini-2.5-pro", "deepseek-v4-flash", "deepseek-v4-pro"].includes(m.id)
  ),
  assemble_small_book_chapter: [
    requireModelDefinition("claude-opus-4-8"),
    requireModelDefinition("claude-opus-4-7"),
    requireModelDefinition("claude-sonnet-4-6"),
    requireModelDefinition("gpt-5.5"),
    requireModelDefinition("gpt-5.4"),
    requireModelDefinition("gemini-2.5-pro"),
    requireModelDefinition("deepseek-v4-flash"),
    requireModelDefinition("deepseek-v4-pro"),
  ],
  draft_workbook: AVAILABLE_MODELS.filter((m) =>
    ["claude-opus-4-8", "claude-opus-4-7", "claude-sonnet-4-6", "gpt-5.5", "gpt-5.4", "gemini-2.5-pro", "deepseek-v4-flash", "deepseek-v4-pro"].includes(m.id)
  ),
  critique_revise: AVAILABLE_MODELS.filter((m) =>
    ["claude-opus-4-8", "claude-opus-4-7", "claude-sonnet-4-6", "gpt-5.5", "gpt-5.5-mini", "gpt-5.4", "gpt-5.4-mini", "gemini-2.5-pro", "deepseek-v4-flash", "deepseek-v4-pro"].includes(m.id)
  ),
  book_title: AVAILABLE_MODELS.filter((m) =>
    ["claude-haiku-4-5", "gpt-5.5-mini", "gpt-5.5", "gpt-5.4-mini", "gpt-5.4", "gemini-2.5-flash", "gemini-2.5-pro", "deepseek-v4-flash", "deepseek-v4-pro"].includes(m.id),
  ),
} as const;
