import { describe, expect, it } from "vitest";
import {
  compileTrace,
  type CompiledBlock,
  type CompiledPlaceholder,
} from "../compiler";
import { TEMPLATE_RECIPE_REGISTRY } from "../recipes";
import type { TraceIr, TraceMove } from "../trace-ir";

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

const validTrace: TraceIr = {
  moves: [
    { position: 0, recipeId: "opening_case", resourceClass: "case", discourseRelation: "open", readerEffect: "curiosity", dependencies: [] },
    { position: 1, recipeId: "claim_presentation", resourceClass: "claim", discourseRelation: "sequence", readerEffect: "conviction", dependencies: [] },
    { position: 2, recipeId: "synthesis_close", resourceClass: "claim", discourseRelation: "close", readerEffect: "closure", dependencies: [{ fromPosition: 1, relation: "supports", slotType: "claim" }] },
  ],
};

describe("compileTrace", () => {
  it("produces byte-identical output and hash", () => {
    const first = compileTrace(validTrace);
    const second = compileTrace(validTrace);
    expect(second).toEqual(first);
    expect(second.artifactHash).toBe(first.artifactHash);
  });

  it("owns names and reuses dependency symbols", () => {
    const trace: TraceIr = {
      moves: [
        move({ position: 0, recipeId: "opening_case" }),
        {
          position: 1,
          recipeId: "rhetorical_bridge",
          resourceClass: "concept",
          discourseRelation: "sequence",
          readerEffect: "clarity",
          dependencies: [{ fromPosition: 0, relation: "supports", slotType: "concept" }],
        },
      ],
    };
    const result = compileTrace(trace);
    // opening_case produces concepto_1 and ejemplo_1
    expect(result.blocks[0].placeholders.map(p => p.name)).toContain("concepto_1");
    // rhetorical_bridge depends on concepto_1
    expect(result.blocks[1].content).toContain("{concepto_1}");
    expect(result.blocks[1].placeholders.map(p => p.name)).toContain("concepto_1");
  });

  it("all recipe IDs compile", () => {
    for (const rid of TEMPLATE_RECIPE_REGISTRY.keys()) {
      const recipe = TEMPLATE_RECIPE_REGISTRY.get(rid)!;
      const requiredDeps = recipe.requiredDependencies;

      let moves: TraceMove[];
      if (requiredDeps.length > 0) {
        // Build a provider that satisfies the first required dep
        const { recipeId: providerId, resourceClass: providerResource } =
          providerForSlot(requiredDeps[0].slotType);
        moves = [
          {
            position: 0,
            recipeId: providerId,
            resourceClass: providerResource,
            discourseRelation: "open",
            readerEffect: "curiosity",
            dependencies: [],
          },
          {
            position: 1,
            recipeId: rid,
            resourceClass: recipe.allowedResources[0],
            discourseRelation: "sequence",
            readerEffect: "clarity",
            dependencies: requiredDeps.map((d) => ({
              fromPosition: 0,
              relation: d.relation,
              slotType: d.slotType as never,
            })),
          },
        ];
      } else {
        moves = [
          {
            position: 0,
            recipeId: rid,
            resourceClass: recipe.allowedResources[0],
            discourseRelation: "open",
            readerEffect: "curiosity",
            dependencies: [],
          },
        ];
      }
      expect(() => compileTrace({ moves })).not.toThrow();
    }
  });

  function providerForSlot(slot: string): { recipeId: TraceMove["recipeId"]; resourceClass: TraceMove["resourceClass"] } {
    switch (slot) {
      case "concept": return { recipeId: "definition", resourceClass: "concept" };
      case "claim": return { recipeId: "claim_presentation", resourceClass: "claim" };
      case "objection": return { recipeId: "parallel_comparison", resourceClass: "case" };
      default: return { recipeId: "opening_case", resourceClass: "case" };
    }
  }

  it("throws on unknown recipe", () => {
    const badTrace: TraceIr = {
      moves: [
        { ...move(), recipeId: "unknown_recipe" as never },
      ],
    };
    expect(() => compileTrace(badTrace as TraceIr)).toThrow("unknown recipe");
  });

  it("no source fixture phrase in compiled output", () => {
    const result = compileTrace(validTrace);
    const allText = JSON.stringify(result.blocks);
    expect(allText).not.toContain("Distinct source");
    expect(allText).not.toContain("capitulo fuente");
  });

  it("no runtime markers in compiled output", () => {
    const result = compileTrace(validTrace);
    const allText = JSON.stringify(result.blocks);
    expect(/\{\{[A-Z][A-Z0-9_]*\}\}/.test(allText)).toBe(false);
  });

  it("placeholder names are canonical", () => {
    const result = compileTrace(validTrace);
    for (const block of result.blocks) {
      for (const ph of block.placeholders) {
        expect(ph.name).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    }
  });

  it("placeholder content and userPrompt use consistent names", () => {
    const result = compileTrace(validTrace);
    for (const block of result.blocks) {
      const phNames = new Set(block.placeholders.map(p => p.name));
      const contentRefs = [...block.content.matchAll(/\{([a-z][a-z0-9_]*)\}/g)].map(m => m[1]);
      const userPromptRefs = [...block.userPrompt.matchAll(/\{([a-z][a-z0-9_]*)\}/g)].map(m => m[1]);
      // Each set should match
      const contentSet = new Set(contentRefs);
      const promptSet = new Set(userPromptRefs);
      // content refs should equal placeholder names
      for (const r of contentRefs) {
        expect(phNames.has(r)).toBe(true);
      }
      for (const p of phNames) {
        expect(contentSet.has(p)).toBe(true);
      }
      // userPrompt refs should equal placeholder names
      for (const r of userPromptRefs) {
        expect(phNames.has(r)).toBe(true);
      }
      for (const p of phNames) {
        expect(promptSet.has(p)).toBe(true);
      }
    }
  });
});
