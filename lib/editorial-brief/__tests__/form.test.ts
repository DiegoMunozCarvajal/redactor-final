import { describe, it, expect } from "vitest";
import {
  formToContent,
  contentToForm,
  formToContracts,
  contractToForm,
} from "../form";
import type {
  EditorialBriefContent,
  ChapterEditorialContract,
} from "../schema";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const FULL_CONTENT: EditorialBriefContent = {
  market: {
    region: "United States",
    researchLanguage: "English",
    manuscriptLanguage: "Spanish",
  },
  audience: {
    primaryReader: "Men aged 25-40 who use dating apps",
    situation: "They matched but do not know how to start a conversation",
    pain: "Matches fizzle out because they run out of things to say",
    awareness: "They know they need to message first but lack a framework",
    objections: [
      "It feels fake to use conversation techniques",
      "I should just be myself",
    ],
  },
  thesis: {
    coreProblem: "Men lack a conversational framework for dating app interactions",
    desiredOutcome: "Confident, natural conversation leading to dates",
    promise: "Turn every match into a meaningful conversation within 7 days",
    mechanism: [
      "Principle-based adaptable frameworks",
      "Specific conversation openers",
      "Escalation patterns",
    ],
    realisticBoundary: "Not every match will respond; external factors matter",
  },
  voice: {
    tone: ["Direct", "Socially calibrated", "Practical"],
    posture: "Confident peer, not guru",
    readingLevel: "Conversational",
    avoid: ["Pickup artist jargon", "Manipulation tactics", "Overly formal language"],
  },
  contentStrategy: {
    pillars: ["First message", "Continued exchange", "Date transition", "In-person conversation"],
    requiredScenarios: ["Opening after match", "Recovering from silence", "Asking for the date"],
    recurringPattern: ["Principle + example pattern", "Do/don't comparison"],
    examplePolicy: "Realistic examples, not idealized scripts",
  },
  guardrails: {
    ethicalPrinciples: ["Reciprocity", "Respect", "Honesty"],
    forbiddenClaims: ["Guaranteed results", "100% success rate"],
    forbiddenFraming: ["Tricks or hacks", "Game playing", "Manipulation"],
  },
  evidence: {
    mode: "rag_optional",
    citationPolicy: "Cite specific studies when making factual claims",
  },
  packaging: {
    titleAngle: "How to turn matches into dates",
    hook: "Stop losing matches to awkward silences",
    seoTerms: ["dating app conversation tips", "first message examples", "how to keep conversation going"],
  },
  researchBasis: {
    findings: ["70% of matches never message first", "Response rates drop 50% after 24 hours"],
    inferences: ["Timing and personalization are critical", "Men overthink first messages"],
    limitations: ["Self-reported data from small sample", "US-centric trends"],
  },
};

const FULL_CONTRACT: ChapterEditorialContract = {
  chapterId: "22222222-2222-2222-2222-222222222222",
  jobToBeDone: "Craft the first message after matching",
  readerShift: "From anxiety to having a reliable framework",
  mustCover: ["Why first messages matter", "Personalization techniques", "Timing considerations"],
  requiredScenarios: ["Mutual match with no message", "Re-engaging after a day"],
  evidenceNeeds: [
    { placeholderName: "first_message_stats", query: "response rates by first message type", required: true },
    { placeholderName: "conversation_openers", query: "effective conversation openers", required: false },
  ],
  toneAdjustment: "More directive in first message section",
  avoidOverlapWith: [],
  transitionToNext: "Once the message is sent, the reader needs to handle the reply",
};

