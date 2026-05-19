import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { getOpenAIClient } from "./clients/openai";
import { getAnthropicClient } from "./clients/anthropic";
import { getGoogleClient } from "./clients/google";
import { getDeepSeekClient } from "./clients/deepseek";
import { aiJsonSafeParse } from "ai-json-safe-parse";
import OpenAI from "openai";
import { getModelPricing, getProviderForModel, requireModelDefinition } from "./providers";
type TrackedStage = string;

const STAGE_TIMEOUT_MS = 300_000; // 5 minutes

type ProviderResult<T> = {
  data: T;
  promptTokens: number;
  completionTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
};

type ProviderUsage = Omit<ProviderResult<unknown>, "data">;

export class ProviderCallError extends Error {
  usage?: ProviderUsage;

  constructor(message: string, usage?: ProviderUsage, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ProviderCallError";
    this.usage = usage;
  }
}

export type ReasoningEffort = "off" | "minimal" | "low" | "medium" | "high" | "max";

export interface CompletionOptions<T extends z.ZodType> {
  cachedSystemPrompt?: string;
  systemPrompt: string;
  userPrompt: string;
  schema?: T;
  model: string;
  temperature?: number;
  maxTokens?: number;
  effort?: ReasoningEffort;
  /** When true and the provider is Anthropic, sends the system prompt as a cacheable content block */
  cacheSystemPrompt?: boolean;
  /** If provided, records a run_logs row for this call */
  tracking?: {
    runId: string;
    stage: TrackedStage;
    unitId?: string;
  };
}

function joinSystemPrompts(...blocks: Array<string | undefined>): string {
  return blocks
    .map((block) => block?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n");
}

function buildAnthropicSystemPrompt(
  cachedSystemPrompt: string | undefined,
  systemPrompt: string,
  cacheSystemPrompt?: boolean,
):
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "text"; text: string; cache_control: { type: "ephemeral" } }
    > {
  const normalizedCachedPrompt = cachedSystemPrompt?.trim() ?? "";
  const normalizedSystemPrompt = systemPrompt.trim();

  if (cacheSystemPrompt && normalizedCachedPrompt) {
    const promptBlocks: Array<
      | { type: "text"; text: string }
      | { type: "text"; text: string; cache_control: { type: "ephemeral" } }
    > = [
      {
        type: "text",
        text: normalizedCachedPrompt,
        cache_control: { type: "ephemeral" },
      },
    ];

    if (normalizedSystemPrompt) {
      promptBlocks.push({
        type: "text",
        text: normalizedSystemPrompt,
      });
    }

    return promptBlocks;
  }

  return joinSystemPrompts(normalizedCachedPrompt, normalizedSystemPrompt);
}

export interface CompletionResult<T> {
  data: T;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
  };
  durationMs: number;
  logId?: string;
}

/**
 * Strips JSON Schema keywords that Anthropic's structured output rejects.
 * Anthropic only supports: type, properties, required, items, enum, description.
 * Everything else (minLength, maxLength, minimum, maximum, pattern, etc.)
 * must be removed or moved to description before sending.
 * Mirrors what @anthropic-ai/sdk's zodOutputFormat helper does internally.
 */
const ANTHROPIC_UNSUPPORTED = new Set([
  "$schema", "$ref", "$defs", "$comment",
  "exclusiveMinimum", "exclusiveMaximum",
  "minimum", "maximum", "multipleOf",
  "minLength", "maxLength", "pattern", "format",
  "minItems", "maxItems", "uniqueItems",
  "minProperties", "maxProperties",
  "nullable",
  "default", "examples", "const",
  "oneOf", "anyOf", "allOf", "not",
]);

