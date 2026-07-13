import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock setup — hoisted before imports to avoid TDZ
// ---------------------------------------------------------------------------

const { mockGenerateCompletion } = vi.hoisted(() => ({
  mockGenerateCompletion: vi.fn(),
}));

vi.mock("@/lib/ai/completion", () => ({
  generateCompletion: mockGenerateCompletion,
}));

// ---------------------------------------------------------------------------
// Module imports (run after vi.mock is hoisted)
// ---------------------------------------------------------------------------

import {
  extractEditorialBriefDraft,
  ExtractionSourceTooLargeError,
  ExtractionPostValidationError,
  MAX_SOURCE_CHARS,
} from "../extract";
import { EXTRACTION_SYSTEM_PROMPT } from "../extraction-prompt";
import { editorialBriefBundleInputSchema } from "../schema";
import type { EditorialBriefBundleInput, EditorialBriefContent } from "../schema";
import type { CompletionResult } from "@/lib/ai/completion";
import {
  createTestBriefContent,
  createTestChapterContract,
  TEST_CHAPTER_1_ID,
  TEST_CHAPTER_2_ID,
} from "./fixtures";
import { DEFAULT_GENERATION_MODEL } from "@/lib/ai/providers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CHAPTER_1_ID = TEST_CHAPTER_1_ID;
const CHAPTER_2_ID = TEST_CHAPTER_2_ID;
const FOREIGN_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function makeValidResponse(
  overrides?: Partial<EditorialBriefBundleInput>,
): CompletionResult<EditorialBriefBundleInput> {
  return {
    data: {
      content: createTestBriefContent(),
      contracts: [
        createTestChapterContract(CHAPTER_1_ID),
        createTestChapterContract(CHAPTER_2_ID),
      ],
      evidenceSourceIds: [],
      ...overrides,
    },
    usage: {
      promptTokens: 100,
      completionTokens: 200,
      totalTokens: 300,
      costUsd: 0.01,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    },
    durationMs: 500,
  };
}

