import { describe, it, expect, vi } from "vitest";

// Mock db module so the test file loads without DATABASE_URL.
// Pure function tests below never touch the db mock.
vi.mock("@/lib/db/drizzle", () => ({ db: {} }));

import { renderEditorialData } from "../render";
import { hashEditorialBundle } from "../hash";
import {
  snapshotFromBundle,
  metadataFromSnapshot,
  snapshotFromGenerationMetadata,
} from "../context";
import { editorialBriefContentSchema } from "../schema";
import type {
  EditorialBriefContent,
  ChapterEditorialContract,
  EditorialBundle,
} from "../schema";

// ---------------------------------------------------------------------------
// Niche fixture: first-message / conversation / dating guide for men
// Derived from research report at
// hallazgos_nicho_google_trends_mensajes_citas.md
// ---------------------------------------------------------------------------

const NICHE_BRIEF_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NICHE_BRIEF_VERSION = 1;
const NICHE_CHAPTER_1_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NICHE_CHAPTER_2_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NICHE_CHAPTER_3_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function createNicheBriefContent(): EditorialBriefContent {
  return {
    market: {
      region: "United States",
      researchLanguage: "English",
      manuscriptLanguage: "Spanish",
    },
    audience: {
      primaryReader:
        "Men who matched with a woman they like but do not know how to open or sustain the conversation",
      situation:
        "They have her contact or profile open, the chat is blank, and every message they type sounds wrong",
      pain: "They overthink every word, fear sounding generic or boring, and watch conversations fizzle into silence",
      awareness:
        "They know they need to improve their messaging but lack a practical framework to do it consistently",
      objections: [
        "It feels fake to use techniques or scripts",
        "If she likes me it will happen naturally without trying so hard",
        "I do not want to come across as manipulative",
      ],
    },
    thesis: {
      coreProblem:
        "Men lack a method for crafting a context-appropriate first message, keeping the conversation alive, and transitioning to a date without overthinking or resorting to copied lines",
      desiredOutcome:
        "Send the right message for each situation, hold a natural conversation, and confidently ask for a date",
      promise:
        "Learn a principle-based method to craft first messages that get replies, sustain conversations that lead somewhere, and transition to a date without guesswork or scripts",
      mechanism: [
        "Principle plus adaptable example, not rigid scripts",
        "Context-aware message selection based on how you met",
        "Escalation patterns that progress naturally from text to date",
        "Signal-reading to decide next steps",
      ],
      realisticBoundary:
        "No method can guarantee a response or a date. Reciprocity, timing, and external factors always matter.",
    },
    voice: {
      tone: ["Direct", "Socially calibrated", "Practical", "Non-manipulative"],
      posture:
        "A practical peer who has been through it, not a pickup guru giving orders",
      readingLevel: "Conversational and accessible to non-native English speakers",
      avoid: [
        "Pickup artist jargon",
        "Manipulation tactics or pressure",
        'Overly formal or academic language',
        'Framing social interaction as "tricks" or "hacks"',
      ],
    },
    contentStrategy: {
      pillars: [
        "First message creation",
        "Continued conversation exchange",
        "Date transition and invitation",
        "In-person conversation dynamics",
      ],
      requiredScenarios: [
        "Opening after matching on a dating app",
        "Opening after meeting in person and getting her number",
        "Sustaining conversation past the first reply",
        "Responding to short or delayed replies",
        "Asking for the date naturally",
      ],
      recurringPattern: [
        "Principle plus adaptable example",
        "Do/don't comparison for each scenario",
        "Context-specific variations per channel",
      ],
      examplePolicy:
        "Every example includes context, objective, why it works, variations, and next step; never present a single perfect message as the only option",
    },
    guardrails: {
      ethicalPrinciples: [
        "Reciprocity -- both people should enjoy the exchange",
        "Respect boundaries and read disinterest signals",
        "Honesty over manipulation",
      ],
      forbiddenClaims: [
        "Guaranteed response or date success rate",
        '100% of women respond to this message',
      ],
      forbiddenFraming: [
        "Manipulation or psychological tricks",
        'Game playing or "winning"',
        "Pressure or insistence after a clear refusal",
        "Controlling or engineering someone's feelings",
      ],
    },
    evidence: {
      mode: "rag_optional",
      citationPolicy:
        "Cite specific research data when making factual claims about response rates or dating behavior; label anecdotal observations as such",
    },
    packaging: {
      titleAngle:
        "What to text a girl you like -- first message help, conversation skills, and getting the date",
      hook: "You matched. Now learn what to say.",
      seoTerms: [
        "first message to a girl",
        "what to text a girl",
        "how to keep conversation going with a girl",
        "dating texting help for men",
      ],
    },
    researchBasis: {
      findings: [
        'Through successive Google Trends narrowing, "what to say to a girl" dominates the niche with observable growth',
        '"how to text a girl you like" leads its comparison and shows upward trend',
        '"first message to a girl example" shows +110% growth; "best first message to a girl" shows +90%',
        'Readers search for both method ("how to") and concrete examples ("what to") -- not one or the other',
      ],
      inferences: [
        "The market wants practical examples plus a transferable system, not just theory or just scripts",
        "The first message is the moment of maximum friction and should be the commercial and narrative anchor",
        "Audience wants to eliminate uncertainty about what to say, not memorize pickup lines",
        "The solution structure must combine explanation with adaptable examples classified by context",
      ],
      limitations: [
        "Google Trends shows directional interest, not absolute search volumes",
        "Only US English search data was analyzed for niche discovery",
        "Long-tail queries lacked sufficient data for independent statistical conclusions",
      ],
    },
  };
}

