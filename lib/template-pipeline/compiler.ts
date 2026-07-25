import { sha256Canonical } from "./hash";
import { TEMPLATE_RECIPE_REGISTRY } from "./recipes";
import type { TraceIr, TraceMove, SlotType, RecipeId } from "./trace-ir";

// ---------------------------------------------------------------------------
// Compiled types
// ---------------------------------------------------------------------------

export interface CompiledPlaceholder {
  name: string;
  function: string;
  dependsOn: string[];
}

export interface CompiledBlock {
  name: string;
  function?: string;
  content: string;
  userPrompt: string;
  sourceContext?: string;
  notes?: string;
  placeholders: CompiledPlaceholder[];
}

export interface CompiledTemplate {
  blocks: CompiledBlock[];
  artifactHash: string;
}

// ---------------------------------------------------------------------------
// Render input — what the compiler passes to each recipe
// ---------------------------------------------------------------------------

export interface RecipeRenderInput {
  position: number;
  resourceClass: string;
  /** Produce a new symbol name for a local slot. */
  produce(slot: SlotType): string;
  /** Resolved dependency names in the order of move.dependencies. */
  depNames: string[];
}

export interface RecipeRenderResult {
  name: string;
  content: string;
  userPrompt: string;
  function: string;
  notes: string | null;
  placeholders: Array<{ name: string; function: string }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const COMPILER_VERSION = "template-compiler-v1";
export const COMPILER_HASH = sha256Canonical({ version: COMPILER_VERSION });

// ---------------------------------------------------------------------------
// Canonical slot prefix mapping
// ---------------------------------------------------------------------------

const slotPrefixes: Record<SlotType, string> = {
  concept: "concepto",
  claim: "afirmacion",
  example: "ejemplo",
  question: "pregunta",
  objection: "objecion",
  response: "respuesta",
  evidence: "evidencia",
  application: "aplicacion",
};

// ---------------------------------------------------------------------------
// Symbol table — deterministic naming
// ---------------------------------------------------------------------------

class SymbolTable {
  private counters = new Map<SlotType, number>();
  private produced = new Map<string, string>(); // key: "position:slotType" → name

  produce(position: number, slot: SlotType): string {
    const count = (this.counters.get(slot) ?? 0) + 1;
    this.counters.set(slot, count);
    const name = `${slotPrefixes[slot]}_${count}`;
    this.produced.set(`${position}:${slot}`, name);
    return name;
  }

  resolve(position: number, slot: SlotType): string {
    const name = this.produced.get(`${position}:${slot}`);
    if (!name) throw new UnsupportedRecipeError(`Missing symbol at position ${position} slot ${slot}`);
    return name;
  }

  resolveDependencies(deps: TraceMove["dependencies"]): string[] {
    return deps.map((d) => this.resolve(d.fromPosition, d.slotType));
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class CompilerInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompilerInvariantError";
  }
}

export class UnsupportedRecipeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedRecipeError";
  }
}

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

export function compileTrace(trace: TraceIr): CompiledTemplate {
  const symbols = new SymbolTable();
  const recipeCatalogHash = sha256Canonical(
    [...TEMPLATE_RECIPE_REGISTRY.entries()].map(([id]) => id),
  );
  const blocks: CompiledBlock[] = [];

  for (const move of trace.moves) {
    const recipe = TEMPLATE_RECIPE_REGISTRY.get(move.recipeId);
    if (!recipe) throw new UnsupportedRecipeError(`unknown recipe ${move.recipeId}`);

    // Resolve dependency names before calling render
    const depNames = symbols.resolveDependencies(move.dependencies);

    const result = (recipe as unknown as { render(input: RecipeRenderInput): RecipeRenderResult }).render({
      position: move.position,
      resourceClass: move.resourceClass,
      produce: (slot: SlotType) => symbols.produce(move.position, slot),
      depNames,
    });

    // Convert render result to compiled block
    const depNameSet = new Set(depNames);
    const placeholders: CompiledPlaceholder[] = result.placeholders.map((ph: { name: string; function: string }) => {
      const deps: string[] = [];
      // Placeholder IS a dependency reference → no self-dependsOn.
      // Other placeholders that reference dep names → mark them.
      if (!depNameSet.has(ph.name)) {
        for (const depName of depNames) {
          if (
            result.content.includes(`{${depName}}`) ||
            result.userPrompt.includes(`{${depName}}`)
          ) {
            if (!deps.includes(depName)) deps.push(depName);
          }
        }
      }
      return { ...ph, dependsOn: deps };
    });

    blocks.push({
      name: result.name,
      content: result.content,
      userPrompt: result.userPrompt,
      function: result.function,
      notes: result.notes ?? undefined,
      sourceContext: undefined,
      placeholders,
    });
  }

  // -----------------------------------------------------------------------
  // Compute artifact hash
  // -----------------------------------------------------------------------
  const artifactHash = sha256Canonical({
    compilerVersion: COMPILER_VERSION,
    compilerHash: COMPILER_HASH,
    recipeCatalogHash,
    traceIr: trace,
    blocks,
  });

  // -----------------------------------------------------------------------
  // Invariants
  // -----------------------------------------------------------------------
  assertCompilerInvariants(blocks);

  return { blocks, artifactHash };
}

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