function sanitizeForAnthropic(schema: Record<string, unknown>): Record<string, unknown> {
  if (typeof schema !== "object" || schema === null) return schema;

  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (ANTHROPIC_UNSUPPORTED.has(key)) continue;

    if (key === "properties" && typeof value === "object" && value !== null) {
      cleaned[key] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [
          k,
          sanitizeForAnthropic(v as Record<string, unknown>),
        ]),
      );
    } else if (key === "items" && typeof value === "object" && value !== null) {
      cleaned[key] = sanitizeForAnthropic(value as Record<string, unknown>);
    } else {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

/**
 * Transforms a JSON schema to be compatible with OpenAI strict mode:
 * - Adds `additionalProperties: false` to every object
 * - Ensures every property key appears in `required`
 * - Converts OpenAPI-style `nullable: true` to `anyOf: [{type}, {type: "null"}]`
 * - Recurses into nested objects, arrays, and composition keywords
 */
function makeOpenAIStrictSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (typeof schema !== "object" || schema === null) return schema;

  const result = { ...schema };

  // Convert OpenAPI nullable: true to anyOf with null
  if (result.nullable === true) {
    const { nullable: _n, ...rest } = result;
    void _n;
    const base = makeOpenAIStrictSchema(rest);
    return { anyOf: [base, { type: "null" }] };
  }

  if (result.type === "object" && result.properties) {
    result.additionalProperties = false;
    const propKeys = Object.keys(result.properties as Record<string, unknown>);
    result.required = propKeys;
    result.properties = Object.fromEntries(
      Object.entries(result.properties as Record<string, unknown>).map(([k, v]) => [
        k,
        makeOpenAIStrictSchema(v as Record<string, unknown>),
      ])
    );
  }

  if (result.type === "array" && result.items) {
    result.items = makeOpenAIStrictSchema(result.items as Record<string, unknown>);
  }

  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    if (Array.isArray(result[key])) {
      result[key] = (result[key] as Record<string, unknown>[]).map((s) =>
        makeOpenAIStrictSchema(s)
      );
    }
  }

  return result;
}

function normalizePlainTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (
          typeof part === "object" &&
          part !== null &&
          "type" in part &&
          (part as { type?: unknown }).type === "text" &&
          "text" in part &&
          typeof (part as { text?: unknown }).text === "string"
        ) {
          return (part as { text: string }).text;
        }

        if (
          typeof part === "object" &&
          part !== null &&
          "type" in part &&
          (part as { type?: string }).type === "refusal"
        ) {
          return ""; // Content filter refusal — handled at call site via finish_reason
        }

        console.warn("[normalizePlainTextContent] unrecognized part type", {
          type: (part as { type?: string }).type,
        });
        return "";
      })
      .join("");
  }

  return "";
}

