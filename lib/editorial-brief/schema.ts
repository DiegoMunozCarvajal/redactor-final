import { z } from "zod";

// ---------------------------------------------------------------------------
// EditorialScope
// ---------------------------------------------------------------------------

export const editorialScopeSchema = z.union([
  z.literal("fragment"),
  z.literal("assembly"),
  z.literal("critique"),
  z.literal("correction"),
  z.literal("title"),
  z.literal("placeholder-fill"),
]);

export type EditorialScope = z.infer<typeof editorialScopeSchema>;

// ---------------------------------------------------------------------------
// Evidence mode
// ---------------------------------------------------------------------------

export const evidenceModeSchema = z.union([
  z.literal("rag_optional"),
  z.literal("rag_required_for_named_needs"),
]);

// ---------------------------------------------------------------------------
// market
// ---------------------------------------------------------------------------

const marketSchema = z
  .object({
    region: z.string().min(1).max(200),
    researchLanguage: z.string().min(1).max(100),
    manuscriptLanguage: z.string().min(1).max(100),
  })
  .strict();

// ---------------------------------------------------------------------------
// audience
// ---------------------------------------------------------------------------

const audienceSchema = z
  .object({
    primaryReader: z.string().min(1).max(2000),
    situation: z.string().min(1).max(2000),
    pain: z.string().min(1).max(2000),
    awareness: z.string().min(1).max(2000),
    objections: z.array(z.string().min(1).max(2000)).max(50),
  })
  .strict();

// ---------------------------------------------------------------------------
// thesis
// ---------------------------------------------------------------------------

const thesisSchema = z
  .object({
    coreProblem: z.string().min(1).max(2000),
    desiredOutcome: z.string().min(1).max(2000),
    promise: z.string().min(1).max(2000),
    mechanism: z.array(z.string().min(1).max(2000)).max(50),
    realisticBoundary: z.string().min(1).max(2000),
  })
  .strict();

// ---------------------------------------------------------------------------
// voice
// ---------------------------------------------------------------------------

const voiceSchema = z
  .object({
    tone: z.array(z.string().min(1).max(500)).max(50),
    posture: z.string().min(1).max(2000),
    readingLevel: z.string().min(1).max(500),
    avoid: z.array(z.string().min(1).max(2000)).max(50),
  })
  .strict();

// ---------------------------------------------------------------------------
// contentStrategy
// ---------------------------------------------------------------------------

const contentStrategySchema = z
  .object({
    pillars: z.array(z.string().min(1).max(2000)).max(50),
    requiredScenarios: z.array(z.string().min(1).max(2000)).max(50),
    recurringPattern: z.array(z.string().min(1).max(2000)).max(50),
    examplePolicy: z.string().min(1).max(2000),
  })
  .strict();

// ---------------------------------------------------------------------------
// guardrails
// ---------------------------------------------------------------------------

const guardrailsSchema = z
  .object({
    ethicalPrinciples: z.array(z.string().min(1).max(2000)).max(50),
    forbiddenClaims: z.array(z.string().min(1).max(2000)).max(50),
    forbiddenFraming: z.array(z.string().min(1).max(2000)).max(50),
  })
  .strict();

// ---------------------------------------------------------------------------
// evidence
// ---------------------------------------------------------------------------

const evidenceSchema = z
  .object({
    mode: evidenceModeSchema,
    citationPolicy: z.string().min(1).max(2000),
  })
  .strict();

// ---------------------------------------------------------------------------
// packaging
// ---------------------------------------------------------------------------

const packagingSchema = z
  .object({
    titleAngle: z.string().min(1).max(500),
    hook: z.string().min(1).max(2000),
    seoTerms: z.array(z.string().min(1).max(200)).max(50),
  })
  .strict();

// ---------------------------------------------------------------------------
// researchBasis
// ---------------------------------------------------------------------------

const researchBasisSchema = z
  .object({
    findings: z.array(z.string().min(1).max(2000)).max(50),
    inferences: z.array(z.string().min(1).max(2000)).max(50),
    limitations: z.array(z.string().min(1).max(2000)).max(50),
  })
  .strict();

// ---------------------------------------------------------------------------
// EditorialBriefContent
// ---------------------------------------------------------------------------

export const editorialBriefContentSchema = z
  .object({
    market: marketSchema,
    audience: audienceSchema,
    thesis: thesisSchema,
    voice: voiceSchema,
    contentStrategy: contentStrategySchema,
    guardrails: guardrailsSchema,
    evidence: evidenceSchema,
    packaging: packagingSchema,
    researchBasis: researchBasisSchema,
  })
  .strict();

export type EditorialBriefContent = z.infer<typeof editorialBriefContentSchema>;

// ---------------------------------------------------------------------------
// ChapterEditorialContract
// ---------------------------------------------------------------------------

const evidenceNeedSchema = z
  .object({
    placeholderName: z.string().min(1).max(200),
    query: z.string().min(1).max(2000),
    required: z.boolean(),
  })
  .strict();

export const chapterEditorialContractSchema = z
  .object({
    chapterId: z.string().uuid(),
    jobToBeDone: z.string().min(1).max(2000),
    readerShift: z.string().min(1).max(2000),
    mustCover: z.array(z.string().min(1).max(2000)).max(50),
    requiredScenarios: z.array(z.string().min(1).max(2000)).max(50),
    evidenceNeeds: z.array(evidenceNeedSchema).max(50),
    toneAdjustment: z.string().min(1).max(2000),
    avoidOverlapWith: z.array(z.string().min(1).max(2000)).max(50),
    transitionToNext: z.string().min(1).max(2000),
  })
  .strict();

export type ChapterEditorialContract = z.infer<
  typeof chapterEditorialContractSchema
>;

// ---------------------------------------------------------------------------
// EditorialBriefBundleInput
// ---------------------------------------------------------------------------

/**
 * Schema for validating bundle input (content + contracts + source bindings).
 * Rejects duplicate chapter ids via a super refinement.
 */
export const editorialBriefBundleInputSchema = z
  .object({
    content: editorialBriefContentSchema,
    contracts: z.array(chapterEditorialContractSchema).min(1).max(100),
    evidenceSourceIds: z.array(z.string().uuid()).max(100),
  })
  .strict()
  .superRefine((data, ctx) => {
    const ids = data.contracts.map((c) => c.chapterId);
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate chapter id: ${id}`,
          path: ["contracts"],
        });
        return;
      }
      seen.add(id);
    }
  });

export type EditorialBriefBundleInput = z.infer<
  typeof editorialBriefBundleInputSchema
>;

// ---------------------------------------------------------------------------
// EditorialSnapshot
// ---------------------------------------------------------------------------

const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/;

export const editorialSnapshotSchema = z
  .object({
    editorialBriefId: z.string().uuid(),
    editorialBriefVersion: z.number().int().positive(),
    editorialBriefHash: z.string().regex(SHA256_HEX_REGEX),
  })
  .strict();

export type EditorialSnapshot = z.infer<typeof editorialSnapshotSchema>;

// ---------------------------------------------------------------------------
// EditorialBundle (full bundle with id/version/hash — not Zod-inferred since
// id, version, hash are DB-generated)
// ---------------------------------------------------------------------------

export interface EditorialBundle {
  content: EditorialBriefContent;
  contracts: ChapterEditorialContract[];
  evidenceSourceIds: string[];
  id: string;
  version: number;
  hash: string;
}
