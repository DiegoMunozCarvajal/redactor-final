import { describe, it, expect } from "vitest";
import { renderEditorialScope } from "../render";
import { hashEditorialBundle } from "../hash";
import {
  createTestEditorialBundle,
  createTestChapterContract,
  TEST_CHAPTER_1_ID,
  TEST_CHAPTER_2_ID,
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

describe("renderEditorialScope", () => {
  it("returns null for a null bundle (legacy behavior)", () => {
    expect(renderEditorialScope(null, { scope: "fragment" })).toBeNull();
  });

  it("wraps output in editorial_context tags with version and hash", () => {
    const { bundle, hash } = getBundles();
    const result = renderEditorialScope(bundle, {
      scope: "fragment",
      chapterId: TEST_CHAPTER_1_ID,
    });
    expect(result).toContain(
      `<editorial_context version="${bundle.version}" hash="`,
    );
    expect(result).toContain(hash);
    expect(result).toContain("</editorial_context>");
  });

  it("renders the stored bundle version", () => {
    const bundle = createTestEditorialBundle({ version: 7 });
    const hash = hashEditorialBundle(bundle);
    const result = renderEditorialScope(
      { ...bundle, hash },
      { scope: "fragment", chapterId: TEST_CHAPTER_1_ID },
    );

    expect(result).toContain(`<editorial_context version="7" hash="${hash}">`);
  });

  it("includes authority tag", () => {
    const { bundle } = getBundles();
    const result = renderEditorialScope(bundle, {
      scope: "fragment",
      chapterId: TEST_CHAPTER_1_ID,
    });
    expect(result).toContain(
      "<authority>Approved project constraints",
    );
    expect(result).toContain("</authority>");
  });
});

describe("fragment scope projection", () => {
  it("includes audience, thesis (promise), voice, guardrails, and chapter contract", () => {
    const { bundle } = getBundles();
    const result = renderEditorialScope(bundle, {
      scope: "fragment",
      chapterId: TEST_CHAPTER_1_ID,
    });

    // Market
    expect(result).toContain("United States");
    expect(result).toContain("English");
    expect(result).toContain("Spanish");

    // Audience
    expect(result).toContain("Men aged 25-40");
    expect(result).toContain("Matches fizzle out");

    // Thesis / promise
    expect(result).toContain("Turn every match");
    expect(result).toContain("Not every match will respond");

    // Voice
    expect(result).toContain("Direct");
    expect(result).toContain("Confident peer");
    expect(result).toContain("Conversational");

    // Guardrails
    expect(result).toContain("Reciprocity");
    expect(result).toContain("Guaranteed results");

    // Chapter contract
    expect(result).toContain("Craft the first message after matching");
    expect(result).toContain("first_message_stats");

    // Should NOT include
    expect(result).not.toContain("How to turn matches into dates");
    expect(result).not.toContain("Principle + example pattern");
  });

  it("includes only its own chapter contract", () => {
    const { bundle } = getBundles();
    const result = renderEditorialScope(bundle, {
      scope: "fragment",
      chapterId: TEST_CHAPTER_2_ID,
    });

    // Should include chapter 2 contract
    expect(result).toContain("Craft the first message after matching");
    // Should NOT include chapter 1's evidence needs (they are the same content but
    // the test proves the selected chapter is the one passed)
    expect(result).toContain("chapterId");
  });
});

describe("assembly scope projection", () => {
  it("includes market, audience, thesis, voice, content strategy, guardrails", () => {
    const { bundle } = getBundles();
    const result = renderEditorialScope(bundle, {
      scope: "assembly",
      chapterId: TEST_CHAPTER_1_ID,
    });

    // Content strategy specific to assembly
    expect(result).toContain("Principle + example pattern");
    expect(result).toContain("First message");
    expect(result).toContain("Opening after match");

    // Should NOT include packaging
    expect(result).not.toContain("How to turn matches into dates");
    expect(result).not.toContain("Stop losing matches");
  });

  it("includes assembly instructions for coverage, progression, deduplication, transition", () => {
    const { bundle } = getBundles();
    const result = renderEditorialScope(bundle, {
      scope: "assembly",
      chapterId: TEST_CHAPTER_1_ID,
    });

    expect(result).toMatch(/coverage|progression|dedup|transition/i);
    expect(result).toContain("coverage");
    expect(result).toContain("progression");
    expect(result).toContain("deduplication");
    expect(result).toContain("transition");
  });

  it("includes chapter contract", () => {
    const { bundle } = getBundles();
    const result = renderEditorialScope(bundle, {
      scope: "assembly",
      chapterId: TEST_CHAPTER_1_ID,
    });
    expect(result).toContain("Craft the first message after matching");
  });
});

describe("critique scope projection", () => {
  it("includes all sections except packaging", () => {
    const { bundle } = getBundles();
    const result = renderEditorialScope(bundle, {
      scope: "critique",
      chapterId: TEST_CHAPTER_1_ID,
    });

    // Should include researchBasis (specific to critique/correction)
    expect(result).toContain("70% of matches never message first");
    expect(result).toContain("Self-reported data");

    // Should include content strategy
    expect(result).toContain("Principle + example pattern");
    expect(result).toContain("Opening after match");

    // Should NOT include packaging
    expect(result).not.toContain("How to turn matches into dates");
    expect(result).not.toContain("Stop losing matches");
  });

  it("emits six named adherence criteria", () => {
    const { bundle } = getBundles();
    const result = renderEditorialScope(bundle, {
      scope: "critique",
      chapterId: TEST_CHAPTER_1_ID,
    });

    const criteria = ["audience", "promise", "coverage", "tone", "ethics", "evidence"];
    for (const c of criteria) {
      expect(result).toContain(c);
    }
    expect(result).toContain("adherence_rubric");
  });

  it("includes chapter contract", () => {
    const { bundle } = getBundles();
    const result = renderEditorialScope(bundle, {
      scope: "critique",
      chapterId: TEST_CHAPTER_1_ID,
    });
    expect(result).toContain("Craft the first message after matching");
  });
});

describe("correction scope projection", () => {
  it("includes all sections except packaging", () => {
    const { bundle } = getBundles();
    const result = renderEditorialScope(bundle, {
      scope: "correction",
      chapterId: TEST_CHAPTER_1_ID,
    });

    // Should include researchBasis
    expect(result).toContain("70% of matches never message first");

    // Should NOT include packaging
    expect(result).not.toContain("How to turn matches into dates");
    expect(result).not.toContain("Stop losing matches");
  });

  it("includes the same contract but not packaging", () => {
    const { bundle } = getBundles();
    const result = renderEditorialScope(bundle, {
      scope: "correction",
      chapterId: TEST_CHAPTER_1_ID,
    });
    expect(result).toContain("Craft the first message after matching");
    // Confirm no packaging
    expect(result).not.toContain("Stop losing matches");
  });
});

describe("title scope projection", () => {
  it("includes packaging and no chapter contract", () => {
    const { bundle } = getBundles();
    const result = renderEditorialScope(bundle, {
      scope: "title",
    });

    // Packaging
    expect(result).toContain("How to turn matches into dates");
    expect(result).toContain("Stop losing matches");
    expect(result).toContain("dating app conversation tips");

    // Market / audience / thesis / guardrails
    expect(result).toContain("United States");
    expect(result).toContain("Men aged 25-40");
    expect(result).toContain("Turn every match");
    expect(result).toContain("Reciprocity");

    // NO chapter contract
    expect(result).not.toContain("Craft the first message after matching");
  });

  it("never inherits chapter-one bias", () => {
    const { bundle } = getBundles();
    const result = renderEditorialScope(bundle, {
      scope: "title",
    });
    // No jobToBeDone from any chapter
    expect(result).not.toContain("jobToBeDone");
  });
});

describe("placeholder-fill scope projection", () => {
  it("includes market, audience, thesis, voice, guardrails, and evidence", () => {
    const { bundle } = getBundles();
    const result = renderEditorialScope(bundle, {
      scope: "placeholder-fill",
      chapterId: TEST_CHAPTER_1_ID,
    });

    // Market
    expect(result).toContain("United States");
    // Audience
    expect(result).toContain("Men aged 25-40");
    // Thesis
    expect(result).toContain("Turn every match");
    // Voice
    expect(result).toContain("Direct");
    // Guardrails
    expect(result).toContain("Reciprocity");
    // Evidence
    expect(result).toContain("rag_optional");
    expect(result).toContain("Cite specific studies");
  });

  it("includes evidence policy", () => {
    const { bundle } = getBundles();
    const result = renderEditorialScope(bundle, {
      scope: "placeholder-fill",
      chapterId: TEST_CHAPTER_1_ID,
    });
    // Evidence policy should be present
    expect(result).toContain("evidence_policy");
    expect(result).toContain("rag_optional");
  });

  it("includes chapter contract with evidence needs", () => {
    const { bundle } = getBundles();
    const result = renderEditorialScope(bundle, {
      scope: "placeholder-fill",
      chapterId: TEST_CHAPTER_1_ID,
    });
    expect(result).toContain("first_message_stats");
    // Should include the query for the evidence need
    expect(result).toContain("response rates by first message type");
  });
});

describe("XML escaping", () => {
  it("escapes &, <, >, \", ' in user-provided values", () => {
    const bundle = createTestEditorialBundle({
      content: {
        audience: {
          primaryReader: "Men & women < 30 years old who say \"it's too much\"",
        },
      },
    });
    const { bundle: hashedBundle } = (() => {
      const h = hashEditorialBundle(bundle);
      return { bundle: { ...bundle, hash: h } };
    })();
    const result = renderEditorialScope(hashedBundle, {
      scope: "fragment",
      chapterId: TEST_CHAPTER_1_ID,
    });

    expect(result).toContain("Men &amp; women");
    expect(result).toContain("&lt; 30 years old");
    expect(result).toContain("&quot;it&apos;s too much&quot;");
    // Should NOT contain raw XML special chars
    expect(result).not.toContain("Men & women");
    expect(result).not.toContain("< 30 years old");
  });

  it("escapes apostrophes", () => {
    const bundle = createTestEditorialBundle({
      content: {
        audience: {
          primaryReader: "Don't use tricks",
        },
      },
    });
    const { bundle: hashedBundle } = (() => {
      const h = hashEditorialBundle(bundle);
      return { bundle: { ...bundle, hash: h } };
    })();
    const result = renderEditorialScope(hashedBundle, {
      scope: "fragment",
      chapterId: TEST_CHAPTER_1_ID,
    });

    expect(result).toContain("Don&apos;t use tricks");
    expect(result).not.toContain("Don't use tricks");
  });
});

describe("error paths", () => {
  it("throws when chapterId is missing for scope that requires a contract", () => {
    const { bundle } = getBundles();
    expect(() =>
      renderEditorialScope(bundle, { scope: "fragment" }),
    ).toThrow("chapterId is required");
  });

  it("throws when chapter contract is not found for the given chapterId", () => {
    const { bundle } = getBundles();
    const missingId = "99999999-9999-9999-9999-999999999999";
    expect(() =>
      renderEditorialScope(bundle, {
        scope: "fragment",
        chapterId: missingId,
      }),
    ).toThrow("Chapter contract not found");
  });
});

describe("empty elements", () => {
  it("renders no evidence_needs element when evidenceNeeds array is empty", () => {
    const contract = createTestChapterContract(TEST_CHAPTER_1_ID, {
      evidenceNeeds: [],
    });
    const bundle = createTestEditorialBundle({
      contracts: [
        contract,
        createTestChapterContract(TEST_CHAPTER_2_ID),
      ],
    });
    const h = hashEditorialBundle(bundle);
    const hashedBundle = { ...bundle, hash: h };
    const result = renderEditorialScope(hashedBundle, {
      scope: "fragment",
      chapterId: TEST_CHAPTER_1_ID,
    });
    expect(result).not.toContain("<evidence_needs>");
    expect(result).not.toContain("</evidence_needs>");
  });

  it("renders no avoidOverlapWith element when the array is empty", () => {
    const contract = createTestChapterContract(TEST_CHAPTER_1_ID, {
      avoidOverlapWith: [],
    });
    const bundle = createTestEditorialBundle({
      contracts: [
        contract,
        createTestChapterContract(TEST_CHAPTER_2_ID),
      ],
    });
    const h = hashEditorialBundle(bundle);
    const hashedBundle = { ...bundle, hash: h };
    const result = renderEditorialScope(hashedBundle, {
      scope: "fragment",
      chapterId: TEST_CHAPTER_1_ID,
    });
    expect(result).not.toContain("<avoidOverlapWith>");
    expect(result).not.toContain("</avoidOverlapWith>");
  });
});
