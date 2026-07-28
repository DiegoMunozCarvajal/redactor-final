
import { describe, it, expect } from "vitest";
import { renderEditorialData } from "../render";
import { hashEditorialBundle } from "../hash";
import {
  createTestEditorialBundle,
  createTestEditorialBundleV3,
  createTestBriefContent,
  TEST_CHAPTER_1_ID,
} from "./fixtures";
import type { EditorialBundle } from "../schema";

function getBundles(): { bundle: EditorialBundle; hash: string } {
  const bundle = createTestEditorialBundle();
  const hashValue = hashEditorialBundle(bundle);
  return {
    bundle: { ...bundle, hash: hashValue },
    hash: hashValue,
  };
}

describe("renderEditorialData", () => {
  it("returns null for a null bundle", () => {
    expect(renderEditorialData(null, {})).toBeNull();
  });

  it("wraps output in editorial_context tags with version and hash", () => {
    const { bundle, hash } = getBundles();
    const result = renderEditorialData(bundle, {
      chapterId: TEST_CHAPTER_1_ID,
    });
    expect(result).toContain(
      `<editorial_context version="${bundle.version}" hash="${hash}">`,
    );
    expect(result).toContain("</editorial_context>");
  });

  it("includes all data sections", () => {
    const { bundle } = getBundles();
    const result = renderEditorialData(bundle, {
      chapterId: TEST_CHAPTER_1_ID,
    });

    // Market
    expect(result).toContain("United States");
    expect(result).toContain("English");
    // Audience
    expect(result).toContain("Men aged 25-40");
    expect(result).toContain("Matches fizzle out");
    // Thesis / promise
    expect(result).toContain("Turn every match");
    expect(result).toContain("Not every match will respond");
    // Voice
    expect(result).toContain("Direct");
    expect(result).toContain("Confident peer");
    // Content strategy
    expect(result).toContain("First message");
    expect(result).toContain("Principle + example pattern");
    // Guardrails
    expect(result).toContain("Reciprocity");
    expect(result).toContain("Guaranteed results");
    // Evidence
    expect(result).toContain("rag_optional");
    expect(result).toContain("Cite specific studies");
    // Packaging
    expect(result).toContain("How to turn matches into dates");
    expect(result).toContain("Stop losing matches");
    // Research basis
    expect(result).toContain("70% of matches never message first");
    expect(result).toContain("Self-reported data");
  });

  it("includes chapter contract", () => {
    const { bundle } = getBundles();
    const result = renderEditorialData(bundle, {
      chapterId: TEST_CHAPTER_1_ID,
    });
    expect(result).toContain("Craft the first message after matching");
    expect(result).toContain("first_message_stats");
  });

  it("renders <content_strategy> and <evidence> for v2 bundle", () => {
    const { bundle } = getBundles();
    const result = renderEditorialData(bundle, {
      chapterId: TEST_CHAPTER_1_ID,
    });
    expect(result).toContain("<content_strategy>");
    expect(result).toContain("</content_strategy>");
    expect(result).toContain("<evidence>");
    expect(result).toContain("</evidence>");
  });

  it("does NOT include authority tag", () => {
    const { bundle } = getBundles();
    const result = renderEditorialData(bundle, {
      chapterId: TEST_CHAPTER_1_ID,
    });
    expect(result).not.toContain("<authority>");
    expect(result).not.toContain("</authority>");
  });

  it("does NOT include any instruction tags", () => {
    const { bundle } = getBundles();
    const result = renderEditorialData(bundle, {
      chapterId: TEST_CHAPTER_1_ID,
    });
    expect(result).not.toContain("assembly_instructions");
    expect(result).not.toContain("adherence_rubric");
    expect(result).not.toContain("correction_instructions");
    expect(result).not.toContain("fragment_instructions");
    expect(result).not.toContain("title_instructions");
    expect(result).not.toContain("placeholder_fill_instructions");
  });

  it("throws when chapterId is given but contract is not found", () => {
    const { bundle } = getBundles();
    const missingId = "99999999-9999-9999-9999-999999999999";
    expect(() =>
      renderEditorialData(bundle, { chapterId: missingId }),
    ).toThrow("Chapter contract not found");
  });

  it("still works without chapterId (no contract)", () => {
    const { bundle } = getBundles();
    const result = renderEditorialData(bundle, {});
    expect(result).toContain("United States");
    expect(result).toContain("Direct");
    // No chapter contract data
    expect(result).not.toContain("Craft the first message after matching");
  });

  it("escapes XML special characters in values", () => {
    const bundle = createTestEditorialBundle({
      content: {
        audience: {
          primaryReader:
            "Men & women < 30 years old who say \"it's too much\"",
        },
      },
    });
    const { bundle: hashedBundle } = (() => {
      const h = hashEditorialBundle(bundle);
      return { bundle: { ...bundle, hash: h } };
    })();
    const result = renderEditorialData(hashedBundle, {
      chapterId: TEST_CHAPTER_1_ID,
    });

    expect(result).toContain("Men &amp; women");
    expect(result).toContain("&lt; 30 years old");
    expect(result).not.toContain("Men & women");
  });
});

