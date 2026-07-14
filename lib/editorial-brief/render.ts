import type {
  EditorialBriefContent,
  ChapterEditorialContract,
  EditorialBundle,
} from "./schema";

// ---------------------------------------------------------------------------
// XML escaping
// ---------------------------------------------------------------------------

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

function renderElement(tag: string, value: string): string {
  return `<${tag}>${escapeXml(value)}</${tag}>`;
}

function renderArray(tag: string, items: string[], indent = 4): string {
  if (items.length === 0) return "";
  const filtered = items.filter((item) => item !== "-");
  if (filtered.length === 0) return "";
  const pad = " ".repeat(indent);
  const innerPad = " ".repeat(indent + 2);
  const inner = filtered
    .map((item) => `${innerPad}<item>${escapeXml(item)}</item>`)
    .join("\n");
  return `${pad}<${tag}>\n${inner}\n${pad}</${tag}>`;
}

function renderMarket(market: EditorialBriefContent["market"]): string {
  return [
    "  <market>",
    `    ${renderElement("region", market.region)}`,
    `    ${renderElement("researchLanguage", market.researchLanguage)}`,
    `    ${renderElement("manuscriptLanguage", market.manuscriptLanguage)}`,
    "  </market>",
  ].join("\n");
}

function renderAudience(audience: EditorialBriefContent["audience"]): string {
  return [
    "  <audience>",
    `    ${renderElement("primaryReader", audience.primaryReader)}`,
    `    ${renderElement("situation", audience.situation)}`,
    `    ${renderElement("pain", audience.pain)}`,
    `    ${renderElement("awareness", audience.awareness)}`,
    renderArray("objections", audience.objections),
    "  </audience>",
  ].join("\n");
}

function renderThesis(thesis: EditorialBriefContent["thesis"]): string {
  return [
    "  <thesis>",
    `    ${renderElement("coreProblem", thesis.coreProblem)}`,
    `    ${renderElement("desiredOutcome", thesis.desiredOutcome)}`,
    `    ${renderElement("promise", thesis.promise)}`,
    renderArray("mechanism", thesis.mechanism),
    `    ${renderElement("realisticBoundary", thesis.realisticBoundary)}`,
    "  </thesis>",
  ].join("\n");
}

function renderVoice(voice: EditorialBriefContent["voice"]): string {
  return [
    "  <voice>",
    renderArray("tone", voice.tone),
    `    ${renderElement("posture", voice.posture)}`,
    `    ${renderElement("readingLevel", voice.readingLevel)}`,
    renderArray("avoid", voice.avoid),
    "  </voice>",
  ].join("\n");
}

function renderContentStrategy(
  cs: EditorialBriefContent["contentStrategy"],
): string {
  return [
    "  <content_strategy>",
    renderArray("pillars", cs.pillars),
    renderArray("requiredScenarios", cs.requiredScenarios),
    renderArray("recurringPattern", cs.recurringPattern),
    `    ${renderElement("examplePolicy", cs.examplePolicy)}`,
    "  </content_strategy>",
  ].join("\n");
}

function renderGuardrails(
  guardrails: EditorialBriefContent["guardrails"],
): string {
  return [
    "  <guardrails>",
    renderArray("ethicalPrinciples", guardrails.ethicalPrinciples),
    renderArray("forbiddenClaims", guardrails.forbiddenClaims),
    renderArray("forbiddenFraming", guardrails.forbiddenFraming),
    "  </guardrails>",
  ].join("\n");
}

function renderEvidence(
  evidence: EditorialBriefContent["evidence"],
): string {
  return [
    "  <evidence>",
    `    ${renderElement("mode", evidence.mode)}`,
    `    ${renderElement("citationPolicy", evidence.citationPolicy)}`,
    "  </evidence>",
  ].join("\n");
}

function renderPackaging(
  packaging: EditorialBriefContent["packaging"],
): string {
  return [
    "  <packaging>",
    `    ${renderElement("titleAngle", packaging.titleAngle)}`,
    `    ${renderElement("hook", packaging.hook)}`,
    renderArray("seoTerms", packaging.seoTerms),
    "  </packaging>",
  ].join("\n");
}

