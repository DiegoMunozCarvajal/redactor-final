/**
 * AI provider mock factories for testing the completion layer.
 *
 * Usage:
 *   import { mockOpenAI, mockAnthropic } from "@/lib/__tests__/helpers/ai-mocks";
 *
 *   mockOpenAI();
 *   const { generateCompletion } = await import("@/lib/ai/completion");
 *   const result = await generateCompletion({...});
 */

import { vi } from "vitest";

/**
 * Mock the OpenAI client to return deterministic completions.
 * @param responseText - The text to return as the completion response.
 */
export function mockOpenAI(responseText = '{"ok": true}'): void {
  vi.mock("@/lib/ai/clients/openai", () => ({
    getOpenAIClient: () => ({
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
                  content: responseText,
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
    }),
  }));
}

/**
 * Mock the Anthropic client to return deterministic completions.
 * @param responseText - The text content to return.
 */
export function mockAnthropic(responseText = "test response"): void {
  vi.mock("@/lib/ai/clients/anthropic", () => ({
    getAnthropicClient: () => ({
      messages: {
        stream: vi.fn().mockReturnValue({
          finalMessage: vi.fn().mockResolvedValue({
            role: "assistant",
            content: [{ type: "text", text: responseText }],
            usage: { input_tokens: 10, output_tokens: 5 },
            stop_reason: "end_turn",
          }),
        }),
      },
    }),
  }));
}
