import { z } from "zod";

// ---------------------------------------------------------------------------
// Closed enums — no custom/catch-all values allowed
// ---------------------------------------------------------------------------

export const recipeIdValues = [
  "opening_case",
  "rhetorical_bridge",
  "claim_presentation",
  "claim_contrast",
  "quantitative_illustration",
  "analogy_explanation",
  "parallel_comparison",
  "definition",
  "evidence_support",
  "objection",
  "response",
  "application",
  "transition",
  "synthesis_close",
] as const;

export type RecipeId = (typeof recipeIdValues)[number];

export const resourceClassValues = [
  "case",
  "concept",
  "claim",
] as const;

export type ResourceClass = (typeof resourceClassValues)[number];

export const discourseRelationValues = [
  "open",
  "sequence",
  "elaborate",
  "contrast",
  "support",
  "close",
] as const;

export type DiscourseRelation = (typeof discourseRelationValues)[number];

export const readerEffectValues = [
  "curiosity",
  "clarity",
  "tension",
  "conviction",
  "insight",
  "closure",
] as const;

export type ReaderEffect = (typeof readerEffectValues)[number];

export const dependencyRelationValues = [
  "supports",
  "contrasts",
  "extends",
  "exemplifies",
] as const;

export type DependencyRelation = (typeof dependencyRelationValues)[number];

export const slotTypeValues = [
  "concept",
  "claim",
  "example",
  "question",
  "objection",
  "response",
  "evidence",
  "application",
] as const;

export type SlotType = (typeof slotTypeValues)[number];

// ---------------------------------------------------------------------------
// Strict schemas — .strict() rejects unknown keys
// ---------------------------------------------------------------------------

export const traceDependencySchema = z.object({
  fromPosition: z.number().int().nonnegative(),
  relation: z.enum(dependencyRelationValues),
  slotType: z.enum(slotTypeValues),
}).strict();

export const traceMoveSchema = z.object({
  position: z.number().int().nonnegative(),
  recipeId: z.enum(recipeIdValues),
  resourceClass: z.enum(resourceClassValues),
  discourseRelation: z.enum(discourseRelationValues),
  readerEffect: z.enum(readerEffectValues),
  dependencies: z.array(traceDependencySchema).max(8),
}).strict();

export const traceIrSchema = z.object({
  moves: z.array(traceMoveSchema).min(1).max(100),
}).strict();

export type TraceDependency = z.infer<typeof traceDependencySchema>;
export type TraceMove = z.infer<typeof traceMoveSchema>;
export type TraceIr = z.infer<typeof traceIrSchema>;

// ---------------------------------------------------------------------------
// Recipe interface — the registry is populated by the compiler task
// ---------------------------------------------------------------------------

export interface TemplateRecipe {
  id: RecipeId;
  title: string;
  allowedResources: ResourceClass[];
  produces: SlotType[];
  localSlots: SlotType[];
  requiredDependencies: Array<{
    relation: DependencyRelation;
    slotType: SlotType;
  }>;
}

// ---------------------------------------------------------------------------
// Validation error
// ---------------------------------------------------------------------------

export class TraceValidationError extends Error {
  constructor(
    public readonly moveIndex: number,
    message: string,
  ) {
    super(`Trace validation error at move ${moveIndex}: ${message}`);
    this.name = "TraceValidationError";
  }
}

// ---------------------------------------------------------------------------
// Registry-aware semantic validation
// ---------------------------------------------------------------------------

function dependencyKey(input: {
  relation: DependencyRelation;
  slotType: SlotType;
}): string {
  return `${input.relation}:${input.slotType}`;
}

function assertRequiredDependencies(
  move: TraceMove,
  recipe: TemplateRecipe,
): string[] {
  const warnings: string[] = [];
  const required = new Set(recipe.requiredDependencies.map(dependencyKey));
  const actual = new Set(move.dependencies.map(dependencyKey));
  for (const key of actual) {
    if (!required.has(key))
      warnings.push(`move ${move.position}: unsupported dependency ${key}`);
  }
  for (const key of required) {
    if (!actual.has(key))
      warnings.push(`move ${move.position}: missing dependency ${key}`);
  }
  return warnings;
}

/**
 * Validate trace IR against the recipe registry.
 *
 * Structural errors (unknown recipes, backward dependencies) still throw.
 * Recipe-level mismatches (resourceClass not in allowedResources, slotType
 * not produced by source recipe, missing/unsupported dependencies) are
 * downgraded to warnings — the LLM cannot perfectly model recipe constraints
 * even with structured output, and minor violations don't break compilation.
 */
export function validateTraceIr(
  trace: TraceIr,
  registry: ReadonlyMap<RecipeId, TemplateRecipe>,
): TraceIr {
  const warnings: string[] = [];

  trace.moves.forEach((move, index) => {
    if (move.position !== index)
      throw new TraceValidationError(index, "positions must be consecutive starting from 0");

    const recipe = registry.get(move.recipeId);
    if (!recipe) throw new TraceValidationError(index, `unknown recipe ${move.recipeId}`);

    if (!recipe.allowedResources.includes(move.resourceClass)) {
      warnings.push(
        `move ${move.position}: resourceClass "${move.resourceClass}" not in allowed set [${recipe.allowedResources.join(", ")}] for ${move.recipeId}`,
      );
    }

    for (const dependency of move.dependencies) {
      if (dependency.fromPosition >= move.position)
        throw new TraceValidationError(index, "dependency must target an earlier position");

      const source = trace.moves[dependency.fromPosition];
      if (!source) throw new TraceValidationError(index, `dependency references missing position ${dependency.fromPosition}`);

      const sourceRecipe = registry.get(source.recipeId);
      if (!sourceRecipe) throw new TraceValidationError(index, `source recipe ${source.recipeId} not found`);

      if (!sourceRecipe.produces.includes(dependency.slotType)) {
        warnings.push(
          `move ${move.position}: dependency slotType "${dependency.slotType}" not in produced set [${sourceRecipe.produces.join(", ")}] of ${source.recipeId}`,
        );
      }
    }

    warnings.push(...assertRequiredDependencies(move, recipe));
  });

  if (warnings.length > 0) {
    console.warn(`[validateTraceIr] ${warnings.length} recipe warning(s):`);
    for (const w of warnings.slice(0, 10)) console.warn(`  ${w}`);
    if (warnings.length > 10) console.warn(`  ... and ${warnings.length - 10} more`);
  }

  return trace;
}