describe("formToContent", () => {
  it("converts newline fields to arrays", () => {
    const form = contentToForm(FULL_CONTENT);
    const result = formToContent(form);

    // Arrays should be identical
    expect(result.audience.objections).toEqual(FULL_CONTENT.audience.objections);
    expect(result.thesis.mechanism).toEqual(FULL_CONTENT.thesis.mechanism);
    expect(result.voice.tone).toEqual(FULL_CONTENT.voice.tone);
    expect(result.voice.avoid).toEqual(FULL_CONTENT.voice.avoid);
    expect(result.contentStrategy.pillars).toEqual(FULL_CONTENT.contentStrategy.pillars);
    expect(result.contentStrategy.requiredScenarios).toEqual(FULL_CONTENT.contentStrategy.requiredScenarios);
    expect(result.contentStrategy.recurringPattern).toEqual(FULL_CONTENT.contentStrategy.recurringPattern);
    expect(result.guardrails.ethicalPrinciples).toEqual(FULL_CONTENT.guardrails.ethicalPrinciples);
    expect(result.guardrails.forbiddenFraming).toEqual(FULL_CONTENT.guardrails.forbiddenFraming);
    expect(result.packaging.seoTerms).toEqual(FULL_CONTENT.packaging.seoTerms);
    expect(result.researchBasis.findings).toEqual(FULL_CONTENT.researchBasis.findings);
  });

  it("trims whitespace from each line and filters empty lines", () => {
    const result = formToContent({
      market: { region: "  US  ", researchLanguage: "  English  ", manuscriptLanguage: "  Spanish  " },
      audience: {
        primaryReader: "  Test reader  ",
        situation: "  Situation  ",
        pain: "  Pain  ",
        awareness: "  Awareness  ",
        objections: "  Item one  \n\n  Item two  \n  \nItem three  ",
      },
      thesis: {
        coreProblem: "  Problem  ",
        desiredOutcome: "  Outcome  ",
        promise: "  Promise  ",
        mechanism: "",
        realisticBoundary: "  Boundary  ",
      },
      voice: { tone: "  Tone A  \nTone B", posture: "  Posture  ", readingLevel: "  Level  ", avoid: "  Avoid  " },
      contentStrategy: { pillars: "  Pillar A  ", requiredScenarios: "  Scenario A  ", recurringPattern: "  Pattern A  ", examplePolicy: "  Policy  " },
      guardrails: { ethicalPrinciples: "  Principle A  ", forbiddenClaims: "  Claim A  ", forbiddenFraming: "  Framing A  " },
      evidence: { mode: "  rag_optional  ", citationPolicy: "  Cite policy  " },
      packaging: { titleAngle: "  Angle  ", hook: "  Hook  ", seoTerms: "  Term A  \nTerm B" },
      researchBasis: { findings: "  Finding A  ", inferences: "  Inference A  ", limitations: "  Limitation A  " },
    });

    // Scalar fields are trimmed
    expect(result.market.region).toBe("US");
    expect(result.market.researchLanguage).toBe("English");
    expect(result.market.manuscriptLanguage).toBe("Spanish");

    // Array fields trim and filter empty
    expect(result.audience.objections).toEqual(["Item one", "Item two", "Item three"]);

    // Empty mechanism should produce an empty array
    expect(result.thesis.mechanism).toEqual([]);
  });

  it("never splits on commas", () => {
    const form = contentToForm(FULL_CONTENT);
    // Add commas inside items to verify they are not split
    form.audience.objections = "Item, with, commas\nSecond, item";
    form.thesis.mechanism = "Mechanism, one\nMechanism, two";

    const result = formToContent(form);
    expect(result.audience.objections).toEqual(["Item, with, commas", "Second, item"]);
    expect(result.thesis.mechanism).toEqual(["Mechanism, one", "Mechanism, two"]);
  });

  it("preserves researchLanguage vs manuscriptLanguage distinction", () => {
    const form = contentToForm(FULL_CONTENT);
    form.market.researchLanguage = "English";
    form.market.manuscriptLanguage = "Spanish";

    const result = formToContent(form);
    expect(result.market.researchLanguage).toBe("English");
    expect(result.market.manuscriptLanguage).toBe("Spanish");
    // Verify they are separate fields, not aliased
    expect(result.market).not.toEqual(
      expect.objectContaining({
        researchLanguage: expect.stringContaining("Spanish"),
      }),
    );
  });
});

describe("contentToForm", () => {
  it("converts arrays to newline-separated strings", () => {
    const form = contentToForm(FULL_CONTENT);

    expect(form.audience.objections).toBe(
      "It feels fake to use conversation techniques\nI should just be myself",
    );
    expect(form.thesis.mechanism).toBe(
      "Principle-based adaptable frameworks\nSpecific conversation openers\nEscalation patterns",
    );
    expect(form.voice.tone).toBe("Direct\nSocially calibrated\nPractical");
    expect(form.researchBasis.findings).toBe(
      "70% of matches never message first\nResponse rates drop 50% after 24 hours",
    );
  });

  it("preserves scalar fields unchanged", () => {
    const form = contentToForm(FULL_CONTENT);

    expect(form.market.region).toBe("United States");
    expect(form.market.researchLanguage).toBe("English");
    expect(form.market.manuscriptLanguage).toBe("Spanish");
    expect(form.audience.primaryReader).toBe("Men aged 25-40 who use dating apps");
    expect(form.thesis.coreProblem).toBe("Men lack a conversational framework for dating app interactions");
    expect(form.voice.posture).toBe("Confident peer, not guru");
    expect(form.evidence.mode).toBe("rag_optional");
  });

  it("returns '-' for empty arrays (placeholder)", () => {
    const emptyContent: EditorialBriefContent = {
      ...FULL_CONTENT,
      audience: { ...FULL_CONTENT.audience, objections: [] },
      thesis: { ...FULL_CONTENT.thesis, mechanism: [] },
      voice: { ...FULL_CONTENT.voice, tone: [], avoid: [] },
      contentStrategy: { ...FULL_CONTENT.contentStrategy, pillars: [], requiredScenarios: [], recurringPattern: [] },
      guardrails: { ...FULL_CONTENT.guardrails, ethicalPrinciples: [], forbiddenClaims: [], forbiddenFraming: [] },
      packaging: { ...FULL_CONTENT.packaging, seoTerms: [] },
      researchBasis: { ...FULL_CONTENT.researchBasis, findings: [], inferences: [], limitations: [] },
    };

    const form = contentToForm(emptyContent);
    expect(form.audience.objections).toBe("-");
    expect(form.thesis.mechanism).toBe("-");
    expect(form.voice.tone).toBe("-");
    expect(form.researchBasis.findings).toBe("-");
  });
});