function getV3Bundle(): { bundle: EditorialBundle; hash: string } {
  const bundle = createTestEditorialBundleV3();
  const hashValue = hashEditorialBundle(bundle);
  return {
    bundle: { ...bundle, hash: hashValue },
    hash: hashValue,
  };
}

describe("renderEditorialData with v3 bundle", () => {
  it("contains <topic_knowledge>, <scenario_catalog>, <evidence_gaps>", () => {
    const { bundle } = getV3Bundle();
    const result = renderEditorialData(bundle, {});
    expect(result).toContain("<topic_knowledge>");
    expect(result).toContain("</topic_knowledge>");
    expect(result).toContain("<scenario_catalog>");
    expect(result).toContain("</scenario_catalog>");
    expect(result).toContain("<evidence_gaps>");
    expect(result).toContain("</evidence_gaps>");
  });

  it("does NOT contain <chapter_contract>, <content_strategy>, <evidence>", () => {
    const { bundle } = getV3Bundle();
    const result = renderEditorialData(bundle, {});
    expect(result).not.toContain("<chapter_contract>");
    expect(result).not.toContain("<content_strategy>");
    expect(result).not.toContain("<evidence>");
  });

  it("works without chapterId param (no contract rendered)", () => {
    const { bundle } = getV3Bundle();
    const withoutChapterId = renderEditorialData(bundle, {});
    const withChapterId = renderEditorialData(bundle, {
      chapterId: TEST_CHAPTER_1_ID,
    });

    // Both should succeed and contain v3 sections
    expect(withoutChapterId).toContain("<topic_knowledge>");
    expect(withChapterId).toContain("<topic_knowledge>");
    // Neither should contain chapter_contract — v3 ignores chapterId
    expect(withoutChapterId).not.toContain("<chapter_contract>");
    expect(withChapterId).not.toContain("<chapter_contract>");
  });

  it("does NOT include instruction tags in v3 mode", () => {
    const { bundle } = getV3Bundle();
    const result = renderEditorialData(bundle, {});
    expect(result).not.toContain("assembly_instructions");
    expect(result).not.toContain("placeholder_fill_instructions");
    expect(result).not.toContain("adherence_rubric");
  });

  it("renders v3 topicKnowledge data values", () => {
    const { bundle } = getV3Bundle();
    const result = renderEditorialData(bundle, {});

    // topicKnowledge fields
    expect(result).toContain("Conversation threading");
    expect(result).toContain("ghosting");
    expect(result).toContain("IOI");

    // scenarioCatalog data
    expect(result).toContain("After mutual match, no message sent yet");

    // evidenceGaps data
    expect(result).toContain("first message response rate dating apps");
  });

  it("renders <editorial_context> with correct version and hash", () => {
    const { bundle, hash } = getV3Bundle();
    const result = renderEditorialData(bundle, {});
    expect(result).toContain(
      `<editorial_context version="${bundle.version}" hash="${hash}">`,
    );
  });
});
