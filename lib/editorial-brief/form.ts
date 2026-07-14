import type {
  EditorialBriefContent,
  ChapterEditorialContract,
} from "./schema";

// ---------------------------------------------------------------------------
// Form types — flat textarea representation where string[] fields become
// newline-separated strings.
// ---------------------------------------------------------------------------

export interface EditorialBriefForm {
  market: {
    region: string;
    researchLanguage: string;
    manuscriptLanguage: string;
  };
  audience: {
    primaryReader: string;
    situation: string;
    pain: string;
    awareness: string;
    objections: string;
  };
  thesis: {
    coreProblem: string;
    desiredOutcome: string;
    promise: string;
    mechanism: string;
    realisticBoundary: string;
  };
  voice: {
    tone: string;
    posture: string;
    readingLevel: string;
    avoid: string;
  };
  contentStrategy: {
    pillars: string;
    requiredScenarios: string;
    recurringPattern: string;
    examplePolicy: string;
  };
  guardrails: {
    ethicalPrinciples: string;
    forbiddenClaims: string;
    forbiddenFraming: string;
  };
  evidence: {
    mode: string;
    citationPolicy: string;
  };
  packaging: {
    titleAngle: string;
    hook: string;
    seoTerms: string;
  };
  researchBasis: {
    findings: string;
    inferences: string;
    limitations: string;
  };
}

export interface TextareaContractForm {
  chapterId: string;
  jobToBeDone: string;
  readerShift: string;
  mustCover: string;
  requiredScenarios: string;
  evidenceNeedsForm: string; // JSON string — per-item editing
  toneAdjustment: string;
  avoidOverlapWith: string;
  transitionToNext: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse a newline-separated string into an array, trimming whitespace,
 * filtering empty lines, and stripping the "-" sentinel.
 */
function toArray(value: string): string[] {
  return value
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s !== "" && s !== "-");
}

/**
 * Join an array of strings into a newline-separated string.
 * For empty arrays with placeholder values (["-"]), return "-".
 */
function toTextarea(value: string[]): string {
  if (value.length === 0) return "-";
  return value.join("\n");
}

// ---------------------------------------------------------------------------
// Content conversion (EditorialBriefContent ↔ EditorialBriefForm)
// ---------------------------------------------------------------------------

/**
 * Convert a form (newline-separated textarea fields) to typed EditorialBriefContent.
 *
 * Rules:
 * - Never split on commas — only newlines
 * - Preserve researchLanguage vs manuscriptLanguage distinction
 * - Empty lines are filtered out
 */
export function formToContent(form: EditorialBriefForm): EditorialBriefContent {
  return {
    market: {
      region: form.market.region.trim(),
      researchLanguage: form.market.researchLanguage.trim(),
      manuscriptLanguage: form.market.manuscriptLanguage.trim(),
    },
    audience: {
      primaryReader: form.audience.primaryReader.trim(),
      situation: form.audience.situation.trim(),
      pain: form.audience.pain.trim(),
      awareness: form.audience.awareness.trim(),
      objections: toArray(form.audience.objections),
    },
    thesis: {
      coreProblem: form.thesis.coreProblem.trim(),
      desiredOutcome: form.thesis.desiredOutcome.trim(),
      promise: form.thesis.promise.trim(),
      mechanism: toArray(form.thesis.mechanism),
      realisticBoundary: form.thesis.realisticBoundary.trim(),
    },
    voice: {
      tone: toArray(form.voice.tone),
      posture: form.voice.posture.trim(),
      readingLevel: form.voice.readingLevel.trim(),
      avoid: toArray(form.voice.avoid),
    },
    contentStrategy: {
      pillars: toArray(form.contentStrategy.pillars),
      requiredScenarios: toArray(form.contentStrategy.requiredScenarios),
      recurringPattern: toArray(form.contentStrategy.recurringPattern),
      examplePolicy: form.contentStrategy.examplePolicy.trim(),
    },
    guardrails: {
      ethicalPrinciples: toArray(form.guardrails.ethicalPrinciples),
      forbiddenClaims: toArray(form.guardrails.forbiddenClaims),
      forbiddenFraming: toArray(form.guardrails.forbiddenFraming),
    },
    evidence: {
      mode: form.evidence.mode.trim() as "rag_optional" | "rag_required_for_named_needs",
      citationPolicy: form.evidence.citationPolicy.trim(),
    },
    packaging: {
      titleAngle: form.packaging.titleAngle.trim(),
      hook: form.packaging.hook.trim(),
      seoTerms: toArray(form.packaging.seoTerms),
    },
    researchBasis: {
      findings: toArray(form.researchBasis.findings),
      inferences: toArray(form.researchBasis.inferences),
      limitations: toArray(form.researchBasis.limitations),
    },
  };
}

