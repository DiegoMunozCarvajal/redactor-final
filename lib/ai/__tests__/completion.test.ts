import { describe, it, expect } from "vitest";
import {
  getCompletionCostUsd,
  mapEffort,
  normalizePlainTextContent,
  buildAnthropicSystemPrompt,
  getErrorMessage,
} from "@/lib/ai/completion";

// ---------------------------------------------------------------------------
// getCompletionCostUsd
// ---------------------------------------------------------------------------

describe("getCompletionCostUsd", () => {
  const usage = (overrides: {
    promptTokens?: number;
    completionTokens?: number;
    cacheCreationTokens?: number;
    cacheReadTokens?: number;
  }) => ({
    promptTokens: 0,
    completionTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    ...overrides,
  });

  it("calculates cost for non-Anthropic models (OpenAI)", () => {
    // GPT 5.5: $2.75/$16.50 per million tokens
    const cost = getCompletionCostUsd(
      "gpt-5.5",
      usage({ promptTokens: 1000, completionTokens: 500 }),
    );
    expect(cost).toBeCloseTo((1000 * 2.75 + 500 * 16.5) / 1_000_000, 10);
  });

  it("calculates cost for non-Anthropic models (DeepSeek)", () => {
    const cost = getCompletionCostUsd(
      "deepseek-v4-pro",
      usage({ promptTokens: 2000, completionTokens: 1000 }),
    );
    expect(cost).toBeCloseTo((2000 * 1.74 + 1000 * 3.48) / 1_000_000, 10);
  });

  it("separates regular input from cache tokens for Anthropic", () => {
    // Claude Opus: $15/$75 per million. Cache write = 1.25x, read = 0.1x.
    const cost = getCompletionCostUsd(
      "claude-opus-4-8",
      usage({
        promptTokens: 1000, // total input (includes cache)
        completionTokens: 100,
        cacheCreationTokens: 200,
        cacheReadTokens: 300,
      }),
    );
    // Regular input: 1000 - 200 - 300 = 500
    const expected =
      (500 * 15) / 1_000_000 + // regular input
      (100 * 75) / 1_000_000 + // output
      (200 * 15 * 1.25) / 1_000_000 + // cache creation
      (300 * 15 * 0.1) / 1_000_000; // cache read
    expect(cost).toBeCloseTo(expected, 10);
  });

  it("handles zero regular input tokens (all cache)", () => {
    const cost = getCompletionCostUsd(
      "claude-opus-4-8",
      usage({
        promptTokens: 500,
        completionTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 500,
      }),
    );
    // All input is cache reads at 10%
    expect(cost).toBeCloseTo((500 * 15 * 0.1) / 1_000_000, 10);
  });

  it("handles zero tokens", () => {
    const cost = getCompletionCostUsd("gpt-5.5", usage({}));
    expect(cost).toBe(0);
  });

  it("Math.max prevents negative regular input (safety)", () => {
    // promptTokens < cache sum should clamp to 0
    const cost = getCompletionCostUsd(
      "claude-opus-4-8",
      usage({
        promptTokens: 100,
        completionTokens: 0,
        cacheCreationTokens: 50,
        cacheReadTokens: 100,
      }),
    );
    // Regular input: max(0, 100 - 150) = 0
    // Only cache costs apply
    const expected =
      (50 * 15 * 1.25) / 1_000_000 + (100 * 15 * 0.1) / 1_000_000;
    expect(cost).toBeCloseTo(expected, 10);
  });
});

// ---------------------------------------------------------------------------
// mapEffort
// ---------------------------------------------------------------------------