function getCompletionCostUsd(model: string, usage: ProviderUsage): number {
  const pricing = getModelPricing(model);
  const inputCost = usage.promptTokens * pricing.input;
  const outputCost = usage.completionTokens * pricing.output;

  if (getProviderForModel(model) !== "anthropic") {
    return inputCost + outputCost;
  }

  const cacheCreationCost = usage.cacheCreationTokens * pricing.input * 1.25;
  const cacheReadCost = usage.cacheReadTokens * pricing.input * 0.1;
  return inputCost + outputCost + cacheCreationCost + cacheReadCost;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

// ---------------------------------------------------------------------------
// Provider-specific completion handlers
// ---------------------------------------------------------------------------

const OPENAI_FIXED_TEMPERATURE_MODELS = new Set(["o1", "o1-mini", "o3", "o3-mini", "o4-mini"]);

// ---------------------------------------------------------------------------
// Reasoning effort → provider-specific mappings
// ---------------------------------------------------------------------------

type EffortConfig =
  | { kind: "deepseek"; thinkingDisabled: true }
  | { kind: "deepseek"; thinkingDisabled: false; reasoningEffort: "high" | "max" }
  | { kind: "openai"; reasoningEffort?: "minimal" | "low" | "medium" | "high" }
  | { kind: "anthropic"; budgetTokens?: number }
  | { kind: "google"; thinkingBudget?: number };

function mapEffort(effort: ReasoningEffort | undefined, provider: string): EffortConfig {
  switch (provider) {
    case "deepseek": {
      if (!effort || effort === "off") return { kind: "deepseek", thinkingDisabled: true };
      // DeepSeek only has "high" and "max". Map minimal/low/medium → high
      const reasoningEffort = effort === "max" ? "max" : "high";
      return { kind: "deepseek", thinkingDisabled: false, reasoningEffort };
    }
    case "openai": {
      if (!effort || effort === "off") return { kind: "openai" };
      // OpenAI doesn't have "max" — map to "high"
      const level = effort === "max" ? "high" : effort;
      return { kind: "openai", reasoningEffort: level as "minimal" | "low" | "medium" | "high" };
    }
    case "anthropic": {
      if (!effort || effort === "off") return { kind: "anthropic" };
      const budgetMap: Record<string, number> = {
        minimal: 1024, low: 4096, medium: 8192, high: 16000, max: 16000,
      };
      return { kind: "anthropic", budgetTokens: budgetMap[effort] ?? 16000 };
    }
    case "google": {
      if (!effort || effort === "off") return { kind: "google" };
      const budgetMap: Record<string, number> = {
        minimal: 512, low: 2048, medium: 4096, high: 8192, max: 8192,
      };
      return { kind: "google", thinkingBudget: budgetMap[effort] ?? 8192 };
    }
    default:
      return { kind: "openai" };
  }
}

async function completeWithOpenAI<T extends z.ZodType>(
  messages: Array<{ role: "system" | "user"; content: string }>,
  model: string,
  temperature: number,
  maxTokens: number | undefined,
  schema: T | undefined,
  effortConfig: EffortConfig & { kind: "openai" },
  client?: OpenAI,
): Promise<ProviderResult<z.infer<T>>> {
  const openaiClient = client ?? getOpenAIClient();
  const modelDef = requireModelDefinition(model);
  const supportsTemperature = !OPENAI_FIXED_TEMPERATURE_MODELS.has(model);

  // Reasoning models (GPT-5.x) only support temperature=1 when reasoning_effort is active.
  // GPT-5.5 defaults to medium reasoning, GPT-5.4 defaults to none.
  // If the model has a fixedTemperature and reasoning is active, lock to that value.
  const reasoningActive = !!effortConfig.reasoningEffort;
  const effectiveTemperature = reasoningActive && modelDef.fixedTemperature !== undefined
    ? modelDef.fixedTemperature
    : temperature;

  if (schema) {
    const rawSchema = zodToJsonSchema(schema, {
      target: "openApi3",
      $refStrategy: "none",
    });
    const jsonSchema = makeOpenAIStrictSchema(rawSchema as Record<string, unknown>);

    const response = await openaiClient.chat.completions.create({
      model,
      ...(supportsTemperature ? { temperature: effectiveTemperature } : {}),
      max_completion_tokens: maxTokens,
      messages,
      ...(reasoningActive
        ? { reasoning_effort: effortConfig.reasoningEffort } as Record<string, unknown>
        : {}),
      response_format: {
        type: "json_schema" as const,
        json_schema: {
          name: "response",
          strict: true,
          schema: jsonSchema as Record<string, unknown>,
        },
      },
    }, { signal: AbortSignal.timeout(STAGE_TIMEOUT_MS) });

    const promptTokens = response.usage?.prompt_tokens ?? 0;
    const completionTokens = response.usage?.completion_tokens ?? 0;
    const content = response.choices[0].message.content ?? "";

    try {
      return {
        data: schema.parse(JSON.parse(content)),
        promptTokens,
        completionTokens,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      };
    } catch (parseError) {
      const usage: ProviderUsage = { promptTokens, completionTokens, cacheCreationTokens: 0, cacheReadTokens: 0 };
      const finishReason = response.choices[0].finish_reason;
      if (parseError instanceof SyntaxError) {
        throw new ProviderCallError(
          finishReason === "length"
            ? "The model output was truncated before it finished valid JSON. Increase max completion tokens for this call."
            : "The model returned invalid structured JSON. Retry the request or simplify the prompt.",
          usage,
          { cause: parseError },
        );
      }
      throw new ProviderCallError(getErrorMessage(parseError), usage, { cause: parseError });
    }
  } else {
    const response = await openaiClient.chat.completions.create({
      model,
      ...(supportsTemperature ? { temperature: effectiveTemperature } : {}),
      max_completion_tokens: maxTokens,
      messages,
      ...(reasoningActive
        ? { reasoning_effort: effortConfig.reasoningEffort } as Record<string, unknown>
        : {}),
    }, { signal: AbortSignal.timeout(STAGE_TIMEOUT_MS) });

    const promptTokens = response.usage?.prompt_tokens ?? 0;
    const completionTokens = response.usage?.completion_tokens ?? 0;
    const choice = response.choices[0];
    if (!choice) throw new Error("OpenAI returned empty choices array");
    const content = normalizePlainTextContent(choice.message.content);

    if (!content.trim() && choice.finish_reason === "content_filter") {
      throw new Error(
        "OpenAI returned a content filter refusal. The prompt or generated text triggered the safety filter."
      );
    }

    if (!content.trim() && choice.finish_reason === "length") {
      throw new Error(
        "The model output hit the token limit before it produced usable visible text. Increase max completion tokens for this call."
      );
    }

    return {
      data: content as z.infer<T>,
      promptTokens,
      completionTokens,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    };
  }
}

async function completeWithAnthropic<T extends z.ZodType>(
  cachedSystemPrompt: string | undefined,
  systemPrompt: string,
  userPrompt: string,
  model: string,
  temperature: number,
  maxTokens: number | undefined,
  schema: T | undefined,
  effortConfig: EffortConfig & { kind: "anthropic" },
  cacheSystemPrompt?: boolean,
): Promise<ProviderResult<z.infer<T>>> {
  const client = getAnthropicClient();
  const systemParam = buildAnthropicSystemPrompt(
    cachedSystemPrompt,
    systemPrompt,
    cacheSystemPrompt,
  );

  if (schema) {
    // Use tool_use for structured output. Anthropic rejects many JSON Schema
    // keywords — sanitize first to avoid 400 errors.
    const rawSchema = zodToJsonSchema(schema, {
      target: "openApi3",
      $refStrategy: "none",
    });
    const jsonSchema = sanitizeForAnthropic(rawSchema as Record<string, unknown>);

    const response = await client.messages.create({
      model,
      max_tokens: maxTokens ?? 4096,
      temperature,
      system: systemParam,
      messages: [{ role: "user" as const, content: userPrompt }],
      ...(effortConfig.budgetTokens
        ? { thinking: { type: "enabled" as const, budget_tokens: effortConfig.budgetTokens } }
        : {}),
      tools: [
        {
          name: "respond",
          description: "Return the structured response",
          input_schema: {
            type: "object" as const,
            ...(jsonSchema as Record<string, unknown>),
          },
        },
      ],
      tool_choice: { type: "tool" as const, name: "respond" },
    }, { signal: AbortSignal.timeout(STAGE_TIMEOUT_MS) });

    const promptTokens = response.usage?.input_tokens ?? 0;
    const completionTokens = response.usage?.output_tokens ?? 0;
    const cacheCreationTokens = response.usage?.cache_creation_input_tokens ?? 0;
    const cacheReadTokens = response.usage?.cache_read_input_tokens ?? 0;
    const usage: ProviderUsage = { promptTokens, completionTokens, cacheCreationTokens, cacheReadTokens };

    const toolBlock = response.content.find((b) => b.type === "tool_use");
    if (!toolBlock || toolBlock.type !== "tool_use") {
      throw new ProviderCallError(
        "Anthropic model did not return structured tool_use output.",
        usage,
      );
    }
    try {
      const data = schema.parse(toolBlock.input);
      return { data, promptTokens, completionTokens, cacheCreationTokens, cacheReadTokens };
    } catch (parseError) {
      throw new ProviderCallError(getErrorMessage(parseError), usage, { cause: parseError });
    }
  } else {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens ?? 4096,
      temperature,
      system: systemParam,
      messages: [{ role: "user" as const, content: userPrompt }],
      ...(effortConfig.budgetTokens
        ? { thinking: { type: "enabled" as const, budget_tokens: effortConfig.budgetTokens } }
        : {}),
    }, { signal: AbortSignal.timeout(STAGE_TIMEOUT_MS) });

    const promptTokens = response.usage?.input_tokens ?? 0;
    const completionTokens = response.usage?.output_tokens ?? 0;
    const cacheCreationTokens = response.usage?.cache_creation_input_tokens ?? 0;
    const cacheReadTokens = response.usage?.cache_read_input_tokens ?? 0;

    const textBlock = response.content.find((b) => b.type === "text");
    const content = textBlock && textBlock.type === "text" ? textBlock.text : "";

    if (!content.trim() && response.stop_reason === "max_tokens") {
      throw new Error(
        "The model output hit the token limit before it produced usable visible text. Increase max completion tokens for this call."
      );
    }

    return {
      data: content as z.infer<T>,
      promptTokens,
      completionTokens,
      cacheCreationTokens,
      cacheReadTokens,
    };
  }
}

