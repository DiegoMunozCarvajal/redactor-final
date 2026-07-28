import type {
  EditorialBriefContent,
  EditorialBriefContentV3,
  ChapterEditorialContract,
  EditorialBundle,
} from "../schema";

// ---------------------------------------------------------------------------
// DeepPartial — allows partial overrides at any nesting level for test
// fixtures without TypeScript errors on `strict()` schemas.
// ---------------------------------------------------------------------------

type DeepPartial<T> = T extends Array<infer U>
  ? DeepPartial<U>[]
  : T extends object
    ? { [P in keyof T]?: DeepPartial<T[P]> }
    : T;

export const TEST_BRIEF_ID = "11111111-1111-1111-1111-111111111111";
export const TEST_CHAPTER_1_ID = "22222222-2222-2222-2222-222222222222";
export const TEST_CHAPTER_2_ID = "33333333-3333-3333-3333-333333333333";
export const TEST_EVIDENCE_SOURCE_ID = "44444444-4444-4444-4444-444444444444";

export const SAMPLE_HASH =
  "0000000000000000000000000000000000000000000000000000000000000000";

export function createTestBriefContent(
  overrides?: DeepPartial<EditorialBriefContent>,
): EditorialBriefContent {
  return {
    centralTopic: "Dating app conversation strategies for men",
    market: {
      region: "United States",
      researchLanguage: "English",
      manuscriptLanguage: "Spanish",
      ...overrides?.market,
    },
    audience: {
      primaryReader: "Men aged 25-40 who use dating apps",
      situation:
        "They matched but do not know how to start or sustain a conversation",
      pain: "Matches fizzle out because they run out of things to say",
      awareness:
        "They know they need to message first but lack a framework",
      objections: [
        "It feels fake to use conversation techniques",
        "I should just be myself",
      ],
      ...overrides?.audience,
    },
    thesis: {
      coreProblem:
        "Men lack a conversational framework for dating app interactions",
      desiredOutcome: "Confident, natural conversation leading to dates",
      promise: "Turn every match into a meaningful conversation within 7 days",
      mechanism: [
        "Principle-based adaptable frameworks",
        "Specific conversation openers",
        "Escalation patterns",
      ],
      realisticBoundary:
        "Not every match will respond; external factors matter",
      ...overrides?.thesis,
    },
    voice: {
      tone: ["Direct", "Socially calibrated", "Practical"],
      posture: "Confident peer, not guru",
      readingLevel: "Conversational",
      avoid: [
        "Pickup artist jargon",
        "Manipulation tactics",
        "Overly formal language",
      ],
      ...overrides?.voice,
    },
    contentStrategy: {
      pillars: [
        "First message",
        "Continued exchange",
        "Date transition",
        "In-person conversation",
      ],
      requiredScenarios: [
        "Opening after match",
        "Recovering from silence",
        "Asking for the date",
      ],
      recurringPattern: ["Principle + example pattern", "Do/don't comparison"],
      examplePolicy:
        "Realistic examples, not idealized scripts",
      ...overrides?.contentStrategy,
    },
    guardrails: {
      ethicalPrinciples: ["Reciprocity", "Respect", "Honesty"],
      forbiddenClaims: ["Guaranteed results", "100% success rate"],
      forbiddenFraming: ["Tricks or hacks", "Game playing", "Manipulation"],
      ...overrides?.guardrails,
    },
    evidence: {
      mode: "rag_optional",
      citationPolicy:
        "Cite specific studies when making factual claims; anecdotal evidence labeled as such",
      ...overrides?.evidence,
    },
    packaging: {
      titleAngle: "How to turn matches into dates",
      hook: "Stop losing matches to awkward silences",
      seoTerms: [
        "dating app conversation tips",
        "first message examples",
        "how to keep conversation going",
      ],
      ...overrides?.packaging,
    },
    researchBasis: {
      findings: [
        "70% of matches never message first",
        "Response rates drop 50% after 24 hours",
      ],
      inferences: [
        "Timing and personalization are critical",
        "Men overthink first messages",
      ],
      limitations: [
        "Self-reported data from small sample",
        "US-centric trends",
      ],
      ...overrides?.researchBasis,
    },
  };
}

export function createTestChapterContract(
  chapterId: string,
  overrides?: Partial<ChapterEditorialContract>,
): ChapterEditorialContract {
  return {
    chapterId,
    jobToBeDone: "Craft the first message after matching",
    readerShift:
      "From anxiety about starting conversation to having a reliable framework",
    mustCover: [
      "Why first messages matter",
      "Personalization techniques",
      "Timing considerations",
    ],
    requiredScenarios: ["Mutual match with no message", "Re-engaging after a day"],
    evidenceNeeds: [
      {
        placeholderName: "first_message_stats",
        query: "response rates by first message type",
        required: true,
      },
      {
        placeholderName: "conversation_openers",
        query: "effective conversation openers online dating",
        required: false,
      },
    ],
    toneAdjustment: "More directive in first message section",
    avoidOverlapWith: [],
    transitionToNext:
      "Once the message is sent, the reader needs to handle the reply",
    ...overrides,
  };
}

export function createTestEditorialBundle(
  overrides?: {
    content?: DeepPartial<EditorialBriefContent>;
    contracts?: ChapterEditorialContract[];
    evidenceSourceIds?: string[];
    id?: string;
    version?: number;
    hash?: string;
  },
): EditorialBundle {
  return {
    id: overrides?.id ?? TEST_BRIEF_ID,
    version: overrides?.version ?? 1,
    hash: overrides?.hash ?? SAMPLE_HASH,
    content: createTestBriefContent(overrides?.content),
    contracts: overrides?.contracts ?? [
      createTestChapterContract(TEST_CHAPTER_1_ID),
      createTestChapterContract(TEST_CHAPTER_2_ID),
    ],
    evidenceSourceIds: overrides?.evidenceSourceIds ?? [TEST_EVIDENCE_SOURCE_ID],
  };
}

