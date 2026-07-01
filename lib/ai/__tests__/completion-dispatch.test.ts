import { describe, it, expect, vi, beforeEach } from "vitest";
// NOTE: does NOT import from ai-mocks — uses vi.doMock directly so each test
// can reset and re-mock with different provider implementations.

describe("generateCompletion provider dispatch", () => {
  describe("DeepSeek", () => {
    beforeEach(async () => {
      vi.resetModules();
      vi.doMock("@/lib/ai/clients/deepseek", () => ({
        getDeepSeekClient: () => ({
          chat: {
            completions: {
              create: vi.fn().mockResolvedValue({
                id: "d",
                choices: [
                  { index: 0, message: { role: "assistant", content: "ds-out" }, finish_reason: "stop" },
                ],
                usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
              }),
            },
          },
        }),
      }));
    });

    it("routes deepseek-v4-pro → DeepSeek", async () => {
      const { generateCompletion } = await import("@/lib/ai/completion");
      const r = await generateCompletion({
        systemPrompt: "sys",
        userPrompt: "hi",
        model: "deepseek-v4-pro",
        temperature: 0,
      });
      expect(r.data).toBe("ds-out");
      expect(r.usage.promptTokens).toBe(20);
      expect(r.usage.completionTokens).toBe(10);
    });
  });

  describe("OpenAI", () => {
    beforeEach(async () => {
      vi.resetModules();
      vi.doMock("@/lib/ai/clients/openai", () => ({
        getOpenAIClient: () => ({
          chat: {
            completions: {
              create: vi.fn().mockResolvedValue({
                id: "o",
                object: "chat.completion",
                model: "gpt-5.5",
                choices: [
                  { index: 0, message: { role: "assistant", content: "oai-out" }, finish_reason: "stop" },
                ],
                usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
              }),
            },
          },
        }),
      }));
    });

    it("routes gpt-5.5 → OpenAI", async () => {
      const { generateCompletion } = await import("@/lib/ai/completion");
      const r = await generateCompletion({
        systemPrompt: "s",
        userPrompt: "u",
        model: "gpt-5.5",
      });
      expect(r.data).toBe("oai-out");
    });
  });

  describe("Anthropic", () => {
    beforeEach(async () => {
      vi.resetModules();
      vi.doMock("@/lib/ai/clients/anthropic", () => ({
        getAnthropicClient: () => ({
          messages: {
            stream: vi.fn().mockReturnValue({
              finalMessage: vi.fn().mockResolvedValue({
                role: "assistant",
                content: [{ type: "text", text: "claude-out" }],
                usage: { input_tokens: 10, output_tokens: 5 },
                stop_reason: "end_turn",
              }),
            }),
          },
        }),
      }));
    });

    it("routes claude-opus-4-8 → Anthropic", async () => {
      const { generateCompletion } = await import("@/lib/ai/completion");
      const r = await generateCompletion({
        systemPrompt: "s",
        userPrompt: "u",
        model: "claude-opus-4-8",
        temperature: 0,
      });
      expect(r.data).toBe("claude-out");
    });
  });

  describe("unknown model", () => {
    it("throws for unregistered model", async () => {
      vi.resetModules();
      const { generateCompletion } = await import("@/lib/ai/completion");

      await expect(
        generateCompletion({
          systemPrompt: "s",
          userPrompt: "u",
          model: "nonexistent-model-123",
        }),
      ).rejects.toThrow('Unknown model: "nonexistent-model-123"');
    });
  });

  describe("tracking", () => {
    beforeEach(async () => {
      vi.resetModules();
      vi.doMock("@/lib/ai/clients/deepseek", () => ({
        getDeepSeekClient: () => ({
          chat: {
            completions: {
              create: vi.fn().mockResolvedValue({
                id: "d2",
                choices: [
                  { index: 0, message: { role: "assistant", content: "tracked" }, finish_reason: "stop" },
                ],
                usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
              }),
            },
          },
        }),
      }));
    });

    it("returns usage with cost", async () => {
      const { generateCompletion } = await import("@/lib/ai/completion");
      const r = await generateCompletion({
        systemPrompt: "s",
        userPrompt: "u",
        model: "deepseek-v4-pro",
      });
      expect(r.usage.totalTokens).toBe(2);
      expect(r.usage.costUsd).toBeGreaterThan(0);
      expect(typeof r.durationMs).toBe("number");
    });
  });
});