async function completeWithGoogle<T extends z.ZodType>(
  messages: Array<{ role: "system" | "user"; content: string }>,
  model: string,
  temperature: number,
  maxTokens: number | undefined,
  schema: T | undefined,
  effortConfig: EffortConfig & { kind: "google" },
): Promise<ProviderResult<z.infer<T>>> {
  const client = getGoogleClient();
  const systemPrompt = messages.find((m) => m.role === "system")?.content ?? "";
  const userContent = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n\n");

  if (schema) {
    const jsonSchema = zodToJsonSchema(schema, {
      target: "openApi3",
      $refStrategy: "none",
    });

    const response = await client.models.generateContent({
      model,
      contents: userContent,
      config: {
        systemInstruction: systemPrompt,
        temperature,
        maxOutputTokens: maxTokens,
        responseMimeType: "application/json",
        responseSchema: jsonSchema as Record<string, unknown>,
        ...(effortConfig.thinkingBudget
          ? { thinkingConfig: { thinkingBudget: effortConfig.thinkingBudget } }
          : {}),
      },
    });

    const promptTokens = response.usageMetadata?.promptTokenCount ?? 0;
    const completionTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
    const content = response.text ?? "";

    const usage: ProviderUsage = { promptTokens, completionTokens, cacheCreationTokens: 0, cacheReadTokens: 0 };

    try {
      return {
        data: schema.parse(JSON.parse(content)),
        promptTokens,
        completionTokens,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      };
    } catch (parseError) {
      if (parseError instanceof SyntaxError) {
        throw new ProviderCallError(
          "Google model returned invalid structured JSON. Retry the request or simplify the prompt.",
          usage,
          { cause: parseError },
        );
      }
      throw new ProviderCallError(getErrorMessage(parseError), usage, { cause: parseError });
    }
  } else {
    const response = await client.models.generateContent({
      model,
      contents: userContent,
      config: {
        systemInstruction: systemPrompt,
        temperature,
        maxOutputTokens: maxTokens,
        ...(effortConfig.thinkingBudget
          ? { thinkingConfig: { thinkingBudget: effortConfig.thinkingBudget } }
          : {}),
      },
    });

    const promptTokens = response.usageMetadata?.promptTokenCount ?? 0;
    const completionTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
    const content = response.text ?? "";

    return {
      data: content as z.infer<T>,
      promptTokens,
      completionTokens,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    };
  }
}

