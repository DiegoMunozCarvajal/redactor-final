import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock setup — hoisted before imports to avoid TDZ
// ---------------------------------------------------------------------------

const mockExecute = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<unknown>>());

vi.mock("@/lib/prompts/executor", () => ({
  executeVersionedPrompt: mockExecute,
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
import { editorialBriefBundleInputSchema } from "../schema";
import type { EditorialBriefBundleInput } from "../schema";
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

function makeMockResult(
  bundle?: EditorialBriefBundleInput,
  executionId?: string,
) {
  return {
    result: {
      data: bundle ?? {
        content: createTestBriefContent(),
        contracts: [
          createTestChapterContract(CHAPTER_1_ID),
          createTestChapterContract(CHAPTER_2_ID),
        ],
        evidenceSourceIds: [],
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
    },
    executionId: executionId ?? "exec-1",
    revision: {
      id: "rev-1",
      definitionId: "def-1",
      kind: "editorial-brief-extractor",
      name: "EditorialBrief Extractor",
      revisionNumber: 1,
      versionLabel: "1.0",
      systemTemplate: "",
      userTemplate: "",
      requiredMarkers: [
        "{{PROJECT_TOPIC}}",
        "{{CHAPTER_CONTEXT}}",
        "{{RESEARCH_DOCUMENT}}",
        "{{OUTPUT_SCHEMA}}",
      ],
      outputContract: "editorial-brief-output",
      configuration: {},
    },
  };
}

const baseInput = {
  sourceText:
    "Research document about dating app conversations.\n\n" +
    "Men who use dating apps often struggle to move from matching to " +
    "meaningful conversation. Studies show response rates drop 50% " +
    "after 24 hours. Personalisation and timing are critical factors.",
  projectId: "proj-1",
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

  // ── Executor invocation ──────────────────────────────────────────────

  describe("executor invocation", () => {
    it("calls executeVersionedPrompt with kind 'editorial-brief-extractor'", async () => {
      mockExecute.mockResolvedValueOnce(makeMockResult());

      await extractEditorialBriefDraft(baseInput);

      expect(mockExecute).toHaveBeenCalledTimes(1);
      const callArg = mockExecute.mock.calls[0][0] as Record<string, unknown>;
      expect(callArg.kind).toBe("editorial-brief-extractor");
    });

    it("passes stage 'editorial-brief-extraction'", async () => {
      mockExecute.mockResolvedValueOnce(makeMockResult());

      await extractEditorialBriefDraft(baseInput);

      const callArg = mockExecute.mock.calls[0][0] as Record<string, unknown>;
      expect(callArg.stage).toBe("editorial-brief-extraction");
    });

    it("passes projectId to executor", async () => {
      mockExecute.mockResolvedValueOnce(makeMockResult());

      await extractEditorialBriefDraft(baseInput);

      const callArg = mockExecute.mock.calls[0][0] as Record<string, unknown>;
      expect(callArg.projectId).toBe("proj-1");
    });

    it("passes revisionId when provided", async () => {
      mockExecute.mockResolvedValueOnce(makeMockResult());

      await extractEditorialBriefDraft({
        ...baseInput,
        promptRevisionId: "custom-rev",
      });

      const callArg = mockExecute.mock.calls[0][0] as Record<string, unknown>;
      expect(callArg.revisionId).toBe("custom-rev");
    });

    it("passes schema to executor", async () => {
      mockExecute.mockResolvedValueOnce(makeMockResult());

      await extractEditorialBriefDraft(baseInput);

      const callArg = mockExecute.mock.calls[0][0] as Record<string, unknown>;
      expect(callArg.schema).toBe(editorialBriefBundleInputSchema);
    });
  });

  // ── Marker values ────────────────────────────────────────────────────

  describe("marker values", () => {
    it("XML-escapes special characters in the RESEARCH_DOCUMENT marker", async () => {
      const inputWithTags = {
        ...baseInput,
        sourceText:
          "Research <script>alert('xss')</script> with & entities",
      };
      mockExecute.mockResolvedValueOnce(makeMockResult());

      await extractEditorialBriefDraft(inputWithTags);

      const callArg = mockExecute.mock.calls[0][0] as Record<string, unknown>;
      const markerValues = callArg.markerValues as Record<string, string>;
      const researchDoc = markerValues["{{RESEARCH_DOCUMENT}}"];
      expect(researchDoc).toContain(
        "&lt;script&gt;alert(&apos;xss&apos;)&lt;/script&gt;",
      );
      expect(researchDoc).toContain("&amp;");
      expect(researchDoc).not.toContain("<script>");
      expect(researchDoc).not.toContain("& entities");
    });

    it("includes the project topic in the PROJECT_TOPIC marker", async () => {
      mockExecute.mockResolvedValueOnce(makeMockResult());

      await extractEditorialBriefDraft(baseInput);

      const callArg = mockExecute.mock.calls[0][0] as Record<string, unknown>;
      const markerValues = callArg.markerValues as Record<string, string>;
      expect(markerValues["{{PROJECT_TOPIC}}"]).toBe(baseInput.projectTopic);
    });

    it("includes chapter titles and placeholder names in the CHAPTER_CONTEXT marker", async () => {
      mockExecute.mockResolvedValueOnce(makeMockResult());

      await extractEditorialBriefDraft(baseInput);

      const callArg = mockExecute.mock.calls[0][0] as Record<string, unknown>;
      const markerValues = callArg.markerValues as Record<string, string>;
      const ctx = markerValues["{{CHAPTER_CONTEXT}}"];
      expect(ctx).toContain("The First Message");
      expect(ctx).toContain("Keeping the Conversation Going");
      expect(ctx).toContain("first_message_stats");
      expect(ctx).toContain("conversation_continuation");
      expect(ctx).toContain("recovery_tips");
    });

    it("passes OUTPUT_SCHEMA marker as serialized JSON schema", async () => {
      mockExecute.mockResolvedValueOnce(makeMockResult());

      await extractEditorialBriefDraft(baseInput);

      const callArg = mockExecute.mock.calls[0][0] as Record<string, unknown>;
      const markerValues = callArg.markerValues as Record<string, string>;
      const schemaVal = markerValues["{{OUTPUT_SCHEMA}}"];
      expect(() => JSON.parse(schemaVal)).not.toThrow();
      const parsed = JSON.parse(schemaVal);
      expect(parsed).toHaveProperty("type");
    });

    it("uses the default model when none is specified", async () => {
      mockExecute.mockResolvedValueOnce(makeMockResult());

      await extractEditorialBriefDraft(baseInput);

      const callArg = mockExecute.mock.calls[0][0] as Record<string, unknown>;
      expect(callArg.model).toBe(DEFAULT_GENERATION_MODEL);
    });

    it("uses the specified model when provided", async () => {
      mockExecute.mockResolvedValueOnce(makeMockResult());

      await extractEditorialBriefDraft({
        ...baseInput,
        model: "claude-opus-4-8",
      });

      const callArg = mockExecute.mock.calls[0][0] as Record<string, unknown>;
      expect(callArg.model).toBe("claude-opus-4-8");
    });
  });

  // ── Data lineage ─────────────────────────────────────────────────────

  describe("data lineage", () => {
    it("records research document hash in lineage", async () => {
      mockExecute.mockResolvedValueOnce(makeMockResult());

      await extractEditorialBriefDraft(baseInput);

      const callArg = mockExecute.mock.calls[0][0] as Record<string, unknown>;
      const lineage = callArg.dataLineage as Record<string, unknown>;
      expect(lineage["{{RESEARCH_DOCUMENT}}"]).toBeDefined();
      const rdLineage = lineage["{{RESEARCH_DOCUMENT}}"] as Record<
        string,
        unknown
      >;
      const sourceHashes = rdLineage.sourceHashes as string[] | undefined;
      expect(sourceHashes).toBeDefined();
      expect(sourceHashes).toHaveLength(1);
      expect(sourceHashes![0]).toMatch(/^[0-9a-f]{64}$/);
    });

    it("records chapter and placeholder IDs in lineage", async () => {
      mockExecute.mockResolvedValueOnce(makeMockResult());

      await extractEditorialBriefDraft(baseInput);

      const callArg = mockExecute.mock.calls[0][0] as Record<string, unknown>;
      const lineage = callArg.dataLineage as Record<string, unknown>;
      expect(lineage["{{CHAPTER_CONTEXT}}"]).toBeDefined();
      const ccLineage = lineage["{{CHAPTER_CONTEXT}}"] as Record<
        string,
        unknown
      >;
      expect(ccLineage.entityIds).toBeDefined();
      expect(ccLineage.entityIds).toContain(CHAPTER_1_ID);
      expect(ccLineage.entityIds).toContain(CHAPTER_2_ID);
      expect(ccLineage.entityIds).toContain("first_message_stats");
      expect(ccLineage.entityIds).toContain("conversation_continuation");
    });
  });

  // ── Successful extraction ────────────────────────────────────────────

  describe("successful extraction", () => {
    it("returns draft with all required structured fields", async () => {
      mockExecute.mockResolvedValueOnce(makeMockResult());

      const result = await extractEditorialBriefDraft(baseInput);

      expect(result).toHaveProperty("draft");
      expect(result).toHaveProperty("executionId");
      expect(result.draft).toHaveProperty("content");
      expect(result.draft).toHaveProperty("contracts");
      expect(result.draft).toHaveProperty("evidenceSourceIds");

      // Content has all 9 top-level sections
      const contentKeys = Object.keys(result.draft.content);
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
      mockExecute.mockResolvedValueOnce(makeMockResult());

      const result = await extractEditorialBriefDraft(baseInput);

      expect(result.draft.contracts).toHaveLength(2);
      const ids = result.draft.contracts.map((c) => c.chapterId);
      expect(ids).toContain(CHAPTER_1_ID);
      expect(ids).toContain(CHAPTER_2_ID);
    });

    it("returns executionId from the executor", async () => {
      mockExecute.mockResolvedValueOnce(makeMockResult(undefined, "exec-custom"));

      const result = await extractEditorialBriefDraft(baseInput);

      expect(result.executionId).toBe("exec-custom");
    });
  });

  // ── Output is always a draft ─────────────────────────────────────────

  describe("draft-only output", () => {
    it("returns empty evidenceSourceIds so sources are bound later via API", async () => {
      // Even if the LLM returns source ids, the function must clear them
      mockExecute.mockResolvedValueOnce(
        makeMockResult({
          content: createTestBriefContent(),
          contracts: [
            createTestChapterContract(CHAPTER_1_ID),
            createTestChapterContract(CHAPTER_2_ID),
          ],
          evidenceSourceIds: [FOREIGN_ID],
        }),
      );

      const result = await extractEditorialBriefDraft(baseInput);

      expect(Array.isArray(result.draft.evidenceSourceIds)).toBe(true);
      expect(result.draft.evidenceSourceIds).toHaveLength(0);
    });

    it("output passes Zod schema validation (output is valid per schema)", async () => {
      mockExecute.mockResolvedValueOnce(makeMockResult());

      const result = await extractEditorialBriefDraft(baseInput);

      const parsed = editorialBriefBundleInputSchema.safeParse(result.draft);
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
      mockExecute.mockResolvedValueOnce(makeMockResult());

      await expect(
        extractEditorialBriefDraft(exactInput),
      ).resolves.toBeDefined();

      // Verify we reached the executor call
      expect(mockExecute).toHaveBeenCalledTimes(1);
    });

    it("does not call executeVersionedPrompt when source is too large", async () => {
      const oversizedInput = {
        ...baseInput,
        sourceText: "x".repeat(MAX_SOURCE_CHARS + 1),
      };

      await expect(
        extractEditorialBriefDraft(oversizedInput),
      ).rejects.toThrow(ExtractionSourceTooLargeError);

      expect(mockExecute).not.toHaveBeenCalled();
    });
  });

  // ── Post-validation: chapter ids ─────────────────────────────────────

  describe("chapter id post-validation", () => {
    it("rejects missing chapter id", async () => {
      mockExecute.mockResolvedValue(
        makeMockResult({
          content: createTestBriefContent(),
          contracts: [createTestChapterContract(CHAPTER_1_ID)],
          evidenceSourceIds: [],
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
      mockExecute.mockResolvedValue(
        makeMockResult({
          content: createTestBriefContent(),
          contracts: [
            createTestChapterContract(CHAPTER_1_ID),
            createTestChapterContract(CHAPTER_1_ID), // duplicate
            createTestChapterContract(CHAPTER_2_ID),
          ],
          evidenceSourceIds: [],
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
      mockExecute.mockResolvedValue(
        makeMockResult({
          content: createTestBriefContent(),
          contracts: [
            createTestChapterContract(FOREIGN_ID),
            createTestChapterContract(
              "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            ),
          ],
          evidenceSourceIds: [],
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

      mockExecute.mockResolvedValueOnce(
        makeMockResult({
          content: createTestBriefContent(),
          contracts: [badContract, createTestChapterContract(CHAPTER_2_ID)],
          evidenceSourceIds: [],
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

      mockExecute.mockResolvedValueOnce(
        makeMockResult({
          content: createTestBriefContent(),
          contracts: [contract1, contract2],
          evidenceSourceIds: [],
        }),
      );

      const result = await extractEditorialBriefDraft(baseInput);

      expect(result.draft.contracts).toHaveLength(2);
    });
  });
});