function createNicheChapterContract(
  chapterId: string,
  overrides?: Partial<ChapterEditorialContract>,
): ChapterEditorialContract {
  const contracts: Record<string, ChapterEditorialContract> = {
    [NICHE_CHAPTER_1_ID]: {
      chapterId: NICHE_CHAPTER_1_ID,
      jobToBeDone:
        "Craft a context-appropriate first message that opens a conversation rather than a dead end",
      readerShift:
        "From staring at a blank chat to confidently sending a message tailored to how they met",
      mustCover: [
        "What a first message should actually accomplish",
        "Common first message mistakes and why they backfire",
        "The context-specific first message formula",
        "First message examples by situation",
      ],
      requiredScenarios: [
        "Opening after meeting her in person",
        "Opening after matching on an app",
        "Opening after getting a number through a friend",
      ],
      evidenceNeeds: [
        {
          placeholderName: "first_message_response_rates",
          query:
            "response rates by first message type in online dating research",
          required: true,
        },
      ],
      toneAdjustment:
        "More directive and concrete in the first message section",
      avoidOverlapWith: [],
      transitionToNext:
        "Once the first message is sent and she replies, the reader must sustain the exchange",
    },
    [NICHE_CHAPTER_2_ID]: {
      chapterId: NICHE_CHAPTER_2_ID,
      jobToBeDone:
        "Keep the conversation moving without making it feel like an interview",
      readerShift:
        "From running out of things to say after the opener to generating topics from context and deepening the exchange",
      mustCover: [
        "How to develop her reply into an actual exchange",
        "Alternating questions with observations, opinions, and humor",
        "Recognizing and responding to engagement signals",
        "Avoiding the interview pattern",
      ],
      requiredScenarios: [
        "Enthusiastic reply that invites follow-up",
        "Short single-word reply (lol, haha, nice)",
        "Reply after a long delay",
        "Topic change mid-conversation",
      ],
      evidenceNeeds: [
        {
          placeholderName: "conversation_drop_off_rates",
          query:
            "text conversation drop-off rates in early online dating stage",
          required: false,
        },
      ],
      toneAdjustment:
        "Slightly warmer and more relatable in conversation examples",
      avoidOverlapWith: ["First message strategies"],
      transitionToNext:
        "Once the conversation is flowing, the reader needs to know when and how to transition to a date",
    },
    [NICHE_CHAPTER_3_ID]: {
      chapterId: NICHE_CHAPTER_3_ID,
      jobToBeDone:
        "Transition from texting to proposing a real date without awkwardness",
      readerShift:
        "From indefinite chat to confidently recognizing the right moment and proposing a concrete date",
      mustCover: [
        "Signs she is ready for a date invitation",
        "How to formulate the invitation naturally",
        "Handling any response including hesitation or refusal",
        "What to do when she says she is busy",
      ],
      requiredScenarios: [
        "Natural progression from a good conversation",
        "Re-engagement attempt after a conversation pause",
        "She says she is busy without offering an alternative",
      ],
      evidenceNeeds: [],
      toneAdjustment:
        "Warm but confident -- directness balanced with respect for her comfort",
      avoidOverlapWith: ["Conversation flow strategies"],
      transitionToNext:
        "What to expect on the actual date and how to handle conversation in person",
    },
  };

  return { ...contracts[chapterId], ...overrides };
}