async function completeWithDeepSeekStructured<T extends z.ZodType>(
  messages: Array<{ role: "system" | "user"; content: string }>,
  model: string,
  temperature: number,
  maxTokens: number | undefined,
  schema: T | undefined,
  effortConfig: EffortConfig & { kind: "deepseek" },
  client?: OpenAI,
): Promise<ProviderResult<z.infer<T>>> {
  const deepseekClient = client ?? getDeepSeekClient();

  // DeepSeek json_object mode needs temperature=0 to prevent markdown
  // wrapping and hallucinated prose around the JSON output.
  // When thinking is enabled, temperature/top_p are silently ignored by the API
  // — omit them to avoid confusion.
  const effectiveTemperature = schema ? 0 : temperature;
  const thinkingEnabled = !effortConfig.thinkingDisabled;

  if (!schema) {
    // For non-structured DeepSeek, use OpenAI-compatible path with effort.
    // DeepSeek reasoning_effort values ("high"/"max") are passed through to
    // DeepSeek's OpenAI-compatible endpoint. Cast needed because OpenAI SDK
    // types don't include "max".
    const reasoningEffort = effortConfig.thinkingDisabled
      ? undefined
      : (effortConfig.reasoningEffort as "minimal" | "low" | "medium" | "high");
    return completeWithOpenAI(messages, model, temperature, maxTokens, undefined, {
      kind: "openai" as const,
      reasoningEffort,
    }, deepseekClient);
  }

  const rawSchema = zodToJsonSchema(schema, {
    target: "openApi3",
    $refStrategy: "none",
  });

  const jsonSuffix = `\n\nReturn only a JSON object matching this schema. Do not wrap it in markdown fences or add explanatory text.\n\nSchema:\n${JSON.stringify(rawSchema, null, 2)}`;
  const userMessages = messages.map((m, i) =>
    i === messages.length - 1 && m.role === "user"
      ? { ...m, content: m.content + jsonSuffix }
      : m,
  );

  let promptTokens = 0;
  let completionTokens = 0;

  for (let attempt = 0; attempt <= 1; attempt++) {
    const deepseekParams: Record<string, unknown> = {
      model,
      max_completion_tokens: maxTokens,
      messages: userMessages,
      response_format: { type: "json_object" },
    };
    // Temperature has no effect when thinking is enabled in V4.
    // Only include it when thinking is disabled.
    if (!thinkingEnabled) {
      deepseekParams.temperature = effectiveTemperature;
    }
    if (!effortConfig.thinkingDisabled) {
      deepseekParams.reasoning_effort = effortConfig.reasoningEffort;
      deepseekParams.extra_body = { thinking: { type: "enabled" } };
    } else {
      deepseekParams.extra_body = { thinking: { type: "disabled" } };
    }

    const response = await deepseekClient.chat.completions.create(
      deepseekParams as unknown as Parameters<typeof deepseekClient.chat.completions.create>[0],
      { signal: AbortSignal.timeout(STAGE_TIMEOUT_MS) },
    );

    // response typing lost due to cast — restore it
    if (Symbol.asyncIterator in response) {
      throw new Error("DeepSeek returned unexpected stream");
    }
    const chatCompletion = response as OpenAI.ChatCompletion;

    promptTokens = chatCompletion.usage?.prompt_tokens ?? 0;
    completionTokens = chatCompletion.usage?.completion_tokens ?? 0;
    const choice = chatCompletion.choices[0];
    const usage: ProviderUsage = { promptTokens, completionTokens, cacheCreationTokens: 0, cacheReadTokens: 0 };
    const rawText = (choice?.message?.content ?? "").trim();

    if (!rawText) {
      const finishReason = choice?.finish_reason;
      throw new ProviderCallError(
        finishReason === "length"
          ? "DeepSeek output was truncated before producing output. Increase max_completion_tokens."
          : "DeepSeek returned empty output.",
        usage,
      );
    }

    const parsed = aiJsonSafeParse(rawText);
    if (parsed === null || parsed === undefined) {
      throw new ProviderCallError(
        "DeepSeek returned unparseable output.",
        usage,
        { cause: new SyntaxError("aiJsonSafeParse returned null") },
      );
    }

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      Object.keys(parsed).length === 0
    ) {
      throw new ProviderCallError(
        "DeepSeek returned an empty JSON object instead of the expected schema. The model may have been confused by the prompt — try simplifying or reducing constraints.",
        usage,
        { cause: new SyntaxError("Empty JSON object from DeepSeek") },
      );
    }

    try {
      const data = schema.parse(parsed);
      return { data, promptTokens, completionTokens, cacheCreationTokens: 0, cacheReadTokens: 0 };
    } catch (parseError) {
      if (attempt === 0 && parseError instanceof Error && parseError.name === "ZodError") {
        console.warn(
          `[completion] DeepSeek ZodError (finish_reason=${choice?.finish_reason ?? "unknown"}, attempt=${attempt + 1}), retrying: ${getErrorMessage(parseError)}`,
        );
        continue;
      }
      throw new ProviderCallError(getErrorMessage(parseError), usage, { cause: parseError });
    }
  }

  throw new Error("completeWithDeepSeekStructured: unreachable");
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function generateCompletion(options: CompletionOptions<z.ZodString> & { schema?: undefined }): Promise<CompletionResult<string>>;
export function generateCompletion<T extends z.ZodType>(
  options: CompletionOptions<T> & { schema: T },
): Promise<CompletionResult<z.infer<T>>>;
/**
 * Central LLM completion wrapper.
 * Every generation call in the app flows through this function.
 * Routes to the correct provider based on the model ID.
 */