describe("Round-trip: content → form → content", () => {
  it("produces identical data after round-trip", () => {
    const form = contentToForm(FULL_CONTENT);
    const result = formToContent(form);

    expect(result).toEqual(FULL_CONTENT);
  });

  it("round-trips empty arrays preserving [] (sentinel stripped by toArray)", () => {
    const contentWithEmptyArrays: EditorialBriefContent = {
      ...FULL_CONTENT,
      audience: { ...FULL_CONTENT.audience, objections: [] },
      thesis: { ...FULL_CONTENT.thesis, mechanism: [] },
      voice: { ...FULL_CONTENT.voice, tone: [], avoid: [] },
      contentStrategy: { ...FULL_CONTENT.contentStrategy, pillars: [], requiredScenarios: [], recurringPattern: [] },
      guardrails: { ...FULL_CONTENT.guardrails, ethicalPrinciples: [], forbiddenClaims: [], forbiddenFraming: [] },
      packaging: { ...FULL_CONTENT.packaging, seoTerms: [] },
      researchBasis: { ...FULL_CONTENT.researchBasis, findings: [], inferences: [], limitations: [] },
    };

    const form = contentToForm(contentWithEmptyArrays);
    const result = formToContent(form);

    // The form layer displays "-" for empty arrays, but toArray strips it.
    // Empty arrays survive round-trip as [].
    expect(result.audience.objections).toEqual([]);
    expect(result.thesis.mechanism).toEqual([]);
    expect(result.voice.tone).toEqual([]);
    expect(result.voice.avoid).toEqual([]);
    expect(result.contentStrategy.pillars).toEqual([]);
    expect(result.researchBasis.findings).toEqual([]);
  });

  it("round-trips through content → form → content identically for complete data", () => {
    const form = contentToForm(FULL_CONTENT);
    const content = formToContent(form);
    const form2 = contentToForm(content);
    const content2 = formToContent(form2);

    expect(content).toEqual(FULL_CONTENT);
    expect(content2).toEqual(FULL_CONTENT);
    // Verify form representations are also identical
    expect(form).toEqual(form2);
  });
});

describe("contractToForm", () => {
  it("converts contract string arrays to newline-separated strings", () => {
    const form = contractToForm(FULL_CONTRACT);

    expect(form.mustCover).toBe("Why first messages matter\nPersonalization techniques\nTiming considerations");
    expect(form.requiredScenarios).toBe("Mutual match with no message\nRe-engaging after a day");
  });

  it("serializes evidenceNeeds as JSON", () => {
    const form = contractToForm(FULL_CONTRACT);

    const parsed = JSON.parse(form.evidenceNeedsForm);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].placeholderName).toBe("first_message_stats");
    expect(parsed[0].required).toBe(true);
  });

  it("preserves avoidOverlapWith with '-' placeholder as '-'", () => {
    const form = contractToForm(FULL_CONTRACT);

    expect(form.avoidOverlapWith).toBe("-");
  });

  it("preserves scalar fields unchanged", () => {
    const form = contractToForm(FULL_CONTRACT);

    expect(form.chapterId).toBe("22222222-2222-2222-2222-222222222222");
    expect(form.jobToBeDone).toBe("Craft the first message after matching");
    expect(form.readerShift).toBe("From anxiety to having a reliable framework");
    expect(form.toneAdjustment).toBe("More directive in first message section");
  });
});