function createNicheEditorialBundle(
  overrides?: {
    content?: Partial<EditorialBriefContent>;
    contracts?: ChapterEditorialContract[];
    evidenceSourceIds?: string[];
    id?: string;
    version?: number;
    hash?: string;
  },
): EditorialBundle {
  return {
    id: overrides?.id ?? NICHE_BRIEF_ID,
    version: overrides?.version ?? NICHE_BRIEF_VERSION,
    hash: overrides?.hash ?? "",
    content: { ...createNicheBriefContent(), ...overrides?.content },
    contracts: overrides?.contracts ?? [
      createNicheChapterContract(NICHE_CHAPTER_1_ID),
      createNicheChapterContract(NICHE_CHAPTER_2_ID),
      createNicheChapterContract(NICHE_CHAPTER_3_ID),
    ],
    evidenceSourceIds: overrides?.evidenceSourceIds ?? [],
  };
}

function makeBundle(): { bundle: EditorialBundle; hash: string } {
  const bundle = createNicheEditorialBundle();
  const hash = hashEditorialBundle(bundle);
  return { bundle: { ...bundle, hash }, hash };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("niche fixture schema validation", () => {
  it("validates the complete niche brief content against the schema", () => {
    const content = createNicheBriefContent();
    const result = editorialBriefContentSchema.safeParse(content);
    expect(result.success).toBe(true);
  });

  it("produces a deterministic hash for identical bundles", () => {
    const { hash: h1 } = makeBundle();
    const { hash: h2 } = makeBundle();
    expect(h1).toBe(h2);
  });
});

describe("niche -- fragment scope projection", () => {
  it("projects niche audience, promise, voice, guardrails, and chapter contract", () => {
    const { bundle } = makeBundle();
    const result = renderEditorialData(bundle, {
      chapterId: NICHE_CHAPTER_1_ID,
    });

    // Market
    expect(result).toContain("United States");
    expect(result).toContain("Spanish");

    // Niche audience
    expect(result).toContain("matched with a woman they like");
    expect(result).toContain("chat is blank");
    expect(result).toContain("feels fake");

    // Niche promise
    expect(result).toContain("principle-based method");
    expect(result).toContain("No method can guarantee");

    // Niche voice
    expect(result).toContain("Direct");
    expect(result).toContain("Socially calibrated");
    expect(result).toContain("practical peer who has been through it");
    expect(result).toContain("Pickup artist jargon");

    // Niche guardrails
    expect(result).toContain("Reciprocity");
    expect(result).toContain("Manipulation or psychological tricks");

    // Chapter contract
    expect(result).toContain("Craft a context-appropriate first message");
    expect(result).toContain("first_message_response_rates");

    // All data sections are included (no scope filtering)
    expect(result).toContain("You matched. Now learn");
    expect(result).toContain("examplePolicy");
    expect(result).toContain("Opening after matching on a dating app");
  });

  it("selects the correct chapter contract per chapterId", () => {
    const { bundle } = makeBundle();
    const result = renderEditorialData(bundle, {
      chapterId: NICHE_CHAPTER_2_ID,
    });

    // Chapter 2 contract
    expect(result).toContain("Keep the conversation moving");
    expect(result).toContain("conversation_drop_off_rates");

    // NOT chapter 1 contract
    expect(result).not.toContain("first_message_response_rates");
    expect(result).not.toContain("Craft a context-appropriate first message");
  });
});

describe("niche -- assembly scope projection", () => {
  it("projects content strategy pillars and progression + dedup requirements", () => {
    const { bundle } = makeBundle();
    const result = renderEditorialData(bundle, {
      chapterId: NICHE_CHAPTER_1_ID,
    });

    // Niche content strategy
    expect(result).toContain("First message creation");
    expect(result).toContain("Continued conversation exchange");
    expect(result).toContain("Opening after matching on a dating app");
    expect(result).toContain("Principle plus adaptable example");
    expect(result).toContain("never present a single perfect message");

    // All data sections are included (no scope filtering)
    expect(result).toContain("You matched. Now learn");
  });
});

describe("niche -- critique scope projection", () => {
  it("projects all sections including evidence and research basis", () => {
    const { bundle } = makeBundle();
    const result = renderEditorialData(bundle, {
      chapterId: NICHE_CHAPTER_1_ID,
    });

    // Research basis (quotes are XML-escaped to &quot;)
    expect(result).toContain("&quot;what to say to a girl&quot; dominates the niche");
    expect(result).toContain("+110%");
    expect(result).toContain("Only US English search data");

    // Content strategy
    expect(result).toContain("First message creation");
    expect(result).toContain("Opening after matching on a dating app");

    // Evidence section
    expect(result).toContain("rag_optional");
    expect(result).toContain("Cite specific research data");

    // All data sections are included (no scope filtering)
    expect(result).toContain("You matched. Now learn");
  });

  it("includes the chapter contract", () => {
    const { bundle } = makeBundle();
    const result = renderEditorialData(bundle, {
      chapterId: NICHE_CHAPTER_1_ID,
    });

    expect(result).toContain("Craft a context-appropriate first message");
    expect(result).toContain("first_message_response_rates");
  });
});

describe("niche -- correction scope projection", () => {
  it("projects same sections as critique with no packaging", () => {
    const { bundle } = makeBundle();
    const result = renderEditorialData(bundle, {
      chapterId: NICHE_CHAPTER_1_ID,
    });

    // Same sections as critique (quotes are XML-escaped to &quot;)
    expect(result).toContain("&quot;what to say to a girl&quot; dominates the niche");
    expect(result).toContain("rag_optional");
    expect(result).toContain("First message creation");
    expect(result).toContain("Reciprocity");

    // Niche chapter contract
    expect(result).toContain("Craft a context-appropriate first message");

    // All data sections are included (no scope filtering)
    expect(result).toContain("You matched. Now learn");
  });
});

describe("niche -- title scope projection", () => {
  it("includes niche packaging and NEVER includes chapter contract", () => {
    const { bundle } = makeBundle();
    const result = renderEditorialData(bundle, {});

    // Niche packaging
    expect(result).toContain("What to text a girl you like");
    expect(result).toContain("You matched. Now learn what to say.");
    expect(result).toContain("first message to a girl");
    expect(result).toContain("how to keep conversation going with a girl");

    // Market, audience, thesis, guardrails
    expect(result).toContain("United States");
    expect(result).toContain("matched with a woman they like");
    expect(result).toContain("principle-based method");
    expect(result).toContain("Reciprocity");

    // All data sections are included (no scope filtering)
    expect(result).toContain("First message creation");
    expect(result).toContain("never present a single perfect message");

    // No chapter contract (no chapterId provided)
    expect(result).not.toContain("Craft a context-appropriate first message");
    expect(result).not.toContain("Keep the conversation moving");
    expect(result).not.toContain("Transition from texting");
  });
});

describe("niche -- placeholder-fill scope projection", () => {
  it("projects evidence alongside audience, thesis, voice, guardrails", () => {
    const { bundle } = makeBundle();
    const result = renderEditorialData(bundle, {
      chapterId: NICHE_CHAPTER_1_ID,
    });

    // Evidence section
    expect(result).toContain("rag_optional");
    expect(result).toContain("Cite specific research data");

    // Market, audience, thesis, voice, guardrails
    expect(result).toContain("United States");
    expect(result).toContain("matched with a woman they like");
    expect(result).toContain("principle-based method");
    expect(result).toContain("Direct");
    expect(result).toContain("Reciprocity");

    // Chapter contract with evidence needs
    expect(result).toContain("first_message_response_rates");
    expect(result).toContain("response rates by first message type");

    // All data sections are included (no scope filtering)
    expect(result).toContain("You matched. Now learn what to say");
  });
});

describe("niche -- correction inherits critique editorial hash (via snapshot)", () => {
  it("propagates the same editorial brief hash through the snapshot round-trip", () => {
    // Simulate real pipeline: critique stores hash in metadata,
    // correction reads it back and uses the same editorial brief.
    const { bundle, hash } = makeBundle();

    // Step 1: Critique captures snapshot from bundle
    const critiqueSnapshot = snapshotFromBundle(bundle);
    expect(critiqueSnapshot.editorialBriefHash).toBe(hash);

    // Step 2: Snapshot stored as generation metadata (JSONB)
    const critiqueMetadata = metadataFromSnapshot(critiqueSnapshot);

    // Step 3: Correction reads critique's metadata
    const correctionSnapshot =
      snapshotFromGenerationMetadata(critiqueMetadata);

    // Step 4: Correction uses the same editorial brief
    expect(correctionSnapshot).not.toBeNull();
    expect(correctionSnapshot!.editorialBriefId).toBe(NICHE_BRIEF_ID);
    expect(correctionSnapshot!.editorialBriefVersion).toBe(
      NICHE_BRIEF_VERSION,
    );
    expect(correctionSnapshot!.editorialBriefHash).toBe(hash);

    // Verify exact hash match -- correction and critique share the brief
    expect(correctionSnapshot!.editorialBriefHash).toBe(
      critiqueSnapshot.editorialBriefHash,
    );
  });

  it("reconstructs null snapshot when metadata is missing (legacy generations)", () => {
    const result = snapshotFromGenerationMetadata({
      editorialBriefId: null,
      editorialBriefVersion: null,
      editorialBriefHash: null,
    });
    expect(result).toBeNull();
  });

  it("reconstructs null when only bundle id is available (partial metadata)", () => {
    const result = snapshotFromGenerationMetadata({
      editorialBriefId: NICHE_BRIEF_ID,
    });
    expect(result).toBeNull();
  });
});