const PLACEHOLDER_RE = /(?<!\{)\{([a-z][a-z0-9_]*)\}(?!\})/g;

function extract(value: string): Set<string> {
  return new Set([...value.matchAll(PLACEHOLDER_RE)].map((match) => match[1]));
}

function assertSameSet(left: Set<string>, right: Set<string>): void {
  if (left.size !== right.size || [...left].some((value) => !right.has(value)))
    throw new CompilerInvariantError("placeholder sets differ");
}

function assertUniqueWithinBlock(names: string[]): void {
  if (new Set(names).size !== names.length)
    throw new CompilerInvariantError("duplicate placeholder in block");
}

function assertNoRuntimeMarkers(values: string[]): void {
  if (values.some((value) => /\{\{[A-Z][A-Z0-9_]*\}\}/.test(value)))
    throw new CompilerInvariantError("unresolved runtime marker");
}

function assertCanonicalNames(
  placeholders: CompiledPlaceholder[],
): void {
  if (placeholders.some((item) => !/^[a-z][a-z0-9_]*$/.test(item.name)))
    throw new CompilerInvariantError("non-canonical placeholder name");
}

function allStrings(block: CompiledBlock): string[] {
  return [
    block.name,
    block.content,
    block.userPrompt,
    block.function ?? "",
    block.sourceContext ?? "",
    block.notes ?? "",
    ...block.placeholders.flatMap((item) => [
      item.name,
      item.function,
      ...item.dependsOn,
    ]),
  ];
}

function assertAcyclicDeclaredDependencies(blocks: CompiledBlock[]): void {
  const declarations = new Map<
    string,
    { function: string; dependsOn: string[]; firstBlock: number }
  >();
  blocks.forEach((block, blockIndex) => {
    block.placeholders.forEach((item) => {
      const prior = declarations.get(item.name);
      if (
        prior
        && (prior.function !== item.function
          || JSON.stringify(prior.dependsOn) !== JSON.stringify(item.dependsOn))
      ) {
        throw new CompilerInvariantError(
          `conflicting placeholder declaration ${item.name}`,
        );
      }
      if (!prior) declarations.set(item.name, { function: item.function, dependsOn: item.dependsOn, firstBlock: blockIndex });
    });
  });
  for (const [name, declaration] of declarations) {
    for (const dependency of declaration.dependsOn) {
      const target = declarations.get(dependency);
      if (!target) throw new CompilerInvariantError(`missing placeholder ${dependency}`);
      if (target.firstBlock >= declaration.firstBlock)
        throw new CompilerInvariantError(`non-earlier dependency ${name}:${dependency}`);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (name: string): void => {
    if (visiting.has(name))
      throw new CompilerInvariantError(`placeholder dependency cycle at ${name}`);
    if (visited.has(name)) return;
    const declaration = declarations.get(name);
    if (!declaration)
      throw new CompilerInvariantError(`missing placeholder ${name}`);
    visiting.add(name);
    for (const dependency of declaration.dependsOn) visit(dependency);
    visiting.delete(name);
    visited.add(name);
  };
  for (const name of declarations.keys()) visit(name);
}

export function assertCompilerInvariants(blocks: CompiledBlock[]): void {
  for (const block of blocks) {
    const names = block.placeholders.map((p) => p.name);
    assertUniqueWithinBlock(names);
    const contentSet = extract(block.content);
    const userPromptSet = extract(block.userPrompt);
    const placeholderNameSet = new Set(names);
    assertSameSet(contentSet, placeholderNameSet);
    assertSameSet(userPromptSet, placeholderNameSet);
    assertNoRuntimeMarkers(allStrings(block));
    assertCanonicalNames(block.placeholders);
  }
  assertAcyclicDeclaredDependencies(blocks);
}
