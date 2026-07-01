import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { getOpenAIClient } from "./clients/openai";
import { getAnthropicClient } from "./clients/anthropic";
import { getGoogleClient } from "./clients/google";
import { getDeepSeekClient } from "./clients/deepseek";
import { aiJsonSafeParse } from "ai-json-safe-parse";
import OpenAI from "openai";
import { getModelPricing, getProviderForModel, requireModelDefinition } from "./providers";
import { sanitizeForAnthropic, makeOpenAIStrictSchema } from "./schema-sanitizers";
type TrackedStage = string;

const STAGE_TIMEOUT_MS = 900_000; // 15 minutes — Opus 4.8 + thinking can exceed 10m

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

export type ReasoningEffort = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

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
  /** External abort signal (e.g., client disconnect). Combined with stage timeout. */
  signal?: AbortSignal;
}

export function joinSystemPrompts(...blocks: Array<string | undefined>): string {
  return blocks
    .map((block) => block?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n");
}

export function buildAnthropicSystemPrompt(
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

export function normalizePlainTextContent(content: unknown): string {
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

export function getCompletionCostUsd(model: string, usage: ProviderUsage): number {
  const pricing = getModelPricing(model);
  const outputCost = usage.completionTokens * pricing.output;

  if (getProviderForModel(model) !== "anthropic") {
    return usage.promptTokens * pricing.input + outputCost;
  }

  // Anthropic's `input_tokens` total already includes cache tokens.
  // Subtract them so we charge cache reads at 10% and cache writes at
  // 125% of the base input price instead of double-counting.
  const regularInputTokens = Math.max(
    0,
    usage.promptTokens - usage.cacheCreationTokens - usage.cacheReadTokens,
  );
  const inputCost = regularInputTokens * pricing.input;
  const cacheCreationCost = usage.cacheCreationTokens * pricing.input * 1.25;
  const cacheReadCost = usage.cacheReadTokens * pricing.input * 0.1;
  return inputCost + outputCost + cacheCreationCost + cacheReadCost;
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

// ---------------------------------------------------------------------------
// Provider-specific completion handlers
// ---------------------------------------------------------------------------

// Models that reject the `temperature` parameter entirely (legacy reasoning models).
// This is distinct from ModelDefinition.fixedTemperature, which locks temperature
// to a specific value only when reasoning is active.
const MODELS_WITHOUT_TEMPERATURE_SUPPORT = new Set(["o1", "o1-mini", "o3", "o3-mini", "o4-mini"]);

// Anthropic thinking models (Opus 4.7+) reject the `temperature` parameter.
// When effort is not explicitly set, omit temperature instead of failing.
const ANTHROPIC_MODELS_WITHOUT_TEMPERATURE = new Set(["claude-opus-4-8"]);

// ---------------------------------------------------------------------------
// Reasoning effort → provider-specific mappings
// ---------------------------------------------------------------------------

type EffortConfig =
  | { kind: "deepseek"; thinkingDisabled: true }
  | { kind: "deepseek"; thinkingDisabled: false; reasoningEffort: "high" | "max" }
  | { kind: "openai"; reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh" }
  | { kind: "anthropic"; effort?: "low" | "medium" | "high" | "xhigh" | "max" }
  | { kind: "google"; thinkingBudget?: number };

export function mapEffort(effort: ReasoningEffort | undefined, provider: string): EffortConfig {
  switch (provider) {
    case "deepseek": {
      if (!effort || effort === "off") return { kind: "deepseek", thinkingDisabled: true };
      // DeepSeek only has "high" and "max". Map minimal/low/medium → high
      const reasoningEffort = effort === "max" ? "max" : "high";
      return { kind: "deepseek", thinkingDisabled: false, reasoningEffort };
    }
    case "openai": {
      if (!effort || effort === "off") return { kind: "openai" };
      // OpenAI supports 5 levels: minimal, low, medium, high, xhigh.
      // "max" maps to "xhigh" (OpenAI's highest).
      const effortMap: Record<string, "minimal" | "low" | "medium" | "high" | "xhigh"> = {
        minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "xhigh",
      };
      return { kind: "openai", reasoningEffort: effortMap[effort] ?? "high" };
    }
    case "anthropic": {
      if (!effort || effort === "off") return { kind: "anthropic" };
      // Map our effort levels to Anthropic's output_config.effort values.
      // Anthropic supports 5 levels: low, medium, high, xhigh, max.
      const effortMap: Record<string, "low" | "medium" | "high" | "xhigh" | "max"> = {
        minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max",
      };
      return { kind: "anthropic", effort: effortMap[effort] ?? "high" };
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
  signal?: AbortSignal,
): Promise<ProviderResult<z.infer<T>>> {
  const openaiClient = client ?? getOpenAIClient();
  const modelDef = requireModelDefinition(model);
  const supportsTemperature = !MODELS_WITHOUT_TEMPERATURE_SUPPORT.has(model);

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

    // OpenAI strict mode requires all properties in `required`. If the schema
    // has optional fields (required subset of properties), disable strict mode.
    const allRequired = jsonSchema.properties
      ? Array.isArray(jsonSchema.required) &&
        jsonSchema.required.length === Object.keys(jsonSchema.properties as Record<string, unknown>).length
      : true;

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
          strict: allRequired,
          schema: jsonSchema as Record<string, unknown>,
        },
      },
    }, { signal: signal ?? AbortSignal.timeout(STAGE_TIMEOUT_MS) });

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
    }, { signal: signal ?? AbortSignal.timeout(STAGE_TIMEOUT_MS) });

    const promptTokens = response.usage?.prompt_tokens ?? 0;
    const completionTokens = response.usage?.completion_tokens ?? 0;
    const choice = response.choices[0];
    if (!choice) throw new Error("OpenAI returned empty choices array");
    const content = normalizePlainTextContent(choice.message.content);

    if (choice.finish_reason === "content_filter") {
      throw new Error(
        "OpenAI returned a content filter refusal. The prompt or generated text triggered the safety filter."
      );
    }

    if (choice.finish_reason === "length") {
      if (!content.trim()) {
        throw new Error(
          "The model output hit the token limit before it produced usable visible text. Increase max completion tokens for this call."
        );
      }
      console.warn(
        `[completion] Output truncated by token limit (${completionTokens} tokens). Content may be cut off. Consider increasing maxTokens.`
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
  maxTokens: number | undefined,
  schema: T | undefined,
  effortConfig: EffortConfig & { kind: "anthropic" },
  cacheSystemPrompt?: boolean,
  temperature?: number,
  signal?: AbortSignal,
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

    const stream = client.messages.stream({
      model,
      max_tokens: maxTokens ?? 16384,
      system: systemParam,
      messages: [{ role: "user" as const, content: userPrompt }],
      // Anthropic rejects thinking + forced tool_choice together.
      // When using structured output (schema), omit thinking/effort.
      ...(!schema && effortConfig.effort
        ? { thinking: { type: "adaptive" as const }, output_config: { effort: effortConfig.effort } }
        : !ANTHROPIC_MODELS_WITHOUT_TEMPERATURE.has(model) && temperature !== undefined
          ? { temperature }
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
    }, { signal: signal ?? AbortSignal.timeout(STAGE_TIMEOUT_MS) });
    const response = await stream.finalMessage();

    const promptTokens = response.usage?.input_tokens ?? 0;
    const completionTokens = response.usage?.output_tokens ?? 0;
    const cacheCreationTokens = response.usage?.cache_creation_input_tokens ?? 0;
    const cacheReadTokens = response.usage?.cache_read_input_tokens ?? 0;
    const usage: ProviderUsage = { promptTokens, completionTokens, cacheCreationTokens, cacheReadTokens };

    const toolBlock = response.content.find((b) => b.type === "tool_use");
    if (!toolBlock || toolBlock.type !== "tool_use") {
      throw new ProviderCallError(
        response.stop_reason === "max_tokens"
          ? "Anthropic output was truncated before producing structured output. Increase max_tokens."
          : "Anthropic model did not return structured tool_use output.",
        usage,
      );
    }
    try {
      const data = schema.parse(toolBlock.input);
      return { data, promptTokens, completionTokens, cacheCreationTokens, cacheReadTokens };
    } catch (parseError) {
      const hint = response.stop_reason === "max_tokens"
        ? " (output was truncated by token limit — parsed value may be incomplete)"
        : "";
      throw new ProviderCallError(
        getErrorMessage(parseError) + hint,
        usage,
        { cause: parseError },
      );
    }
  } else {
    // Thinking tokens count against max_tokens. When effort is active, the
    // model needs extra budget — default to 32768 so visible output isn't starved.
    const defaultMaxTokens = effortConfig.effort ? 32768 : 16384;
    const stream = client.messages.stream({
      model,
      max_tokens: maxTokens ?? defaultMaxTokens,
      system: systemParam,
      messages: [{ role: "user" as const, content: userPrompt }],
      ...(effortConfig.effort
        ? { thinking: { type: "adaptive" as const }, output_config: { effort: effortConfig.effort } }
        : !ANTHROPIC_MODELS_WITHOUT_TEMPERATURE.has(model) && temperature !== undefined
          ? { temperature }
          : {}),
    }, { signal: signal ?? AbortSignal.timeout(STAGE_TIMEOUT_MS) });
    const response = await stream.finalMessage();

    const promptTokens = response.usage?.input_tokens ?? 0;
    const completionTokens = response.usage?.output_tokens ?? 0;
    const cacheCreationTokens = response.usage?.cache_creation_input_tokens ?? 0;
    const cacheReadTokens = response.usage?.cache_read_input_tokens ?? 0;

    const textBlock = response.content.find((b) => b.type === "text");
    const content = textBlock && textBlock.type === "text" ? textBlock.text : "";

    if (response.stop_reason === "max_tokens") {
      if (!content.trim()) {
        throw new Error(
          "The model output hit the token limit before it produced usable visible text. Increase max completion tokens for this call."
        );
      }
      console.warn(
        `[completion] Output truncated by max_tokens limit (${completionTokens} tokens). Content may be cut off. Consider increasing maxTokens.`
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
  signal?: AbortSignal,
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
        abortSignal: signal ?? AbortSignal.timeout(STAGE_TIMEOUT_MS),
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
    const finishReason = response.candidates?.[0]?.finishReason;

    // Detect content-filter blocks before attempting JSON.parse.
    // Google returns finishReason "SAFETY" (or similar) when its safety
    // filters block the output — the content will be empty or truncated.
    if (!content.trim() || finishReason === "SAFETY") {
      throw new ProviderCallError(
        "Google model blocked the response due to safety filters.",
        { promptTokens, completionTokens, cacheCreationTokens: 0, cacheReadTokens: 0 },
      );
    }

    if (finishReason === "MAX_TOKENS") {
      console.warn(
        "[completeWithGoogle] structured output truncated (MAX_TOKENS). " +
          `prompt_tokens=${promptTokens} completion_tokens=${completionTokens}`,
      );
    }

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
        abortSignal: signal ?? AbortSignal.timeout(STAGE_TIMEOUT_MS),
        ...(effortConfig.thinkingBudget
          ? { thinkingConfig: { thinkingBudget: effortConfig.thinkingBudget } }
          : {}),
      },
    });

    const promptTokens = response.usageMetadata?.promptTokenCount ?? 0;
    const completionTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
    const content = response.text ?? "";
    const finishReason = response.candidates?.[0]?.finishReason;

    if (!content.trim() || finishReason === "SAFETY") {
      throw new ProviderCallError(
        "Google model blocked the response due to safety filters.",
        { promptTokens, completionTokens, cacheCreationTokens: 0, cacheReadTokens: 0 },
      );
    }

    if (finishReason === "MAX_TOKENS") {
      console.warn(
        "[completeWithGoogle] output truncated (MAX_TOKENS). " +
          `prompt_tokens=${promptTokens} completion_tokens=${completionTokens}`,
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

async function completeWithDeepSeekStructured<T extends z.ZodType>(
  messages: Array<{ role: "system" | "user"; content: string }>,
  model: string,
  temperature: number,
  maxTokens: number | undefined,
  schema: T | undefined,
  effortConfig: EffortConfig & { kind: "deepseek" },
  client?: OpenAI,
  signal?: AbortSignal,
): Promise<ProviderResult<z.infer<T>>> {
  const deepseekClient = client ?? getDeepSeekClient();

  // DeepSeek json_object mode needs temperature=0 to prevent markdown
  // wrapping and hallucinated prose around the JSON output.
  // DeepSeek V4 models only support temperature=1 outside json_object mode.
  // When thinking is enabled, temperature/top_p are silently ignored by the API
  // — omit them to avoid confusion.
  const effectiveTemperature = schema ? 0 : 1;
  // DeepSeek rejects thinking + structured output (json_object) together:
  // "Thinking may not be enabled when tool_choice forces tool use."
  // Force thinking disabled when a schema is present.
  const thinkingEnabled = schema ? false : !effortConfig.thinkingDisabled;

  if (!schema) {
    // For non-structured DeepSeek, use OpenAI-compatible path with effort.
    // DeepSeek reasoning_effort values ("high"/"max") are passed through to
    // DeepSeek's OpenAI-compatible endpoint. Cast needed because OpenAI SDK
    // types don't include "max".
    const reasoningEffort = effortConfig.thinkingDisabled
      ? undefined
      : (effortConfig.reasoningEffort as "minimal" | "low" | "medium" | "high");
    return completeWithOpenAI(messages, model, effectiveTemperature, maxTokens, undefined, {
      kind: "openai" as const,
      reasoningEffort,
    }, deepseekClient, signal);
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
    // Build the base params with proper OpenAI types.  Only `extra_body`
    // (thinking config) and a wider `reasoning_effort` value need a cast
    // because the OpenAI SDK types don't include DeepSeek extensions.
    const params: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
      model,
      max_completion_tokens: maxTokens,
      messages: userMessages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      response_format: { type: "json_object" },
    };

    if (!thinkingEnabled) {
      (params as unknown as Record<string, unknown>).temperature = effectiveTemperature;
    }

    // thinkingEnabled is always false here (schema is truthy in this
    // branch), so we always disable thinking.  Keep the guard for
    // clarity and future refactoring safety.
    (params as unknown as Record<string, unknown>).extra_body = {
      thinking: { type: "disabled" },
    };

    const response = (await deepseekClient.chat.completions.create(
      params,
      { signal: signal ?? AbortSignal.timeout(STAGE_TIMEOUT_MS) },
    )) as OpenAI.ChatCompletion;

    promptTokens = response.usage?.prompt_tokens ?? 0;
    completionTokens = response.usage?.completion_tokens ?? 0;
    const choice = response.choices[0];
    const usage: ProviderUsage = { promptTokens, completionTokens, cacheCreationTokens: 0, cacheReadTokens: 0 };
    const rawText = (choice?.message?.content ?? "").trim();

    if (!rawText) {
      const finishReason = choice?.finish_reason;
      if (finishReason === "length") {
        throw new ProviderCallError(
          "DeepSeek output was truncated before producing output. Increase max_completion_tokens.",
          usage,
        );
      }
      if (finishReason === "content_filter") {
        throw new ProviderCallError(
          "DeepSeek returned a content filter refusal. The prompt or generated text triggered the safety filter.",
          usage,
        );
      }
      throw new ProviderCallError(
        "DeepSeek returned empty output.",
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
    signal: externalSignal,
  } = options;
  requireModelDefinition(model);

  const startTime = performance.now();
  const provider = getProviderForModel(model);
  const effortConfig = mapEffort(effort, provider);

  // Combine external signal (e.g. client disconnect) with stage timeout
  const signal = externalSignal
    ? AbortSignal.any([externalSignal, AbortSignal.timeout(STAGE_TIMEOUT_MS)])
    : undefined;

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
          maxTokens,
          schema,
          effortConfig as EffortConfig & { kind: "anthropic" },
          options.cacheSystemPrompt,
          temperature,
          signal,
        );
        break;
      case "google":
        result = await completeWithGoogle(
          messages, model, temperature, maxTokens, schema,
          effortConfig as EffortConfig & { kind: "google" },
          signal,
        );
        break;
      case "openai":
        result = await completeWithOpenAI(
          messages, model, temperature, maxTokens, schema,
          effortConfig as EffortConfig & { kind: "openai" },
          undefined,
          signal,
        );
        break;
      case "deepseek":
        result = await completeWithDeepSeekStructured(
          messages, model, temperature, maxTokens, schema,
          effortConfig as EffortConfig & { kind: "deepseek" },
          undefined,
          signal,
        );
        break;
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }

    const durationMs = Math.round(performance.now() - startTime);
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
    console.error(
      "[generateCompletion] Unexpected error:",
      error instanceof Error ? error.message : "Unknown error",
    );
    throw error;
  }
}