export async function generateCompletion<T extends z.ZodType>(
  options: CompletionOptions<T>,
): Promise<CompletionResult<z.infer<T>>> {
  const {
    cachedSystemPrompt,
    systemPrompt,
    userPrompt,
    schema,
    model, // Required; lib/generate.ts always resolves model per-stage
    temperature = 0.7,
    maxTokens,
    effort,
  } = options;
  requireModelDefinition(model);

  const startTime = Date.now();
  const provider = getProviderForModel(model);
  const effortConfig = mapEffort(effort, provider);

  const fullSystemPrompt = joinSystemPrompts(cachedSystemPrompt, systemPrompt);
  const messages: Array<{ role: "system" | "user"; content: string }> = [
    { role: "system", content: fullSystemPrompt },
    { role: "user", content: userPrompt },
  ];

  try {
    let result: ProviderResult<z.infer<T>>;

    switch (provider) {
      case "anthropic":
        result = await completeWithAnthropic(
          cachedSystemPrompt,
          systemPrompt,
          userPrompt,
          model,
          temperature,
          maxTokens,
          schema,
          effortConfig as EffortConfig & { kind: "anthropic" },
          options.cacheSystemPrompt,
        );
        break;
      case "google":
        result = await completeWithGoogle(
          messages, model, temperature, maxTokens, schema,
          effortConfig as EffortConfig & { kind: "google" },
        );
        break;
      case "openai":
        result = await completeWithOpenAI(
          messages, model, temperature, maxTokens, schema,
          effortConfig as EffortConfig & { kind: "openai" },
        );
        break;
      case "deepseek":
        result = await completeWithDeepSeekStructured(
          messages, model, temperature, maxTokens, schema,
          effortConfig as EffortConfig & { kind: "deepseek" },
        );
        break;
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }

    const durationMs = Date.now() - startTime;
    const costUsd = getCompletionCostUsd(model, result);

    return {
      data: result.data,
      usage: {
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        totalTokens: result.promptTokens + result.completionTokens,
        costUsd,
        cacheCreationTokens: result.cacheCreationTokens,
        cacheReadTokens: result.cacheReadTokens,
      },
      durationMs,
    };
  } catch (error) {
    throw error;
  }
}