// ---------------------------------------------------------------------------
// V3 fixtures
// ---------------------------------------------------------------------------

export function createTestBriefContentV3(
  overrides?: DeepPartial<EditorialBriefContentV3>,
): EditorialBriefContentV3 {
  return {
    schemaVersion: "3.0",
    centralTopic: "Dating app conversation strategies for men",
    market: {
      region: "United States",
      researchLanguage: "English",
      manuscriptLanguage: "Spanish",
      ...(overrides?.market as Partial<EditorialBriefContentV3["market"]>),
    },
    audience: {
      primaryReader: "Men aged 25-40 who use dating apps",
      situation:
        "They matched but do not know how to start or sustain a conversation",
      pain: "Matches fizzle out because they run out of things to say",
      awareness:
        "They know they need to message first but lack a framework",
      objections: [
        "It feels fake to use conversation techniques",
        "I should just be myself",
      ],
      ...(overrides?.audience as Partial<EditorialBriefContentV3["audience"]>),
    },
    thesis: {
      coreProblem:
        "Men lack a conversational framework for dating app interactions",
      desiredOutcome: "Confident, natural conversation leading to dates",
      promise: "Turn every match into a meaningful conversation within 7 days",
      mechanism: [
        "Principle-based adaptable frameworks",
        "Specific conversation openers",
        "Escalation patterns",
      ],
      realisticBoundary:
        "Not every match will respond; external factors matter",
      ...(overrides?.thesis as Partial<EditorialBriefContentV3["thesis"]>),
    },
    voice: {
      tone: ["Direct", "Socially calibrated", "Practical"],
      posture: "Confident peer, not guru",
      readingLevel: "Conversational",
      avoid: [
        "Pickup artist jargon",
        "Manipulation tactics",
        "Overly formal language",
      ],
      ...(overrides?.voice as Partial<EditorialBriefContentV3["voice"]>),
    },
    guardrails: {
      ethicalPrinciples: ["Reciprocity", "Respect", "Honesty"],
      forbiddenClaims: ["Guaranteed results", "100% success rate"],
      forbiddenFraming: ["Tricks or hacks", "Game playing", "Manipulation"],
      ...(overrides?.guardrails as Partial<EditorialBriefContentV3["guardrails"]>),
    },
    packaging: {
      titleAngle: "How to turn matches into dates",
      hook: "Stop losing matches to awkward silences",
      seoTerms: [
        "dating app conversation tips",
        "first message examples",
        "how to keep conversation going",
      ],
      ...(overrides?.packaging as Partial<EditorialBriefContentV3["packaging"]>),
    },
    researchBasis: {
      findings: [
        "70% of matches never message first",
        "Response rates drop 50% after 24 hours",
      ],
      inferences: [
        "Timing and personalization are critical",
        "Men overthink first messages",
      ],
      limitations: [
        "Self-reported data from small sample",
        "US-centric trends",
      ],
      ...(overrides?.researchBasis as Partial<EditorialBriefContentV3["researchBasis"]>),
    },
    topicKnowledge: {
      essentialTopics: [
        "Conversation threading",
        "First message psychology",
        "Escalation dynamics",
      ],
      audienceLanguage: ["match", "ghosting", "left on read"],
      nicheTerms: ["IOI", "Buying temperature"],
      outOfScope: ["NLP techniques", "PUA community history"],
      ...(overrides?.topicKnowledge as Partial<EditorialBriefContentV3["topicKnowledge"]>),
    },
    scenarioCatalog: [
      {
        situation: "After mutual match, no message sent yet",
        context: "Reader needs to understand the moment right after matching",
      },
      {
        situation: "Conversation goes silent after initial exchange",
        context: "Reader panics when replies stop after first few messages",
      },
      ...((overrides?.scenarioCatalog ?? []) as EditorialBriefContentV3["scenarioCatalog"]),
    ],
    evidenceGaps: [
      {
        question: "What is the response rate for personalized first messages?",
        category: "statistics",
        suggestedQueries: [
          "first message response rate dating apps",
          "personalized opener effectiveness",
        ],
        required: true,
      },
      {
        question: "How does message length affect reply probability?",
        category: "engagement",
        suggestedQueries: ["optimal message length dating apps"],
        required: false,
      },
      ...((overrides?.evidenceGaps ?? []) as EditorialBriefContentV3["evidenceGaps"]),
    ],
  };
}

export function createTestEditorialBundleV3(
  overrides?: {
    content?: DeepPartial<EditorialBriefContentV3>;
    contracts?: ChapterEditorialContract[];
    evidenceSourceIds?: string[];
    id?: string;
    version?: number;
    hash?: string;
  },
): EditorialBundle {
  return {
    id: overrides?.id ?? TEST_BRIEF_ID,
    version: overrides?.version ?? 3,
    hash: overrides?.hash ?? SAMPLE_HASH,
    content: createTestBriefContentV3(overrides?.content),
    contracts: overrides?.contracts ?? [
      createTestChapterContract(TEST_CHAPTER_1_ID),
      createTestChapterContract(TEST_CHAPTER_2_ID),
    ],
    evidenceSourceIds: overrides?.evidenceSourceIds ?? [TEST_EVIDENCE_SOURCE_ID],
  };
}
