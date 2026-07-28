import { describe, it, expect } from "vitest";
import {
  editorialBriefContentSchema,
  editorialBriefContentSchemaV3,
  editorialBriefContentWriteSchemaV3,
  chapterEditorialContractSchema,
  editorialBriefBundleInputSchema,
  editorialSnapshotSchema,
  isEditorialBriefContentV3,
  type EditorialBriefContentV3,
} from "../schema";
import {
  createTestBriefContent,
  createTestBriefContentV3,
  createTestChapterContract,
  TEST_CHAPTER_1_ID,
  TEST_CHAPTER_2_ID,
  TEST_BRIEF_ID,
} from "./fixtures";

describe("editorialBriefContentSchema", () => {
  it("validates a complete valid brief content", () => {
    const data = createTestBriefContent();
    const result = editorialBriefContentSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it("rejects unknown fields (strict mode)", () => {
    const data = { ...createTestBriefContent(), rogueField: "nope" };
    const result = editorialBriefContentSchema.safeParse(data);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => /unexpected|unrecognized/i.test(m))).toBe(
        true,
      );
    }
  });

  it("rejects empty required strings", () => {
    const data = createTestBriefContent({ market: { region: "" } });
    const result = editorialBriefContentSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("rejects empty audience.primaryReader", () => {
    const data = createTestBriefContent({
      audience: { primaryReader: "" },
    });
    const result = editorialBriefContentSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("rejects excessive string length", () => {
    const data = createTestBriefContent({
      audience: { primaryReader: "x".repeat(2001) },
    });
    const result = editorialBriefContentSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("rejects excessive array size", () => {
    const data = createTestBriefContent({
      audience: { objections: Array.from({ length: 51 }, () => "an objection") },
    });
    const result = editorialBriefContentSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("rejects invalid evidence mode", () => {
    const data = createTestBriefContent({
      evidence: { mode: "rag_only" as "rag_optional" },
    });
    const result = editorialBriefContentSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("preserves researchLanguage vs manuscriptLanguage distinction", () => {
    const data = createTestBriefContent({
      market: {
        researchLanguage: "English",
        manuscriptLanguage: "Spanish",
      },
    });
    const result = editorialBriefContentSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.market.researchLanguage).toBe("English");
      expect(result.data.market.manuscriptLanguage).toBe("Spanish");
    }
  });

  it("rejects missing researchLanguage", () => {
    const valid = createTestBriefContent();
    const marketNoLang: Partial<typeof valid.market> = { ...valid.market };
    delete marketNoLang.researchLanguage;
    const data = {
      ...valid,
      market: marketNoLang,
    };
    const result = editorialBriefContentSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("rejects missing manuscriptLanguage", () => {
    const valid = createTestBriefContent();
    const marketNoManu: Partial<typeof valid.market> = { ...valid.market };
    delete marketNoManu.manuscriptLanguage;
    const data = {
      ...valid,
      market: marketNoManu,
    };
    const result = editorialBriefContentSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});

describe("chapterEditorialContractSchema", () => {
  it("validates a complete valid contract", () => {
    const data = createTestChapterContract(TEST_CHAPTER_1_ID);
    const result = chapterEditorialContractSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it("requires a valid UUID chapterId", () => {
    const data = createTestChapterContract("not-a-uuid");
    const result = chapterEditorialContractSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("normalizes chapterId UUIDs to lowercase", () => {
    const result = chapterEditorialContractSchema.parse(
      createTestChapterContract("A1B2C3D4-E5F6-4A7B-8C9D-A1B2C3D4E5F6"),
    );

    expect(result.chapterId).toBe(
      "a1b2c3d4-e5f6-4a7b-8c9d-a1b2c3d4e5f6",
    );
  });

  it("rejects unknown fields", () => {
    const data = {
      ...createTestChapterContract(TEST_CHAPTER_1_ID),
      rogue: true,
    };
    const result = chapterEditorialContractSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("rejects empty jobToBeDone", () => {
    const data = createTestChapterContract(TEST_CHAPTER_1_ID, {
      jobToBeDone: "",
    });
    const result = chapterEditorialContractSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("rejects evidence need with empty query", () => {
    const data = createTestChapterContract(TEST_CHAPTER_1_ID, {
      evidenceNeeds: [
        {
          placeholderName: "test",
          query: "",
          required: true,
        },
      ],
    });
    const result = chapterEditorialContractSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("rejects excessive mustCover items", () => {
    const data = createTestChapterContract(TEST_CHAPTER_1_ID, {
      mustCover: Array.from({ length: 51 }, (_, i) => `Item ${i}`),
    });
    const result = chapterEditorialContractSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});

describe("editorialBriefBundleInputSchema", () => {
  it("validates a complete bundle input", () => {
    const result = editorialBriefBundleInputSchema.safeParse({
      content: createTestBriefContent(),
      contracts: [
        createTestChapterContract(TEST_CHAPTER_1_ID),
        createTestChapterContract(TEST_CHAPTER_2_ID),
      ],
      evidenceSourceIds: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects duplicate chapter ids", () => {
    const result = editorialBriefBundleInputSchema.safeParse({
      content: createTestBriefContent(),
      contracts: [
        createTestChapterContract(TEST_CHAPTER_1_ID),
        createTestChapterContract(TEST_CHAPTER_1_ID),
      ],
      evidenceSourceIds: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) =>
          i.message.toLowerCase().includes("duplicate"),
        ),
      ).toBe(true);
    }
  });

  it("rejects duplicate chapter ids that differ only by case", () => {
    const chapterId = "A1B2C3D4-E5F6-4A7B-8C9D-A1B2C3D4E5F6";
    const result = editorialBriefBundleInputSchema.safeParse({
      content: createTestBriefContent(),
      contracts: [
        createTestChapterContract(chapterId),
        createTestChapterContract(chapterId.toLowerCase()),
      ],
      evidenceSourceIds: [],
    });

    expect(result.success).toBe(false);
  });

  it("normalizes evidence source UUIDs to lowercase", () => {
    const result = editorialBriefBundleInputSchema.parse({
      content: createTestBriefContent(),
      contracts: [createTestChapterContract(TEST_CHAPTER_1_ID)],
      evidenceSourceIds: [
        "B1B2C3D4-E5F6-4A7B-8C9D-A1B2C3D4E5F6",
      ],
    });

    expect(result.evidenceSourceIds).toEqual([
      "b1b2c3d4-e5f6-4a7b-8c9d-a1b2c3d4e5f6",
    ]);
  });

  it("rejects duplicate evidence source ids", () => {
    const sourceId = "b1b2c3d4-e5f6-4a7b-8c9d-a1b2c3d4e5f6";
    const result = editorialBriefBundleInputSchema.safeParse({
      content: createTestBriefContent(),
      contracts: [createTestChapterContract(TEST_CHAPTER_1_ID)],
      evidenceSourceIds: [sourceId, sourceId],
    });

    expect(result.success).toBe(false);
  });

  it("rejects duplicate evidence source ids that differ only by case", () => {
    const sourceId = "B1B2C3D4-E5F6-4A7B-8C9D-A1B2C3D4E5F6";
    const result = editorialBriefBundleInputSchema.safeParse({
      content: createTestBriefContent(),
      contracts: [createTestChapterContract(TEST_CHAPTER_1_ID)],
      evidenceSourceIds: [sourceId, sourceId.toLowerCase()],
    });

    expect(result.success).toBe(false);
  });

  it("rejects unknown fields in bundle", () => {
    const result = editorialBriefBundleInputSchema.safeParse({
      content: createTestBriefContent(),
      contracts: [createTestChapterContract(TEST_CHAPTER_1_ID)],
      evidenceSourceIds: [],
      unknownField: true,
    });
    expect(result.success).toBe(false);
  });
});

describe("editorialSnapshotSchema", () => {
  it("validates a valid snapshot", () => {
    const result = editorialSnapshotSchema.safeParse({
      editorialBriefId: TEST_BRIEF_ID,
      editorialBriefVersion: 3,
      editorialBriefHash:
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-uuid briefId", () => {
    const result = editorialSnapshotSchema.safeParse({
      editorialBriefId: "nope",
      editorialBriefVersion: 1,
      editorialBriefHash:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-positive version", () => {
    const result = editorialSnapshotSchema.safeParse({
      editorialBriefId: TEST_BRIEF_ID,
      editorialBriefVersion: 0,
      editorialBriefHash:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-64-char hash", () => {
    const result = editorialSnapshotSchema.safeParse({
      editorialBriefId: TEST_BRIEF_ID,
      editorialBriefVersion: 1,
      editorialBriefHash: "too-short",
    });
    expect(result.success).toBe(false);
  });

  it("rejects hash with non-hex characters", () => {
    const result = editorialSnapshotSchema.safeParse({
      editorialBriefId: TEST_BRIEF_ID,
      editorialBriefVersion: 1,
      editorialBriefHash:
        "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
    });
    expect(result.success).toBe(false);
  });
});

describe("editorialBriefContentSchemaV3", () => {
  it("accepts v3 content with all required fields", () => {
    const data = createTestBriefContentV3();
    const result = editorialBriefContentSchemaV3.safeParse(data);
    expect(result.success).toBe(true);
  });

  it("rejects v3 content missing schemaVersion", () => {
    const data = createTestBriefContentV3();
    const { schemaVersion: _, ...noVersion } = data as Record<string, unknown>;
    const result = editorialBriefContentSchemaV3.safeParse(noVersion);
    expect(result.success).toBe(false);
  });

  it("rejects v3 content missing topicKnowledge", () => {
    const data = createTestBriefContentV3();
    const { topicKnowledge: _, ...noTk } = data as Record<string, unknown>;
    const result = editorialBriefContentSchemaV3.safeParse(noTk);
    expect(result.success).toBe(false);
  });

  it("rejects v3 content with extra unknown fields (strict mode)", () => {
    const data = { ...createTestBriefContentV3(), rogueField: "nope" };
    const result = editorialBriefContentSchemaV3.safeParse(data);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => /unexpected|unrecognized/i.test(i.message)),
      ).toBe(true);
    }
  });
});

describe("editorialBriefContentWriteSchemaV3", () => {
  it("requires centralTopic with min(1)", () => {
    const result = editorialBriefContentWriteSchemaV3.safeParse({
      ...createTestBriefContentV3(),
      centralTopic: "",
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid minimal content with centralTopic set", () => {
    const data = createTestBriefContentV3();
    const result = editorialBriefContentWriteSchemaV3.safeParse(data);
    expect(result.success).toBe(true);
  });
});

describe("isEditorialBriefContentV3", () => {
  it("returns true for object with schemaVersion: '3.0'", () => {
    const data = createTestBriefContentV3();
    expect(isEditorialBriefContentV3(data)).toBe(true);
  });

  it("returns false for object without schemaVersion", () => {
    const data = createTestBriefContentV3();
    const { schemaVersion: _, ...noVersion } = data;
    expect(isEditorialBriefContentV3(noVersion as unknown as EditorialBriefContentV3)).toBe(false);
  });

  it("returns false for v2 content shape (has contentStrategy, evidence but no schemaVersion)", () => {
    const data = createTestBriefContent();
    expect(isEditorialBriefContentV3(data)).toBe(false);
  });
});
