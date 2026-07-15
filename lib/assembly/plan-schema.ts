import { z } from 'zod';

// ---------------------------------------------------------------------------
// Zod schema — structural validation
// ---------------------------------------------------------------------------

export const assemblyPlanV1Schema = z.object({
  version: z.literal('1'),
  chapterIntent: z.string().min(1),
  opening: z.object({
    sourceFragmentIds: z.array(z.string().min(1)).min(1),
    approach: z.string().min(1),
  }),
  sections: z.array(
    z.object({
      id: z.string().min(1),
      purpose: z.string().min(1),
      sourceTreatments: z.array(
        z.object({
          fragmentId: z.string().min(1),
          action: z.enum(['keep', 'cut', 'move', 'merge', 'condense', 'expand-from-source']),
          reason: z.string().min(1),
        }),
      ),
      synthesis: z.string().nullable(),
      transitionIn: z.string().nullable(),
    }),
  ).min(1),
  mustCover: z.array(
    z.object({
      contractIndex: z.number().int().min(0),
      item: z.string().min(1),
      status: z.enum(['covered', 'bridgeable', 'unsupported']),
      sourceFragmentIds: z.array(z.string().min(1)),
      handling: z.string().min(1),
    }),
  ),
  redundancies: z.array(
    z.object({
      sourceFragmentIds: z.array(z.string().min(1)).min(2),
      resolution: z.string().min(1),
    }),
  ),
  illustrations: z.array(
    z.object({
      sourceFragmentIds: z.array(z.string().min(1)),
      purpose: z.string().min(1),
      handling: z.enum(['keep', 'develop', 'condense', 'remove']),
    }),
  ),
  bridges: z.array(
    z.object({
      fromSectionId: z.string().min(1),
      toSectionId: z.string().min(1),
      logicalConnection: z.string().min(1),
      factualBoundary: z.string().min(1),
    }),
  ),
  closing: z.object({
    sourceFragmentIds: z.array(z.string().min(1)),
    approach: z.string().min(1),
    transitionToNext: z.string().nullable(),
  }),
  unsupportedGaps: z.array(z.string().min(1)),
});

export type AssemblyPlanV1 = z.infer<typeof assemblyPlanV1Schema>;

// ---------------------------------------------------------------------------
// Semantic validation context
// ---------------------------------------------------------------------------

export interface AssemblyPlanValidationContext {
  fragmentIds: string[];
  mustCover: string[];
}

// ---------------------------------------------------------------------------
// Semantic validator
// ---------------------------------------------------------------------------

export function validateAssemblyPlan(
  plan: unknown,
  ctx: AssemblyPlanValidationContext,
): AssemblyPlanV1 {
  const parsed = assemblyPlanV1Schema.parse(plan);

  // Build sets for fast lookup
  const fragmentIdSet = new Set(ctx.fragmentIds);
  const sectionIds = new Set(parsed.sections.map((s) => s.id));

  // Validate mustCover completeness — every contract index must appear exactly once
  const contractIndices = parsed.mustCover.map((mc) => mc.contractIndex);
  // Check duplicates first
  const seen = new Set<number>();
  for (const idx of contractIndices) {
    if (seen.has(idx)) {
      throw new Error(`mustCover contains duplicate contractIndex ${idx}`);
    }
    seen.add(idx);
  }
  // Check missing indices
  for (let i = 0; i < ctx.mustCover.length; i++) {
    if (!seen.has(i)) {
      throw new Error(`mustCover contractIndex ${i} is missing from the plan`);
    }
  }

  // Validate mustCover item text matches contract
  for (const mc of parsed.mustCover) {
    if (ctx.mustCover[mc.contractIndex] !== mc.item) {
      throw new Error(
        `mustCover contractIndex ${mc.contractIndex} item "${mc.item}" does not match contract item "${ctx.mustCover[mc.contractIndex]}"`,
      );
    }
  }

  // Validate all referenced fragment IDs exist
  const allFragmentRefs = new Set<string>();
  for (const fid of parsed.opening.sourceFragmentIds) allFragmentRefs.add(fid);
  for (const section of parsed.sections) {
    for (const t of section.sourceTreatments) allFragmentRefs.add(t.fragmentId);
  }
  for (const mc of parsed.mustCover) {
    for (const fid of mc.sourceFragmentIds) allFragmentRefs.add(fid);
  }
  for (const r of parsed.redundancies) {
    for (const fid of r.sourceFragmentIds) allFragmentRefs.add(fid);
  }
  for (const ill of parsed.illustrations) {
    for (const fid of ill.sourceFragmentIds) allFragmentRefs.add(fid);
  }
  for (const fid of parsed.closing.sourceFragmentIds) allFragmentRefs.add(fid);

  for (const fid of allFragmentRefs) {
    if (!fragmentIdSet.has(fid)) {
      throw new Error(`Unknown fragment ID "${fid}" referenced in plan`);
    }
  }

  // Validate bridge section IDs exist
  const bridgeFromIds = new Set([...sectionIds, 'opening']);
  const bridgeToIds = new Set([...sectionIds, 'closing']);
  for (const bridge of parsed.bridges) {
    if (!bridgeFromIds.has(bridge.fromSectionId)) {
      throw new Error(`Unknown section ID "${bridge.fromSectionId}" referenced in bridge`);
    }
    if (!bridgeToIds.has(bridge.toSectionId)) {
      throw new Error(`Unknown section ID "${bridge.toSectionId}" referenced in bridge`);
    }
  }

  // Validate cut fragments are not used in illustrations
  const cutFragmentIds = new Set<string>();
  for (const section of parsed.sections) {
    for (const t of section.sourceTreatments) {
      if (t.action === 'cut') cutFragmentIds.add(t.fragmentId);
    }
  }
  for (const ill of parsed.illustrations) {
    for (const fid of ill.sourceFragmentIds) {
      if (cutFragmentIds.has(fid)) {
        throw new Error(`Fragment "${fid}" is cut but still referenced by an illustration`);
      }
    }
  }

  return parsed;
}