describe("mapEffort", () => {
  it("returns thinking disabled for 'off' effort (all providers)", () => {
    expect(mapEffort("off", "deepseek")).toEqual({ kind: "deepseek", thinkingDisabled: true });
    expect(mapEffort("off", "openai")).toEqual({ kind: "openai" });
    expect(mapEffort("off", "anthropic")).toEqual({ kind: "anthropic" });
    expect(mapEffort("off", "google")).toEqual({ kind: "google" });
  });

  it("returns thinking disabled for undefined effort (all providers)", () => {
    expect(mapEffort(undefined, "deepseek")).toEqual({ kind: "deepseek", thinkingDisabled: true });
    expect(mapEffort(undefined, "openai")).toEqual({ kind: "openai" });
    expect(mapEffort(undefined, "anthropic")).toEqual({ kind: "anthropic" });
    expect(mapEffort(undefined, "google")).toEqual({ kind: "google" });
  });

  it("DeepSeek: maps 'max' → 'max', everything else → 'high'", () => {
    expect(mapEffort("max", "deepseek")).toEqual({ kind: "deepseek", thinkingDisabled: false, reasoningEffort: "max" });
    expect(mapEffort("high", "deepseek")).toEqual({ kind: "deepseek", thinkingDisabled: false, reasoningEffort: "high" });
    expect(mapEffort("xhigh", "deepseek")).toEqual({ kind: "deepseek", thinkingDisabled: false, reasoningEffort: "high" });
    expect(mapEffort("low", "deepseek")).toEqual({ kind: "deepseek", thinkingDisabled: false, reasoningEffort: "high" });
  });

  it("OpenAI: maps effort levels correctly", () => {
    expect(mapEffort("max", "openai")).toEqual({ kind: "openai", reasoningEffort: "xhigh" });
    expect(mapEffort("xhigh", "openai")).toEqual({ kind: "openai", reasoningEffort: "xhigh" });
    expect(mapEffort("high", "openai")).toEqual({ kind: "openai", reasoningEffort: "high" });
    expect(mapEffort("low", "openai")).toEqual({ kind: "openai", reasoningEffort: "low" });
  });

  it("Anthropic: maps effort levels correctly", () => {
    expect(mapEffort("max", "anthropic")).toEqual({ kind: "anthropic", effort: "max" });
    expect(mapEffort("xhigh", "anthropic")).toEqual({ kind: "anthropic", effort: "xhigh" });
    expect(mapEffort("low", "anthropic")).toEqual({ kind: "anthropic", effort: "low" });
    expect(mapEffort("minimal", "anthropic")).toEqual({ kind: "anthropic", effort: "low" });
  });

  it("Google: maps effort levels to thinking budgets", () => {
    expect(mapEffort("max", "google")).toEqual({ kind: "google", thinkingBudget: 8192 });
    expect(mapEffort("xhigh", "google")).toEqual({ kind: "google", thinkingBudget: 8192 }); // xhigh → 8192 (default)
    expect(mapEffort("high", "google")).toEqual({ kind: "google", thinkingBudget: 8192 });
    expect(mapEffort("medium", "google")).toEqual({ kind: "google", thinkingBudget: 4096 });
    expect(mapEffort("low", "google")).toEqual({ kind: "google", thinkingBudget: 2048 });
    expect(mapEffort("minimal", "google")).toEqual({ kind: "google", thinkingBudget: 512 });
  });
});

// ---------------------------------------------------------------------------
// normalizePlainTextContent
// ---------------------------------------------------------------------------

describe("normalizePlainTextContent", () => {
  it("returns strings as-is", () => {
    expect(normalizePlainTextContent("hello")).toBe("hello");
  });

  it("joins string array elements", () => {
    expect(normalizePlainTextContent(["a", "b", "c"])).toBe("abc");
  });

  it("extracts text from content blocks", () => {
    const blocks = [
      { type: "text", text: "hello " },
      { type: "text", text: "world" },
    ];
    expect(normalizePlainTextContent(blocks)).toBe("hello world");
  });

  it("skips refusal blocks (returns empty string)", () => {
    expect(
      normalizePlainTextContent([{ type: "refusal", refusal: "I cannot help" }]),
    ).toBe("");
  });

  it("returns empty string for non-string non-array input", () => {
    expect(normalizePlainTextContent(null)).toBe("");
    expect(normalizePlainTextContent(42)).toBe("");
    expect(normalizePlainTextContent({})).toBe("");
  });

  it("handles mixed content blocks (text + refusal)", () => {
    const blocks = [
      { type: "text", text: "ok" },
      { type: "refusal", refusal: "no" },
    ];
    expect(normalizePlainTextContent(blocks)).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// buildAnthropicSystemPrompt
// ---------------------------------------------------------------------------

describe("buildAnthropicSystemPrompt", () => {
  it("returns the logged system message unchanged when caching is off", () => {
    expect(buildAnthropicSystemPrompt("system")).toBe("system");
  });

  it("marks the same logged system message cacheable", () => {
    expect(buildAnthropicSystemPrompt("system", true)).toEqual([
      {
        type: "text",
        text: "system",
        cache_control: { type: "ephemeral" },
      },
    ]);
  });

  it("preserves whitespace so the logged message is exactly what the model receives", () => {
    expect(buildAnthropicSystemPrompt("  system  ")).toBe("  system  ");
  });

  it("preserves whitespace in cached system prompt", () => {
    expect(buildAnthropicSystemPrompt("  system  ", true)).toEqual([
      {
        type: "text",
        text: "  system  ",
        cache_control: { type: "ephemeral" },
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// getErrorMessage
// ---------------------------------------------------------------------------

describe("getErrorMessage", () => {
  it("returns Error.message for Error instances", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("returns 'Unknown error' for non-Error values", () => {
    expect(getErrorMessage("plain string")).toBe("Unknown error");
    expect(getErrorMessage(null)).toBe("Unknown error");
    expect(getErrorMessage(42)).toBe("Unknown error");
  });
});