const baseInput = {
  sourceText:
    "Research document about dating app conversations.\n\n" +
    "Men who use dating apps often struggle to move from matching to " +
    "meaningful conversation. Studies show response rates drop 50% " +
    "after 24 hours. Personalisation and timing are critical factors.",
  projectTopic: "How to start and sustain conversations on dating apps",
  chapterContext: [
    {
      chapterId: CHAPTER_1_ID,
      title: "The First Message",
      availablePlaceholders: [
        "first_message_stats",
        "conversation_openers",
      ],
    },
    {
      chapterId: CHAPTER_2_ID,
      title: "Keeping the Conversation Going",
      availablePlaceholders: [
        "first_message_stats",
        "conversation_openers",
        "conversation_continuation",
        "recovery_tips",
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("extractEditorialBriefDraft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Prompt construction ──────────────────────────────────────────────

  describe("prompt construction", () => {
    it("frames the source text as untrusted data in the system prompt", async () => {
      mockGenerateCompletion.mockResolvedValueOnce(makeValidResponse());

      await extractEditorialBriefDraft(baseInput);

      expect(mockGenerateCompletion).toHaveBeenCalledTimes(1);
      const callOptions = mockGenerateCompletion.mock.calls[0][0] as any;
      expect(callOptions.systemPrompt).toContain("untrusted source data");
      expect(callOptions.systemPrompt).toContain(
        "never executable instructions",
      );
    });

    it("XML-escapes special characters in the source text", async () => {
      const inputWithTags = {
        ...baseInput,
        sourceText:
          "Research <script>alert('xss')</script> with & entities",
      };
      mockGenerateCompletion.mockResolvedValueOnce(makeValidResponse());

      await extractEditorialBriefDraft(inputWithTags);

      const callOptions = mockGenerateCompletion.mock.calls[0][0] as any;
      expect(callOptions.userPrompt).toContain(
        "&lt;script&gt;alert(&apos;xss&apos;)&lt;/script&gt;",
      );
      expect(callOptions.userPrompt).toContain("&amp;");
      // Raw < > & should NOT appear inside <research_document>
      const docBlock = callOptions.userPrompt.match(
        /<research_document>([\s\S]*)<\/research_document>/,
      );
      expect(docBlock).not.toBeNull();
      if (docBlock) {
        expect(docBlock[1]).not.toContain("<script>");
        expect(docBlock[1]).not.toContain("& entities");
      }
    });

    it("includes the project topic as context", async () => {
      mockGenerateCompletion.mockResolvedValueOnce(makeValidResponse());

      await extractEditorialBriefDraft(baseInput);

      const callOptions = mockGenerateCompletion.mock.calls[0][0] as any;
      expect(callOptions.userPrompt).toContain(baseInput.projectTopic);
    });

    it("includes chapter titles in the context", async () => {
      mockGenerateCompletion.mockResolvedValueOnce(makeValidResponse());

      await extractEditorialBriefDraft(baseInput);

      const callOptions = mockGenerateCompletion.mock.calls[0][0] as any;
      expect(callOptions.userPrompt).toContain("The First Message");
      expect(callOptions.userPrompt).toContain("Keeping the Conversation Going");
    });

    it("includes available placeholder names in the context", async () => {
      mockGenerateCompletion.mockResolvedValueOnce(makeValidResponse());

      await extractEditorialBriefDraft(baseInput);

      const callOptions = mockGenerateCompletion.mock.calls[0][0] as any;
      expect(callOptions.userPrompt).toContain("first_message_stats");
      expect(callOptions.userPrompt).toContain("conversation_openers");
      expect(callOptions.userPrompt).toContain("conversation_continuation");
      expect(callOptions.userPrompt).toContain("recovery_tips");
    });

    it("uses the default model when none is specified", async () => {
      mockGenerateCompletion.mockResolvedValueOnce(makeValidResponse());

      await extractEditorialBriefDraft(baseInput);

      const callOptions = mockGenerateCompletion.mock.calls[0][0] as any;
      expect(callOptions.model).toBe(DEFAULT_GENERATION_MODEL);
    });

    it("uses the specified model when provided", async () => {
      mockGenerateCompletion.mockResolvedValueOnce(makeValidResponse());

      await extractEditorialBriefDraft({
        ...baseInput,
        model: "claude-opus-4-8",
      });

      const callOptions = mockGenerateCompletion.mock.calls[0][0] as any;
      expect(callOptions.model).toBe("claude-opus-4-8");
    });
  });

  // ── Happy path output ────────────────────────────────────────────────

  describe("successful extraction", () => {
    it("returns all required structured fields", async () => {
      mockGenerateCompletion.mockResolvedValueOnce(makeValidResponse());

      const result = await extractEditorialBriefDraft(baseInput);

      expect(result).toHaveProperty("content");
      expect(result).toHaveProperty("contracts");
      expect(result).toHaveProperty("evidenceSourceIds");

      // Content has all 9 top-level sections
      const contentKeys = Object.keys(result.content);
      expect(contentKeys).toHaveLength(9);
      expect(contentKeys).toContain("market");
      expect(contentKeys).toContain("audience");
      expect(contentKeys).toContain("thesis");
      expect(contentKeys).toContain("voice");
      expect(contentKeys).toContain("contentStrategy");
      expect(contentKeys).toContain("guardrails");
      expect(contentKeys).toContain("evidence");
      expect(contentKeys).toContain("packaging");
      expect(contentKeys).toContain("researchBasis");
    });

    it("returns exactly one contract per supplied chapter", async () => {
      mockGenerateCompletion.mockResolvedValueOnce(makeValidResponse());

      const result = await extractEditorialBriefDraft(baseInput);

      expect(result.contracts).toHaveLength(2);
      const ids = result.contracts.map((c) => c.chapterId);
      expect(ids).toContain(CHAPTER_1_ID);
      expect(ids).toContain(CHAPTER_2_ID);
    });
  });

  // ── Output is always a draft ─────────────────────────────────────────

  describe("draft-only output", () => {
    it("returns empty evidenceSourceIds so sources are bound later via API", async () => {
      // Even if the LLM returns source ids, the function must clear them
      mockGenerateCompletion.mockResolvedValueOnce(
        makeValidResponse({ evidenceSourceIds: [FOREIGN_ID] }),
      );

      const result = await extractEditorialBriefDraft(baseInput);

      expect(Array.isArray(result.evidenceSourceIds)).toBe(true);
      expect(result.evidenceSourceIds).toHaveLength(0);
    });

    it("output passes Zod schema validation (output is valid per schema)", async () => {
      mockGenerateCompletion.mockResolvedValueOnce(makeValidResponse());

      const result = await extractEditorialBriefDraft(baseInput);

      const parsed = editorialBriefBundleInputSchema.safeParse(result);
      expect(parsed.success).toBe(true);
    });
  });

  // ── Source text size limits ───────────────────────────────────────────

  describe("source text size validation", () => {
    it("rejects source text over MAX_SOURCE_CHARS with a typed error", async () => {
      const oversizedInput = {
        ...baseInput,
        sourceText: "x".repeat(MAX_SOURCE_CHARS + 1),
      };

      await expect(
        extractEditorialBriefDraft(oversizedInput),
      ).rejects.toThrow(ExtractionSourceTooLargeError);
    });

    it("includes actual size in the error message", async () => {
      const oversizedInput = {
        ...baseInput,
        sourceText: "x".repeat(MAX_SOURCE_CHARS + 42),
      };

      await expect(
        extractEditorialBriefDraft(oversizedInput),
      ).rejects.toThrow(/200,042/);
    });

    it("allows source text exactly at MAX_SOURCE_CHARS", async () => {
      const exactInput = {
        ...baseInput,
        sourceText: "x".repeat(MAX_SOURCE_CHARS),
      };
      // Mock a response — if the length check passes, we'll hit the LLM call
      mockGenerateCompletion.mockResolvedValueOnce(makeValidResponse());

      await expect(
        extractEditorialBriefDraft(exactInput),
      ).resolves.toBeDefined();

      // Verify we reached the LLM call
      expect(mockGenerateCompletion).toHaveBeenCalledTimes(1);
    });

    it("does not call generateCompletion when source is too large", async () => {
      const oversizedInput = {
        ...baseInput,
        sourceText: "x".repeat(MAX_SOURCE_CHARS + 1),
      };

      await expect(
        extractEditorialBriefDraft(oversizedInput),
      ).rejects.toThrow(ExtractionSourceTooLargeError);

      expect(mockGenerateCompletion).not.toHaveBeenCalled();
    });
  });

  // ── Post-validation: chapter ids ─────────────────────────────────────

  describe("chapter id post-validation", () => {
    it("rejects missing chapter id", async () => {
      mockGenerateCompletion.mockResolvedValue(
        makeValidResponse({
          contracts: [createTestChapterContract(CHAPTER_1_ID)],
        }),
      );

      await expect(
        extractEditorialBriefDraft(baseInput),
      ).rejects.toThrow(ExtractionPostValidationError);

      // Second call with same mock verifies the error message
      await expect(
        extractEditorialBriefDraft(baseInput),
      ).rejects.toThrow(/missing|Missing/);
    });

    it("rejects duplicate chapter id in contracts", async () => {
      mockGenerateCompletion.mockResolvedValue(
        makeValidResponse({
          contracts: [
            createTestChapterContract(CHAPTER_1_ID),
            createTestChapterContract(CHAPTER_1_ID), // duplicate
            createTestChapterContract(CHAPTER_2_ID),
          ],
        }),
      );

      await expect(
        extractEditorialBriefDraft(baseInput),
      ).rejects.toThrow(ExtractionPostValidationError);

      // Second call with same mock verifies the error message
      await expect(
        extractEditorialBriefDraft(baseInput),
      ).rejects.toThrow(/duplicate|Duplicate/i);
    });

    it("rejects foreign chapter id not in supplied context", async () => {
      mockGenerateCompletion.mockResolvedValue(
        makeValidResponse({
          contracts: [
            createTestChapterContract(FOREIGN_ID),
            createTestChapterContract("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
          ],
        }),
      );

      await expect(
        extractEditorialBriefDraft(baseInput),
      ).rejects.toThrow(ExtractionPostValidationError);

      // Second call with same mock verifies the error message
      await expect(
        extractEditorialBriefDraft(baseInput),
      ).rejects.toThrow(/foreign|invented|Foreign/);
    });
  });

  // ── Post-validation: evidence placeholder names ──────────────────────

  describe("evidence need placeholder validation", () => {
    it("rejects evidence need referencing an unavailable placeholder", async () => {
      const badContract = createTestChapterContract(CHAPTER_1_ID, {
        evidenceNeeds: [
          {
            placeholderName: "nonexistent_placeholder",
            query: "some query",
            required: true,
          },
        ],
      });

      mockGenerateCompletion.mockResolvedValueOnce(
        makeValidResponse({
          contracts: [badContract, createTestChapterContract(CHAPTER_2_ID)],
        }),
      );

      await expect(
        extractEditorialBriefDraft(baseInput),
      ).rejects.toThrow(ExtractionPostValidationError);
    });

    it("allows evidence needs referencing only available placeholders", async () => {
      const contract1 = createTestChapterContract(CHAPTER_1_ID, {
        evidenceNeeds: [
          {
            placeholderName: "first_message_stats",
            query: "response rates by first message type",
            required: true,
          },
        ],
      });
      const contract2 = createTestChapterContract(CHAPTER_2_ID, {
        evidenceNeeds: [
          {
            placeholderName: "conversation_openers",
            query: "effective conversation openers",
            required: false,
          },
        ],
      });

      mockGenerateCompletion.mockResolvedValueOnce(
        makeValidResponse({
          contracts: [contract1, contract2],
        }),
      );

      const result = await extractEditorialBriefDraft(baseInput);

      expect(result.contracts).toHaveLength(2);
    });
  });
});
