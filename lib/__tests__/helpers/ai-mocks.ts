/**
 * AI provider mock factories for testing the completion layer.
 *
 * Usage:
 *   import { mockOpenAI, mockAnthropic } from "@/lib/__tests__/helpers/ai-mocks";
 *
 *   mockOpenAI({ completionText: "hello" });
 *   const { generateCompletion } = await import("@/lib/ai/completion");
 *   const result = await generateCompletion({...});
 *
 * IMPORTANT: Call mock*() BEFORE importing the module under test.
 * Each function sets module-level state read by the hoisted vi.mock factories.
 */

import { vi } from "vitest";

export interface MockOpenAIOptions {
  completionText?: string;
  embedding?: number[];
}

// Module-level mutable state — set by mock*() calls, read by hoisted vi.mock factories.
// vi.mock is hoisted so factory functions CANNOT reference function-scoped variables
// from mock*() — they must reference these module-level containers instead.
let _openaiOpts: MockOpenAIOptions = {};
let _anthropicText = "test response";
let _googleText = "test response";
let _deepseekText = "test response";

vi.mock("@/lib/ai/clients/openai", () => ({
  getOpenAIClient: () => {
    const completionText = _openaiOpts.completionText ?? '{"ok": true}';
    const embedding = _openaiOpts.embedding ?? [0.1, 0.2, 0.3];
    return {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            id: "test-completion",
            object: "chat.completion",
            model: "gpt-4o",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: completionText,
                },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 5,
              total_tokens: 15,
            },
          }),
        },
      },
      embeddings: {
        create: vi
          .fn()
          .mockImplementation(async (params: { input: string | string[] }) => {
            const inputs = Array.isArray(params.input) ? params.input : [params.input];
            return {
              data: inputs.map((_, i) => ({ embedding, index: i })),
              model: "text-embedding-3-small",
            };
          }),
      },
    };
  },
}));

vi.mock("@/lib/ai/clients/anthropic", () => ({
  getAnthropicClient: () => ({
    messages: {
      stream: vi.fn().mockReturnValue({
        finalMessage: vi.fn().mockResolvedValue({
          role: "assistant",
          content: [{ type: "text", text: _anthropicText }],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: "end_turn",
        }),
      }),
    },
  }),
}));

vi.mock("@/lib/ai/clients/google", () => ({
  getGoogleClient: () => ({
    models: {
      generateContent: vi.fn().mockResolvedValue({
        text: _googleText,
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        candidates: [{ finishReason: "STOP" }],
      }),
    },
  }),
}));

vi.mock("@/lib/ai/clients/deepseek", () => ({
  getDeepSeekClient: () => ({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          id: "test-deepseek",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: _deepseekText },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      },
    },
  }),
}));

/**
 * Set mock OpenAI completion text and/or embedding vector.
 * Call BEFORE importing the module under test.
 */
export function mockOpenAI(opts: MockOpenAIOptions = {}): void {
  _openaiOpts = opts;
}

/**
 * Set mock Anthropic response text.
 * Call BEFORE importing the module under test.
 */
export function mockAnthropic(responseText = "test response"): void {
  _anthropicText = responseText;
}

/**
 * Set mock Google response text.
 * Call BEFORE importing the module under test.
 */
export function mockGoogle(responseText = "test response"): void {
  _googleText = responseText;
}

/**
 * Set mock DeepSeek response text.
 * Call BEFORE importing the module under test.
 */
export function mockDeepSeek(responseText = "test response"): void {
  _deepseekText = responseText;
}