describe("formToContracts", () => {
  it("converts textarea forms to typed contracts", () => {
    const form = contractToForm(FULL_CONTRACT);
    const contracts = formToContracts([form]);

    expect(contracts).toHaveLength(1);
    // avoidOverlapWith: ["-"] survives round-trip due to placeholder convention
    expect(contracts[0].chapterId).toBe(FULL_CONTRACT.chapterId);
    expect(contracts[0].jobToBeDone).toBe(FULL_CONTRACT.jobToBeDone);
    expect(contracts[0].mustCover).toEqual(FULL_CONTRACT.mustCover);
    expect(contracts[0].evidenceNeeds).toEqual(FULL_CONTRACT.evidenceNeeds);
    expect(contracts[0].avoidOverlapWith).toEqual([]);
  });

  it("trims whitespace and filters empty lines", () => {
    const result = formToContracts([
      {
        chapterId: "ch-1",
        jobToBeDone: "  Job  ",
        readerShift: "  Shift  ",
        mustCover: "  Item one  \n\n  Item two  ",
        requiredScenarios: "",
        evidenceNeedsForm: "[]",
        toneAdjustment: "  Adjustment  ",
        avoidOverlapWith: "  Overlap  \n\n",
        transitionToNext: "  Transition  ",
      },
    ]);

    expect(result[0].jobToBeDone).toBe("Job");
    expect(result[0].mustCover).toEqual(["Item one", "Item two"]);
    expect(result[0].requiredScenarios).toEqual([]);
    expect(result[0].avoidOverlapWith).toEqual(["Overlap"]);
  });

  it("never splits on commas", () => {
    const result = formToContracts([
      {
        ...contractToForm(FULL_CONTRACT),
        mustCover: "Item, with, commas\nSecond, item",
      },
    ]);

    expect(result[0].mustCover).toEqual(["Item, with, commas", "Second, item"]);
  });

  it("preserves chapter ordering", () => {
    const contracts = [
      { ...FULL_CONTRACT, chapterId: "aaa", jobToBeDone: "First" },
      { ...FULL_CONTRACT, chapterId: "bbb", jobToBeDone: "Second" },
      { ...FULL_CONTRACT, chapterId: "ccc", jobToBeDone: "Third" },
    ];

    const forms = contracts.map(contractToForm);
    const result = formToContracts(forms);

    expect(result).toHaveLength(3);
    expect(result[0].chapterId).toBe("aaa");
    expect(result[1].chapterId).toBe("bbb");
    expect(result[2].chapterId).toBe("ccc");
  });

  it("parses evidenceNeeds from JSON string", () => {
    const form = contractToForm(FULL_CONTRACT);
    const result = formToContracts([form]);

    expect(result[0].evidenceNeeds).toHaveLength(2);
    expect(result[0].evidenceNeeds[0].placeholderName).toBe("first_message_stats");
    expect(result[0].evidenceNeeds[0].required).toBe(true);
  });

  it("returns empty evidenceNeeds for invalid JSON", () => {
    const result = formToContracts([
      {
        ...contractToForm(FULL_CONTRACT),
        evidenceNeedsForm: "not valid json",
      },
    ]);

    expect(result[0].evidenceNeeds).toEqual([]);
  });
});

describe("Round-trip: contract → form → contract", () => {
  it("produces identical data (avoidOverlapWith placeholder convention preserved)", () => {
    const form = contractToForm(FULL_CONTRACT);
    const contracts = formToContracts([form]);

    expect(contracts[0].chapterId).toBe(FULL_CONTRACT.chapterId);
    expect(contracts[0].jobToBeDone).toBe(FULL_CONTRACT.jobToBeDone);
    expect(contracts[0].mustCover).toEqual(FULL_CONTRACT.mustCover);
    expect(contracts[0].evidenceNeeds).toEqual(FULL_CONTRACT.evidenceNeeds);
    expect(contracts[0].avoidOverlapWith).toEqual([]);
  });

  it("preserves evidenceNeeds through round-trip", () => {
    const form = contractToForm(FULL_CONTRACT);
    const contracts = formToContracts([form]);

    expect(contracts[0].evidenceNeeds).toEqual(FULL_CONTRACT.evidenceNeeds);
  });

  it("preserves multiple contracts ordering through round-trip", () => {
    const c1 = { ...FULL_CONTRACT, chapterId: "11111111-1111-1111-1111-111111111111" };
    const c2 = { ...FULL_CONTRACT, chapterId: "22222222-2222-2222-2222-222222222222" };
    const c3 = { ...FULL_CONTRACT, chapterId: "33333333-3333-3333-3333-333333333333" };

    const forms = [c1, c2, c3].map(contractToForm);
    const result = formToContracts(forms);

    expect(result).toHaveLength(3);
    expect(result[0].chapterId).toBe("11111111-1111-1111-1111-111111111111");
    expect(result[1].chapterId).toBe("22222222-2222-2222-2222-222222222222");
    expect(result[2].chapterId).toBe("33333333-3333-3333-3333-333333333333");
  });
});