/**
 * Convert typed EditorialBriefContent to a form with newline-joined arrays.
 */
export function contentToForm(content: EditorialBriefContent): EditorialBriefForm {
  return {
    market: {
      region: content.market.region,
      researchLanguage: content.market.researchLanguage,
      manuscriptLanguage: content.market.manuscriptLanguage,
    },
    audience: {
      primaryReader: content.audience.primaryReader,
      situation: content.audience.situation,
      pain: content.audience.pain,
      awareness: content.audience.awareness,
      objections: toTextarea(content.audience.objections),
    },
    thesis: {
      coreProblem: content.thesis.coreProblem,
      desiredOutcome: content.thesis.desiredOutcome,
      promise: content.thesis.promise,
      mechanism: toTextarea(content.thesis.mechanism),
      realisticBoundary: content.thesis.realisticBoundary,
    },
    voice: {
      tone: toTextarea(content.voice.tone),
      posture: content.voice.posture,
      readingLevel: content.voice.readingLevel,
      avoid: toTextarea(content.voice.avoid),
    },
    contentStrategy: {
      pillars: toTextarea(content.contentStrategy.pillars),
      requiredScenarios: toTextarea(content.contentStrategy.requiredScenarios),
      recurringPattern: toTextarea(content.contentStrategy.recurringPattern),
      examplePolicy: content.contentStrategy.examplePolicy,
    },
    guardrails: {
      ethicalPrinciples: toTextarea(content.guardrails.ethicalPrinciples),
      forbiddenClaims: toTextarea(content.guardrails.forbiddenClaims),
      forbiddenFraming: toTextarea(content.guardrails.forbiddenFraming),
    },
    evidence: {
      mode: content.evidence.mode,
      citationPolicy: content.evidence.citationPolicy,
    },
    packaging: {
      titleAngle: content.packaging.titleAngle,
      hook: content.packaging.hook,
      seoTerms: toTextarea(content.packaging.seoTerms),
    },
    researchBasis: {
      findings: toTextarea(content.researchBasis.findings),
      inferences: toTextarea(content.researchBasis.inferences),
      limitations: toTextarea(content.researchBasis.limitations),
    },
  };
}

// ---------------------------------------------------------------------------
// Contract conversion (ChapterEditorialContract ↔ TextareaContractForm)
// ---------------------------------------------------------------------------

/**
 * Convert an array of chapter contract forms to typed ChapterEditorialContract[]
 *
 * Rules:
 * - Never split on commas — only newlines
 * - Chapter ordering is preserved (input order = output order)
 */
export function formToContracts(forms: TextareaContractForm[]): ChapterEditorialContract[] {
  return forms.map((f) => ({
    chapterId: f.chapterId,
    jobToBeDone: f.jobToBeDone.trim(),
    readerShift: f.readerShift.trim(),
    mustCover: toArray(f.mustCover),
    requiredScenarios: toArray(f.requiredScenarios),
    evidenceNeeds: parseEvidenceNeeds(f.evidenceNeedsForm),
    toneAdjustment: f.toneAdjustment.trim(),
    avoidOverlapWith: toArray(f.avoidOverlapWith),
    transitionToNext: f.transitionToNext.trim(),
  }));
}

/**
 * Convert a single ChapterEditorialContract to a textarea form.
 */
export function contractToForm(contract: ChapterEditorialContract): TextareaContractForm {
  return {
    chapterId: contract.chapterId,
    jobToBeDone: contract.jobToBeDone,
    readerShift: contract.readerShift,
    mustCover: toTextarea(contract.mustCover),
    requiredScenarios: toTextarea(contract.requiredScenarios),
    evidenceNeedsForm: serializeEvidenceNeeds(contract.evidenceNeeds),
    toneAdjustment: contract.toneAdjustment,
    avoidOverlapWith: toTextarea(contract.avoidOverlapWith),
    transitionToNext: contract.transitionToNext,
  };
}

// ---------------------------------------------------------------------------
// Evidence needs helpers
// ---------------------------------------------------------------------------

interface EvidenceNeed {
  placeholderName: string;
  query: string;
  required: boolean;
}

function parseEvidenceNeeds(json: string): EvidenceNeed[] {
  if (!json.trim()) return [];

  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    // Accept items that may only have some fields
    return parsed.map((item: Record<string, unknown>) => ({
      placeholderName: typeof item.placeholderName === "string" ? item.placeholderName : "",
      query: typeof item.query === "string" ? item.query : "",
      required: item.required === true,
    }));
  } catch (err) {
    console.warn("Failed to parse evidenceNeeds JSON:", err instanceof Error ? err.message : err);
    return [];
  }
}

function serializeEvidenceNeeds(needs: EvidenceNeed[]): string {
  if (needs.length === 0) return "[]";
  return JSON.stringify(needs, null, 2);
}
