import type {
  EditorialBriefContent,
  ChapterEditorialContract,
  EditorialScope,
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
// Scope instructions
// ---------------------------------------------------------------------------

function renderScopeInstructions(scope: EditorialScope): string {
  switch (scope) {
    case "assembly":
      return [
        "  <assembly_instructions>",
        '    <requirement name="coverage">Ensure all required mustCover items are addressed across the assembled fragments</requirement>',
        '    <requirement name="progression">Maintain logical progression from earlier to later fragments</requirement>',
        '    <requirement name="deduplication">Remove redundant content so each idea appears once in the strongest position</requirement>',
        '    <requirement name="transition">Ensure smooth transitions between sections, using the transitionToNext contract field</requirement>',
        "  </assembly_instructions>",
      ].join("\n");

    case "critique":
      return [
        "  <adherence_rubric>",
        '    <criterion name="audience">Does the chapter address the primary reader&apos;s situation, pain, and awareness level?</criterion>',
        '    <criterion name="promise">Does the chapter deliver on the core promise and respect the realistic boundary?</criterion>',
        '    <criterion name="coverage">Does the chapter cover all mustCover items and requiredScenarios from the contract?</criterion>',
        '    <criterion name="tone">Does the chapter match the prescribed tone, posture, and reading level?</criterion>',
        '    <criterion name="ethics">Does the chapter respect ethical principles and avoid forbidden claims and framing?</criterion>',
        '    <criterion name="evidence">Are factual claims supported by approved evidence sources or appropriately qualified?</criterion>',
        "  </adherence_rubric>",
      ].join("\n");

    case "correction":
      return [
        "  <correction_instructions>",
        "    <rule>Apply the critique findings while preserving correct material and tone</rule>",
        "    <rule>Do not introduce unsupported factual claims</rule>",
        "    <rule>Maintain the approved voice, posture, and reading level</rule>",
        "  </correction_instructions>",
      ].join("\n");

    case "fragment":
      return [
        "  <fragment_instructions>",
        "    <rule>Generate one useful unit; do not force packaging terms into fragments</rule>",
        "  </fragment_instructions>",
      ].join("\n");

    case "title":
      return [
        "  <title_instructions>",
        "    <rule>Use global packaging and audience; never inherit chapter-one bias</rule>",
        "  </title_instructions>",
      ].join("\n");

    case "placeholder-fill":
      return [
        "  <placeholder_fill_instructions>",
        '    <rule>Use contract evidence needs and approved RAG sources; do not invent statistics or citations</rule>',
        "  </placeholder_fill_instructions>",
      ].join("\n");
  }
}

// ---------------------------------------------------------------------------
// Section selectors per scope
// ---------------------------------------------------------------------------

interface ScopeProjection {
  sections: Array<keyof EditorialBriefContent>;
  includeContract: boolean;
}

const SCOPE_PROJECTIONS: Record<EditorialScope, ScopeProjection> = {
  fragment: {
    sections: ["market", "audience", "thesis", "voice", "guardrails"],
    includeContract: true,
  },
  assembly: {
    sections: [
      "market",
      "audience",
      "thesis",
      "voice",
      "contentStrategy",
      "guardrails",
    ],
    includeContract: true,
  },
  critique: {
    sections: [
      "market",
      "audience",
      "thesis",
      "voice",
      "contentStrategy",
      "guardrails",
      "evidence",
      "researchBasis",
    ],
    includeContract: true,
  },
  correction: {
    sections: [
      "market",
      "audience",
      "thesis",
      "voice",
      "contentStrategy",
      "guardrails",
      "evidence",
      "researchBasis",
    ],
    includeContract: true,
  },
  title: {
    sections: ["market", "audience", "thesis", "guardrails", "packaging"],
    includeContract: false,
  },
  "placeholder-fill": {
    sections: ["market", "audience", "thesis", "voice", "guardrails"],
    includeContract: true,
  },
};

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
// Public API
// ---------------------------------------------------------------------------

/**
 * Render an editorial bundle into a deterministic, scope-specific XML string
 * wrapped in `<editorial_context>` tags.
 *
 * @param bundle - The editorial bundle to render, or `null` for legacy behavior.
 * @param params.scope - The generation scope determining which sections to include.
 * @param params.chapterId - Required when the scope needs a chapter contract.
 * @returns Escaped XML string, or `null` when the bundle is `null`.
 */
export function renderEditorialScope(
  bundle: EditorialBundle | null,
  params: { scope: EditorialScope; chapterId?: string },
): string | null {
  if (bundle === null) return null;

  const { scope, chapterId } = params;
  const projection = SCOPE_PROJECTIONS[scope];

  // Build sections
  const parts: string[] = [];

  for (const sectionKey of projection.sections) {
    const render = SECTION_RENDERERS[sectionKey];
    parts.push(render(bundle.content[sectionKey]));
  }

  // Scope-specific instructions (assembly rubric, critique adherence, etc.)
  parts.push(renderScopeInstructions(scope));

  // Chapter contract
  if (projection.includeContract) {
    if (!chapterId) {
      throw new Error(
        `chapterId is required for scope "${scope}" which needs a chapter contract`,
      );
    }

    const contract = bundle.contracts.find((c) => c.chapterId === chapterId);
    if (!contract) {
      throw new Error(
        `Chapter contract not found for chapterId "${chapterId}" in scope "${scope}"`,
      );
    }

    parts.push(renderChapterContract(contract));
  }

  // Evidence policy (separate from general evidence section for placeholder-fill)
  if (scope === "placeholder-fill") {
    parts.push(renderEvidencePolicy(bundle.content.evidence));
  }

  // Wrap in editorial_context
  return [
    `<editorial_context version="${bundle.version}" hash="${escapeXml(bundle.hash)}">`,
    "  <authority>Approved project constraints. Apply them without quoting this block.</authority>",
    ...parts,
    "</editorial_context>",
  ].join("\n");
}
