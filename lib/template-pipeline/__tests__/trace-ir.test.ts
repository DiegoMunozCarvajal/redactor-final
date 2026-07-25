import { describe, expect, it } from "vitest";
import {
  traceIrSchema,
  validateTraceIr,
  TraceValidationError,
  type TraceIr,
  type TraceMove,
  type TemplateRecipe,
  type RecipeId,
  type ResourceClass,
  type DependencyRelation,
  type SlotType,
} from "../trace-ir";

function move(overrides: Partial<TraceMove> = {}): TraceMove {
  return {
    position: 0,
    recipeId: "opening_case",
    resourceClass: "case",
    discourseRelation: "open",
    readerEffect: "curiosity",
    dependencies: [],
    ...overrides,
  };
}

const testRegistry = new Map<RecipeId, TemplateRecipe>([
  [
    "opening_case",
    {
      id: "opening_case",
      title: "Opening Case",
      allowedResources: ["case"],
      produces: ["example", "concept"],
      localSlots: ["example", "concept"],
      requiredDependencies: [],
    },
  ],
  [
    "rhetorical_bridge",
    {
      id: "rhetorical_bridge",
      title: "Rhetorical Bridge",
      allowedResources: ["concept"],
      produces: ["concept"],
      localSlots: [],
      requiredDependencies: [{ relation: "supports", slotType: "concept" }],
    },
  ],
  [
    "claim_presentation",
    {
      id: "claim_presentation",
      title: "Claim Presentation",
      allowedResources: ["claim"],
      produces: ["claim"],
      localSlots: ["claim"],
      requiredDependencies: [],
    },
  ],
  [
    "transition",
    {
      id: "transition",
      title: "Transition",
      allowedResources: ["concept"],
      produces: [],
      localSlots: [],
      requiredDependencies: [{ relation: "supports", slotType: "concept" }],
    },
  ],
]);

describe("traceIrSchema", () => {
  it("rejects every free-text field from v1", () => {
    const result = traceIrSchema.safeParse({
      moves: [
        {
          position: 0,
          recipeId: "opening_case",
          resourceClass: "case",
          discourseRelation: "open",
          readerEffect: "curiosity",
          dependencies: [],
          description: "ice melts after gradual heat",
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown keys at top level", () => {
    const result = traceIrSchema.safeParse({
      moves: [move()],
      summary: "extra field",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown keys in moves", () => {
    const result = traceIrSchema.safeParse({
      moves: [{ ...move(), notes: "extra" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown keys in dependencies", () => {
    const result = traceIrSchema.safeParse({
      moves: [
        {
          ...move(),
          dependencies: [
            {
              fromPosition: 0,
              relation: "supports",
              slotType: "claim",
              label: "extra",
            } as Record<string, unknown>,
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid trace", () => {
    const result = traceIrSchema.safeParse({
      moves: [move()],
    });
    expect(result.success).toBe(true);
  });
});

describe("validateTraceIr", () => {
  it("rejects forward dependencies", () => {
    expect(() =>
      validateTraceIr(
        {
          moves: [
            move({
              position: 0,
              dependencies: [
                { fromPosition: 1, relation: "supports", slotType: "claim" },
              ],
            }),
            move({ position: 1 }),
          ],
        },
        testRegistry,
      ),
    ).toThrow(TraceValidationError);
  });

  it("rejects non-consecutive positions", () => {
    expect(() =>
      validateTraceIr(
        {
          moves: [move({ position: 0 }), move({ position: 2 })],
        },
        testRegistry,
      ),
    ).toThrow("consecutive");
  });

  it("rejects duplicate positions", () => {
    expect(() =>
      validateTraceIr(
        {
          moves: [move({ position: 0 }), move({ position: 0 })],
        },
        testRegistry,
      ),
    ).toThrow("consecutive");
  });

  it("rejects unknown recipe", () => {
    expect(() =>
      validateTraceIr(
        {
          moves: [
            move({ recipeId: "unknown_recipe" as RecipeId }),
          ],
        },
        testRegistry,
      ),
    ).toThrow("unknown recipe");
  });

  it("rejects invalid resource for recipe", () => {
    expect(() =>
      validateTraceIr(
        {
          moves: [
            move({
              recipeId: "opening_case",
              resourceClass: "claim" as ResourceClass,
            }),
          ],
        },
        testRegistry,
      ),
    ).toThrow(/resource.*not allowed/);
  });

  it("rejects missing required dependency", () => {
    expect(() =>
      validateTraceIr(
        {
          moves: [
            move({
              recipeId: "rhetorical_bridge",
              resourceClass: "concept",
              dependencies: [],
            }),
          ],
        },
        testRegistry,
      ),
    ).toThrow("missing dependency");
  });

  it("rejects unsupported dependency", () => {
    expect(() =>
      validateTraceIr(
        {
          moves: [
            move({
              position: 0,
              recipeId: "opening_case",
            }),
            move({
              position: 1,
              recipeId: "rhetorical_bridge",
              resourceClass: "concept",
              dependencies: [
                {
                  fromPosition: 0,
                  relation: "contrasts" as DependencyRelation,
                  slotType: "concept" as SlotType,
                },
              ],
            }),
          ],
        },
        testRegistry,
      ),
    ).toThrow(/unsupported dependency/);
  });

  it("rejects dependency referencing slot not produced by source", () => {
    expect(() =>
      validateTraceIr(
        {
          moves: [
            move({
              position: 0,
              recipeId: "opening_case",
            }),
            move({
              position: 1,
              recipeId: "rhetorical_bridge",
              resourceClass: "concept",
              dependencies: [
                { fromPosition: 0, relation: "supports", slotType: "concept" },
              ],
            }),
          ],
        },
        testRegistry,
      ),
    ).not.toThrow(); // opening_case produces "concept" — this is valid
  });

  it("rejects dependency on unproduced slot", () => {
    expect(() =>
      validateTraceIr(
        {
          moves: [
            move({
              position: 0,
              recipeId: "opening_case",
            }),
            move({
              position: 1,
              recipeId: "transition",
              resourceClass: "concept",
              dependencies: [
                { fromPosition: 0, relation: "supports", slotType: "concept" },
              ],
            }),
          ],
        },
        testRegistry,
      ),
    ).not.toThrow(); // opening_case produces "concept", transition requires it

    // But opening_case does NOT produce "claim"
    expect(() =>
      validateTraceIr(
        {
          moves: [
            move({
              position: 0,
              recipeId: "opening_case",
            }),
            move({
              position: 1,
              recipeId: "transition",
              resourceClass: "concept",
              dependencies: [
                { fromPosition: 0, relation: "supports", slotType: "claim" },
              ],
            }),
          ],
        },
        testRegistry,
      ),
    ).toThrow(/dependency slot.*not produced/);
  });

  it("accepts a valid multi-move trace", () => {
    expect(() =>
      validateTraceIr(
        {
          moves: [
            move({ position: 0, recipeId: "opening_case" }),
            move({
              position: 1,
              recipeId: "rhetorical_bridge",
              resourceClass: "concept",
              dependencies: [
                { fromPosition: 0, relation: "supports", slotType: "concept" },
              ],
            }),
          ],
        },
        testRegistry,
      ),
    ).not.toThrow();
  });
});