function renderResearchBasis(
  rb: EditorialBriefContent["researchBasis"],
): string {
  return [
    "  <research_basis>",
    renderArray("findings", rb.findings),
    renderArray("inferences", rb.inferences),
    renderArray("limitations", rb.limitations),
    "  </research_basis>",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Evidence policy (placeholder-fill specific section)
// ---------------------------------------------------------------------------

function renderEvidencePolicy(
  evidence: EditorialBriefContent["evidence"],
): string {
  return [
    "  <evidence_policy>",
    `    ${renderElement("mode", evidence.mode)}`,
    `    ${renderElement("citationPolicy", evidence.citationPolicy)}`,
    "  </evidence_policy>",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Chapter contract renderer
// ---------------------------------------------------------------------------

function renderChapterContract(
  contract: ChapterEditorialContract,
): string {
  const evidenceNeedLines = contract.evidenceNeeds.map(
    (en) =>
      [
        "      <evidence_need>",
        `        ${renderElement("placeholderName", en.placeholderName)}`,
        `        ${renderElement("query", en.query)}`,
        `        ${renderElement("required", String(en.required))}`,
        "      </evidence_need>",
      ].join("\n"),
  );

  const evidenceNeedsBlock =
    evidenceNeedLines.length > 0
      ? `    <evidence_needs>\n${evidenceNeedLines.join("\n")}\n    </evidence_needs>`
      : "";

  return [
    "  <chapter_contract>",
    `    ${renderElement("chapterId", contract.chapterId)}`,
    `    ${renderElement("jobToBeDone", contract.jobToBeDone)}`,
    `    ${renderElement("readerShift", contract.readerShift)}`,
    renderArray("mustCover", contract.mustCover, 4),
    renderArray("requiredScenarios", contract.requiredScenarios, 4),
    evidenceNeedsBlock,
    `    ${renderElement("toneAdjustment", contract.toneAdjustment)}`,
    renderArray("avoidOverlapWith", contract.avoidOverlapWith, 4),
    `    ${renderElement("transitionToNext", contract.transitionToNext)}`,
    "  </chapter_contract>",
  ]
    .filter(Boolean)
    .join("\n");
}


// ---------------------------------------------------------------------------
// Renderers map
// ---------------------------------------------------------------------------

type SectionValue = EditorialBriefContent[keyof EditorialBriefContent];

const SECTION_RENDERERS: Record<
  keyof EditorialBriefContent,
  (value: SectionValue) => string
> = {
  market: renderMarket as (value: SectionValue) => string,
  audience: renderAudience as (value: SectionValue) => string,
  thesis: renderThesis as (value: SectionValue) => string,
  voice: renderVoice as (value: SectionValue) => string,
  contentStrategy: renderContentStrategy as (value: SectionValue) => string,
  guardrails: renderGuardrails as (value: SectionValue) => string,
  evidence: renderEvidence as (value: SectionValue) => string,
  packaging: renderPackaging as (value: SectionValue) => string,
  researchBasis: renderResearchBasis as (value: SectionValue) => string,
};

// ---------------------------------------------------------------------------
// Data-only editorial context (no instructions)
// ---------------------------------------------------------------------------

const ALL_DATA_SECTIONS: Array<keyof EditorialBriefContent> = [
  "market",
  "audience",
  "thesis",
  "voice",
  "contentStrategy",
  "guardrails",
  "evidence",
  "packaging",
  "researchBasis",
];

/**
 * Render an editorial bundle's data sections as XML, without any instruction
 * tags, authority markers, or scope-specific prose.
 *
 * Useful for planners and other read-only consumers that need the editorial
 * context as data rather than instructions.
 *
 * @param bundle - The editorial bundle to render, or `null` for legacy behavior.
 * @param params.chapterId - Required for chapter contract inclusion.
 * @returns Escaped XML string with `<editorial_context>` wrapper and data
 *          sections only, or `null` when the bundle is `null`.
 */
export function renderEditorialData(
  bundle: EditorialBundle | null,
  params: { chapterId?: string },
): string | null {
  if (bundle === null) return null;

  const { chapterId } = params;

  // Build data sections (all of them — no scope filtering)
  const parts: string[] = [];

  for (const sectionKey of ALL_DATA_SECTIONS) {
    const render = SECTION_RENDERERS[sectionKey];
    parts.push(render(bundle.content[sectionKey]));
  }

  // Chapter contract
  if (chapterId) {
    const contract = bundle.contracts.find((c) => c.chapterId === chapterId);
    if (!contract) {
      throw new Error(
        `Chapter contract not found for chapterId "${chapterId}" in data-only renderer`,
      );
    }
    parts.push(renderChapterContract(contract));
  }

  // Wrap in editorial_context (no authority, no instructions)
  return [
    `<editorial_context version="${bundle.version}" hash="${escapeXml(bundle.hash)}">`,
    ...parts,
    "</editorial_context>",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
//
// Only renderEditorialData is exported — instruction-bearing renderEditorialScope
// was removed in the prompt transparency migration (all instructions now come
// from prompt revisions in the registry).
