# Source Contamination Stage B: Trace IR and Compiler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace source-bearing free-text traces and creative Template Generator Pass 2 with a closed Trace IR, private source profile, and deterministic code-owned compiler.

**Architecture:** Source text reaches exactly two classifier operations: source-risk profiling and Rhetoric Trace v2. Both return strict structured data; execution persistence redacts the source marker. A validated closed IR enters an explicit recipe registry, which deterministically owns all prose and placeholder names. Per-chapter artifacts persist before one atomic finalization activates the template.

**Tech Stack:** Next.js 15, TypeScript, Zod, Drizzle/PostgreSQL with pgvector, OpenAI embeddings, Trigger.dev 4, Vitest.

---

## Dependencies and delivery boundary

- Run after Stage A: `docs/superpowers/plans/2026-07-22-source-contamination-stage-a-containment-lineage.md`
- Approved design: `docs/superpowers/specs/2026-07-22-generic-source-contamination-prevention-design.md`
- This stage activates new clean templates. It does not yet enforce semantic source checks on manuscript output; Stage C adds that gate.
- Archived `template-generator` definitions/revisions remain queryable for history but never execute in the v2 creation path.

## File map

- Create `supabase/migrations/20260722000001_seed_safe_template_pipeline.sql`: prompt-kind checks, v2 profiler/trace revisions, defaults, and safe configuration.
- Modify prompt registry schema/contracts/UI kind maps for `source-risk-profiler`.
- Modify `lib/prompts/executor.ts`: redact sensitive marker values only in persisted messages.
- Create `lib/template-pipeline/source-profile.ts`: deterministic chunks, hashed shingles, embeddings, profiler validation, persistence.
- Create `lib/template-pipeline/trace-ir.ts`: strict enums/schema and semantic validator.
- Create `lib/template-pipeline/recipes.ts`: explicit trusted recipe catalog.
- Create `lib/template-pipeline/compiler.ts`: deterministic symbol table, compiled blocks, hashes, invariants.
- Create `lib/template-pipeline/artifacts.ts`: idempotent artifact persistence and atomic finalization.
- Rewrite `trigger/generate-template.ts`: profile → trace → validate → compile → artifact → finalize.
- Modify `app/api/books/auto/route.ts`: require v2 trace revision, remove Template Generator revision.
- Modify `app/templates/create/page.tsx`: remove Generator selector and show compiler/policy metadata.
- Add unit, property, migration, executor, compiler, orchestration, and UI tests.

### Task 1: Add v2 prompt kinds and redact source-bearing execution messages

**Files:**

- Create: `lib/__tests__/safe-template-prompt-migration.test.ts`
- Create: `supabase/migrations/20260722000001_seed_safe_template_pipeline.sql`
- Modify: `lib/db/schema/prompt-registry.ts:5`
- Modify: `lib/prompts/contracts.ts:6`
- Modify: `lib/prompts/kinds.ts:3`
- Modify: `lib/prompts/executor.ts:16`
- Modify: `lib/prompts/__tests__/executor.test.ts`
- Modify: `components/prompts/__tests__/prompt-registry-ui.test.tsx`

- [ ] **Step 1: Write failing migration and executor tests**

Migration assertions:

```ts
expect(sql).toContain("'source-risk-profiler'");
expect(sql).toContain("'trace-ir-v2'");
expect(sql).toContain("{{CAPITULO_FUENTE}}");
expect(sql).not.toContain("{{RHETORIC_TRACE}}");
expect(sql).toContain("'source-profile-v1'");
```

Executor assertion:

```ts
it("sends real source but persists a hash-only redaction", async () => {
  await executeVersionedPrompt({
    stage: "source-profile",
    kind: "source-risk-profiler",
    markerValues: {
      "{{CAPITULO_FUENTE}}": "secret source chapter",
      "{{OUTPUT_SCHEMA}}": "{}",
    },
    messagePersistence: {
      mode: "redact-sensitive-markers",
      sensitiveMarkers: ["{{CAPITULO_FUENTE}}"],
    },
    model: "test-model",
  });

  expect(mockGenerateCompletion).toHaveBeenCalledWith(expect.objectContaining({
    userPrompt: expect.stringContaining("secret source chapter"),
  }));
  expect(insertedValues.messages).not.toContainEqual(
    expect.objectContaining({ content: expect.stringContaining("secret source chapter") }),
  );
  expect(JSON.stringify(insertedValues.messages))
    .toMatch(/\\[REDACTED sha256=[a-f0-9]{64} chars=21\\]/);
  expect(insertedValues.dataManifest["{{CAPITULO_FUENTE}}"].chars).toBe(21);
});
```

Also reject a sensitive marker not present in `requiredMarkers`.

- [ ] **Step 2: Run and verify failures**

Run: `rtk pnpm test -- lib/__tests__/safe-template-prompt-migration.test.ts lib/prompts/__tests__/executor.test.ts`

Expected: FAIL for missing migration/kind and full source persistence.

- [ ] **Step 3: Extend prompt kinds and marker contracts**

Add `"source-risk-profiler"` to `promptKindValues` and `CORE_PROMPT_KINDS`.

```ts
"source-risk-profiler": [
  "{{CAPITULO_FUENTE}}",
  "{{OUTPUT_SCHEMA}}",
],
```

Label it `Perfil de riesgo de fuente`. Keep `template-generator` archived and parseable.

- [ ] **Step 4: Seed exact v2 prompt contracts**

Create two immutable revisions.

Source profiler system template:

```text
Classify distinctive source elements for private leak detection.
Return only JSON matching OUTPUT_SCHEMA.
Do not summarize the chapter. Do not provide recommendations.
Each label and alias must be at most 120 characters.
confidence and distinctiveness must be numbers from 0 through 1.
Use kinds allowed by the schema. Prefer omission over generic labels.
Never copy a long source passage.
```

Source profiler user template:

```text
SOURCE_CHAPTER:
{{CAPITULO_FUENTE}}

OUTPUT_SCHEMA:
{{OUTPUT_SCHEMA}}
```

Configuration:

```json
{
  "pipelineContract": "source-profile-v1",
  "sensitiveMarkers": ["{{CAPITULO_FUENTE}}"]
}
```

Rhetoric Trace v2 system template:

```text
Classify discourse architecture without retaining source substance.
Return only JSON matching OUTPUT_SCHEMA.
Use only listed enum values and integer positions.
Do not emit names, quotations, summaries, descriptions, notes, claims,
examples, metaphors, figures, entities, coined terms, or custom fields.
Preserve broad move categories, order, abstract dependencies, resource class,
discourse relation, and reader effect only.
```

Rhetoric Trace v2 user template:

```text
SOURCE_CHAPTER:
{{CAPITULO_FUENTE}}

OUTPUT_SCHEMA:
{{OUTPUT_SCHEMA}}
```

Configuration:

```json
{
  "pipelineContract": "trace-ir-v2",
  "sensitiveMarkers": ["{{CAPITULO_FUENTE}}"]
}
```

Set Rhetoric Trace v2 as the `rhetoric-trace` default. Do not set a new `template-generator` default.

- [ ] **Step 5: Add persisted-message redaction**

Extend executor input:

```ts
messagePersistence?: {
  mode: "full" | "redact-sensitive-markers";
  sensitiveMarkers?: string[];
};
```

Build provider messages from the real composition. Build stored messages from a second composition where each selected marker value becomes:

```ts
function redactedMarker(value: string): string {
  return `[REDACTED sha256=${sha256Text(value)} chars=${value.length}]`;
}
```

Validate sensitive markers against `revision.requiredMarkers`. Keep `dataManifest` from the real values.

- [ ] **Step 6: Run and commit**

Run: `rtk pnpm test -- lib/__tests__/safe-template-prompt-migration.test.ts lib/prompts/__tests__/executor.test.ts components/prompts/__tests__/prompt-registry-ui.test.tsx`

Expected: PASS.

```bash
rtk git add supabase/migrations/20260722000001_seed_safe_template_pipeline.sql lib/db/schema/prompt-registry.ts lib/prompts components/prompts/__tests__ lib/__tests__/safe-template-prompt-migration.test.ts
rtk git commit -m "feat: redact source prompt executions"
```

### Task 2: Build private source profiles

**Files:**

- Create: `lib/template-pipeline/source-profile.ts`
- Create: `lib/template-pipeline/__tests__/source-profile.test.ts`
- Modify: `lib/ai/embeddings.ts:3`

- [ ] **Step 1: Write failing deterministic-profile tests**

```ts
it("stores hashes, hashed shingles, embeddings, and no source text", async () => {
  const profile = await buildSourceProfile({
    pipelineRunId: "run-1",
    chapterId: "chapter-1",
    title: "Chapter",
    contentMd: "Distinct source material repeated across a deterministic fixture.",
    profilerRevisionId: "profile-rev-1",
    model: "test-model",
  });

  expect(profile.sourceHash).toMatch(/^[a-f0-9]{64}$/);
  expect(profile.chunks[0].contentHash).toMatch(/^[a-f0-9]{64}$/);
  expect(profile.chunks[0].lexicalFingerprint.shingles5[0])
    .toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(profile)).not.toContain("Distinct source material");
});

it("rejects invalid private labels", async () => {
  mockProfiler.mockResolvedValue({
    elements: [{
      id: "risk-1",
      kind: "metaphor",
      canonicalLabel: "x".repeat(121),
      aliases: [],
      sourceChunkIndexes: [0],
      confidence: 0.9,
      distinctiveness: 0.95,
    }],
  });
  await expect(buildSourceProfile(fixtureInput()))
    .rejects.toThrow("canonicalLabel");
});
```

Cover stable chapter hashing, stable chunk order, 5/8-gram hashing, bounds 0–1, valid chunk indexes, duplicate IDs, embedding count mismatch, profiler failure, and embedding failure.

- [ ] **Step 2: Run and verify missing profiler failure**

Run: `rtk pnpm test -- lib/template-pipeline/__tests__/source-profile.test.ts`

Expected: FAIL because module is absent.

- [ ] **Step 3: Implement strict profile schemas**

```ts
const distinctiveElementSchema = z.object({
  id: z.string().regex(/^risk_[a-z0-9_]+$/),
  kind: z.enum([
    "entity", "number", "formula", "coined_term", "named_framework",
    "metaphor", "anecdote", "example", "creative_sequence",
  ]),
  canonicalLabel: z.string().trim().min(1).max(120),
  aliases: z.array(z.string().trim().min(1).max(120)).max(12),
  sourceChunkIndexes: z.array(z.number().int().nonnegative()).min(1),
  confidence: z.number().min(0).max(1),
  distinctiveness: z.number().min(0).max(1),
}).strict();

export const sourceRiskProfileSchema = z.object({
  elements: z.array(distinctiveElementSchema).max(200),
}).strict();
```

- [ ] **Step 4: Implement deterministic chunk/fingerprint pipeline**

Use `splitText(source, 700, 100)`. Normalize with the existing originality normalization. Hash every 5-gram and 8-gram rather than storing raw shingles:

```ts
function hashShingles(text: string, size: 5 | 8): string[] {
  return [...computeWordShingles(text, size)]
    .map(sha256Text)
    .sort();
}
```

Export `EMBEDDING_MODEL` beside `EMBEDDING_DIMENSIONS`. Call
`generateEmbeddings(chunks.map(chunk => chunk.content))`; validate one
1536-number vector per chunk and include the exported model ID in `profileHash`.

- [ ] **Step 5: Invoke profiler with source redaction and persist atomically**

Call:

```ts
executeVersionedPrompt({
  stage: "source-profile",
  kind: "source-risk-profiler",
  revisionId: profilerRevisionId,
  bookTemplateId,
  chapterId,
  markerValues: {
    "{{CAPITULO_FUENTE}}": serializePromptText(source),
    "{{OUTPUT_SCHEMA}}": sourceRiskProfileJsonSchema,
  },
  messagePersistence: {
    mode: "redact-sensitive-markers",
    sensitiveMarkers: ["{{CAPITULO_FUENTE}}"],
  },
  model,
  schema: sourceRiskProfileSchema,
});
```

Validate every `sourceChunkIndexes` entry before inserting profile and chunks in one transaction. Compute `profileHash` from source hash, language, version, elements, chunk hashes, fingerprints, and embedding model ID; do not hash raw embeddings into logs.

- [ ] **Step 6: Run and commit**

Run: `rtk pnpm test -- lib/template-pipeline/__tests__/source-profile.test.ts lib/ai/__tests__/embeddings.test.ts`

Expected: PASS.

```bash
rtk git add lib/template-pipeline/source-profile.ts lib/template-pipeline/__tests__/source-profile.test.ts lib/ai/embeddings.ts
rtk git commit -m "feat: build private source profiles"
```

### Task 3: Define and validate the closed Trace IR

**Files:**

- Create: `lib/template-pipeline/trace-ir.ts`
- Create: `lib/template-pipeline/__tests__/trace-ir.test.ts`

- [ ] **Step 1: Write failing schema/semantic tests**

```ts
it("rejects every free-text field from v1", () => {
  const result = traceIrSchema.safeParse({
    moves: [{
      position: 0,
      recipeId: "opening_case",
      resourceClass: "case",
      discourseRelation: "open",
      readerEffect: "curiosity",
      dependencies: [],
      description: "ice melts after gradual heat",
    }],
  });
  expect(result.success).toBe(false);
});

it("rejects forward dependencies", () => {
  expect(() => validateTraceIr({
    moves: [
      move({ position: 0, dependencies: [{
        fromPosition: 1,
        relation: "supports",
        slotType: "claim",
      }] }),
      move({ position: 1 }),
    ],
  }, testRegistry)).toThrow("earlier position");
});
```

Cover skipped/duplicate positions, unknown keys at every object level, unknown recipe, invalid resource, missing produced dependency slot, unsupported relation, and one valid multi-move trace.

- [ ] **Step 2: Run and verify missing module failure**

Run: `rtk pnpm test -- lib/template-pipeline/__tests__/trace-ir.test.ts`

Expected: FAIL because `trace-ir.ts` is absent.

- [ ] **Step 3: Implement exact enums and strict schemas**

Use the enum arrays from design section 10 without adding custom/catch-all values. Core schema:

```ts
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
```

- [ ] **Step 4: Implement registry-aware semantic validation**

```ts
export function validateTraceIr(
  trace: TraceIr,
  registry: ReadonlyMap<RecipeId, TemplateRecipe>,
): TraceIr {
  trace.moves.forEach((move, index) => {
    if (move.position !== index)
      throw new TraceValidationError(index, "positions must be consecutive");
    const recipe = registry.get(move.recipeId);
    if (!recipe) throw new TraceValidationError(index, "unknown recipe");
    if (!recipe.allowedResources.includes(move.resourceClass))
      throw new TraceValidationError(index, "resource not allowed");
    for (const dependency of move.dependencies) {
      if (dependency.fromPosition >= move.position)
        throw new TraceValidationError(index, "dependency must target earlier position");
      const source = trace.moves[dependency.fromPosition];
      const sourceRecipe = registry.get(source.recipeId)!;
      if (!sourceRecipe.produces.includes(dependency.slotType))
        throw new TraceValidationError(index, "dependency slot not produced");
    }
    assertRequiredDependencies(move, recipe);
  });
  return trace;
}

function dependencyKey(input: {
  relation: DependencyRelation;
  slotType: SlotType;
}): string {
  return `${input.relation}:${input.slotType}`;
}

function assertRequiredDependencies(
  move: TraceMove,
  recipe: TemplateRecipe,
): void {
  const required = new Set(recipe.requiredDependencies.map(dependencyKey));
  const actual = new Set(move.dependencies.map(dependencyKey));
  for (const key of actual) {
    if (!required.has(key))
      throw new TraceValidationError(move.position, `unsupported dependency ${key}`);
  }
  for (const key of required) {
    if (!actual.has(key))
      throw new TraceValidationError(move.position, `missing dependency ${key}`);
  }
}
```

- [ ] **Step 5: Run and commit**

Run: `rtk pnpm test -- lib/template-pipeline/__tests__/trace-ir.test.ts`

Expected: PASS.

```bash
rtk git add lib/template-pipeline/trace-ir.ts lib/template-pipeline/__tests__/trace-ir.test.ts
rtk git commit -m "feat: validate closed rhetoric trace"
```

### Task 4: Implement explicit recipe registry and deterministic compiler

**Files:**

- Create: `lib/template-pipeline/recipes.ts`
- Create: `lib/template-pipeline/compiler.ts`
- Create: `lib/template-pipeline/__tests__/compiler.test.ts`
- Create: `lib/template-pipeline/__tests__/compiler-properties.test.ts`

- [ ] **Step 1: Write failing compiler invariants**

```ts
it("produces byte-identical output and hash", () => {
  const first = compileTrace(validTrace);
  const second = compileTrace(validTrace);
  expect(second).toEqual(first);
  expect(second.artifactHash).toBe(first.artifactHash);
});

it("owns names and reuses dependency symbols", () => {
  const result = compileTrace(traceWithConceptDependency);
  expect(result.blocks[0].placeholders[0].name).toBe("concepto_1");
  expect(result.blocks[1].content).toContain("{concepto_1}");
  expect(result.blocks[1].placeholders.map(p => p.name))
    .toContain("concepto_1");
  const response = compileTrace(traceWithResponseDependency);
  expect(response.blocks.at(-1)!.placeholders.find(p => p.name === "respuesta_1"))
    .toMatchObject({ dependsOn: ["objecion_1"] });
});

it.each(allRecipeIds)("compiles registered recipe %s", (recipeId) => {
  const output = compileTrace(singleMoveTrace(recipeId));
  assertCompilerInvariants(output.blocks);
});
```

Property tests iterate registry entries, never the Cartesian product of enums. Also assert no source fixture phrase, runtime `{{MARKER}}`, undeclared placeholder, duplicate placeholder, unknown recipe fallback, or unstable key ordering.

- [ ] **Step 2: Run and verify missing compiler failure**

Run: `rtk pnpm test -- lib/template-pipeline/__tests__/compiler.test.ts lib/template-pipeline/__tests__/compiler-properties.test.ts`

Expected: FAIL because compiler/registry modules are absent.

- [ ] **Step 3: Define recipe interface and explicit catalog**

```ts
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
  render(input: CompilerRecipeInput): CompiledBlock;
}
```

Create one explicit registry entry for each `recipeId`. Trusted render intent:

| Recipe | Required/local slots | Trusted instruction |
|---|---|---|
| `opening_case` | local `example`, `concept` | Open with a concrete case; connect it to the concept. |
| `rhetorical_bridge` | dependency `concept` | Bridge from the referenced concept to the next claim. |
| `claim_presentation` | local `claim` | State one clear claim and explain its relevance. |
| `claim_contrast` | dependency `claim`, local `objection` | Contrast the claim with a credible alternative. |
| `quantitative_illustration` | dependency `claim`, local `evidence` | Create a new topic-specific quantitative illustration. |
| `analogy_explanation` | dependency `concept`, local `example` | Create a new topic-specific analogy and map it explicitly. |
| `parallel_comparison` | local `example`, `objection` | Compare two topic-specific cases using the same criteria. |
| `definition` | local `concept` | Define the concept operationally and delimit it. |
| `evidence_support` | dependency `claim`, local `evidence` | Support the claim with evidence available to the project. |
| `objection` | dependency `claim`, local `objection` | Present the strongest relevant objection. |
| `response` | dependency `objection`, local `response` | Answer the referenced objection without dismissing it. |
| `application` | dependency `concept`, local `application` | Turn the concept into a concrete application. |
| `transition` | dependency `concept` | Connect the referenced concept to the next section. |
| `synthesis_close` | dependency `claim` | Synthesize prior claims and close without a new argument. |

Each `render` must return literal code-owned
title/content/userPrompt/function/notes, canonical slot descriptions, and
compiler-derived `dependsOn` names. No generic fallback and no runtime-generated
prose.

- [ ] **Step 4: Implement canonical symbol table**

```ts
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

class SymbolTable {
  private counters = new Map<SlotType, number>();
  private produced = new Map<string, string>();

  produce(position: number, slot: SlotType): string {
    const count = (this.counters.get(slot) ?? 0) + 1;
    this.counters.set(slot, count);
    const name = `${slotPrefixes[slot]}_${count}`;
    this.produced.set(`${position}:${slot}`, name);
    return name;
  }

  dependency(position: number, slot: SlotType): string {
    const name = this.produced.get(`${position}:${slot}`);
    if (!name) throw new UnsupportedRecipeError(`Missing symbol ${position}:${slot}`);
    return name;
  }
}
```

- [ ] **Step 5: Implement compiler and invariants**

Compile moves in position order. Compute `artifactHash = sha256Canonical({ compilerVersion, compilerHash, recipeCatalogHash, traceIr, blocks })`.

`assertCompilerInvariants` must verify:

```ts
const PLACEHOLDER = /(?<!\{)\{([a-z][a-z0-9_]*)\}(?!\})/g;

assertSameSet(extract(block.content), extract(block.userPrompt));
assertSameSet(extract(block.content), new Set(block.placeholders.map(p => p.name)));
assertUniqueWithinBlock(block.placeholders.map(p => p.name));
assertNoRuntimeMarkers(allStrings(block));
assertCanonicalNames(block.placeholders);
```

After block checks, build one chapter-wide map. Repeated names must have identical
`function` and `dependsOn`; `assertAcyclicDeclaredDependencies` walks that map and
rejects missing, self, forward, or cyclic edges. The runtime implementation
throws typed errors; test helpers may use Vitest assertions.

Implement the named runtime helpers in `compiler.ts`:

```ts
function assertSameSet(left: Set<string>, right: Set<string>): void {
  if (left.size !== right.size || [...left].some(value => !right.has(value)))
    throw new CompilerInvariantError("placeholder sets differ");
}

function assertUniqueWithinBlock(names: string[]): void {
  if (new Set(names).size !== names.length)
    throw new CompilerInvariantError("duplicate placeholder in block");
}

function assertNoRuntimeMarkers(values: string[]): void {
  if (values.some(value => /\{\{[A-Z][A-Z0-9_]*\}\}/.test(value)))
    throw new CompilerInvariantError("unresolved runtime marker");
}

function assertCanonicalNames(
  placeholders: CompiledBlock["placeholders"],
): void {
  if (placeholders.some(item => !/^[a-z][a-z0-9_]*$/.test(item.name)))
    throw new CompilerInvariantError("non-canonical placeholder name");
}

function allStrings(block: CompiledBlock): string[] {
  return [
    block.title,
    block.content,
    block.userPrompt,
    block.function ?? "",
    block.sourceContext ?? "",
    block.notes ?? "",
    ...block.placeholders.flatMap(item => [
      item.name,
      item.function,
      ...item.dependsOn,
    ]),
  ];
}

function extract(value: string): Set<string> {
  return new Set([...value.matchAll(PLACEHOLDER)].map(match => match[1]));
}

function assertAcyclicDeclaredDependencies(blocks: CompiledBlock[]): void {
  const declarations = new Map<
    string,
    { function: string; dependsOn: string[]; firstBlock: number }
  >();
  blocks.forEach((block, blockIndex) => {
    block.placeholders.forEach(item => {
      const prior = declarations.get(item.name);
      if (
        prior
        && (prior.function !== item.function
          || canonicalJson(prior.dependsOn) !== canonicalJson(item.dependsOn))
      ) {
        throw new CompilerInvariantError(
          `conflicting placeholder declaration ${item.name}`,
        );
      }
      if (!prior) declarations.set(item.name, { ...item, firstBlock: blockIndex });
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
```

- [ ] **Step 6: Run and commit**

Run: `rtk pnpm test -- lib/template-pipeline/__tests__/trace-ir.test.ts lib/template-pipeline/__tests__/compiler.test.ts lib/template-pipeline/__tests__/compiler-properties.test.ts`

Expected: PASS.

```bash
rtk git add lib/template-pipeline/recipes.ts lib/template-pipeline/compiler.ts lib/template-pipeline/__tests__
rtk git commit -m "feat: compile templates deterministically"
```

### Task 5: Persist resumable artifacts and finalize atomically

**Files:**

- Create: `lib/template-pipeline/artifacts.ts`
- Create: `lib/template-pipeline/__tests__/artifacts.test.ts`
- Modify: `lib/prompts/chapter-revisions.ts`

- [ ] **Step 1: Write failing retry/finalization tests**

```ts
it("reuses an artifact only when its idempotency tuple matches", async () => {
  expect(await findReusableArtifact(exactTuple)).toEqual(existingArtifact);
  expect(await findReusableArtifact({ ...exactTuple, compilerHash: "changed" }))
    .toBeNull();
});

it("rolls back all active prompts when one insert fails", async () => {
  tx.insert.mockRejectedValueOnce(new Error("insert failed"));
  await expect(finalizeTemplateRun(runId)).rejects.toThrow("insert failed");
  expect(committedPromptCount()).toBe(0);
  expect(template.activePipelineRunId).toBeNull();
});
```

Cover row locking, already-clean idempotency, wrong run status, missing/duplicate chapter artifacts, artifact hash mismatch, copied lineage, prompt revision lineage, and placeholder deduplication.

- [ ] **Step 2: Run and verify missing finalizer failure**

Run: `rtk pnpm test -- lib/template-pipeline/__tests__/artifacts.test.ts`

Expected: FAIL because artifact service is absent.

- [ ] **Step 3: Implement artifact upsert**

Artifact identity uses:

```ts
interface ArtifactIdentity {
  pipelineRunId: string;
  chapterId: string;
  sourceHash: string;
  rhetoricRevisionId: string;
  compilerHash: string;
}
```

Store identity hashes in `validation_report.identity`. On conflict, return existing only when all identity values and `artifactHash` match; otherwise throw `ArtifactConflictError`.

- [ ] **Step 4: Implement one short finalization transaction**

Order:

```ts
await db.transaction(async (tx) => {
  const locked = await lockTemplateAndRun(tx, runId);
  if (locked.run.status === "clean") return locked;
  assertRunning(locked.run);
  const artifacts = await loadAndValidateAllArtifacts(tx, locked);
  await insertCompiledPromptsAndRevisions(tx, locked, artifacts);
  await insertCompiledPlaceholders(tx, locked, artifacts);
  await markRunClean(tx, runId);
  await activateTemplateRun(tx, locked.template.id, runId);
});
```

Every inserted prompt/placeholder receives `templatePipelineRunId` and its
chapter artifact hash. Every placeholder also receives compiler-produced
`dependencyNames`. Consolidate repeated block declarations by name and require
byte-identical function/dependencies before inserting one row. No
delete-before-insert operation is allowed.

- [ ] **Step 5: Run and commit**

Run: `rtk pnpm test -- lib/template-pipeline/__tests__/artifacts.test.ts`

Expected: PASS.

```bash
rtk git add lib/template-pipeline/artifacts.ts lib/template-pipeline/__tests__/artifacts.test.ts lib/prompts/chapter-revisions.ts
rtk git commit -m "feat: finalize template runs atomically"
```

### Task 6: Replace the two-pass template task

**Files:**

- Rewrite: `trigger/generate-template.ts:1`
- Rewrite: `trigger/__tests__/generate-template.test.ts:1`

- [ ] **Step 1: Replace tests with v2 orchestration contract**

Required assertions:

```ts
expect(mockExecuteVersionedPrompt).toHaveBeenCalledWith(
  expect.objectContaining({
    kind: "rhetoric-trace",
    messagePersistence: {
      mode: "redact-sensitive-markers",
      sensitiveMarkers: ["{{CAPITULO_FUENTE}}"],
    },
  }),
);
expect(mockExecuteVersionedPrompt).not.toHaveBeenCalledWith(
  expect.objectContaining({ kind: "template-generator" }),
);
expect(mockCompileTrace).toHaveBeenCalledWith(traceIr);
expect(mockFinalizeTemplateRun).toHaveBeenCalledTimes(1);
```

Also test one classifier retry on malformed/semantically invalid IR, no retry on compiler invariant failure, resumable clean artifacts, source-profile failure, one failed chapter preventing finalization, technical `failed` vs leakage `quarantined`, and three-chapter concurrency.

- [ ] **Step 2: Run and verify old two-pass behavior fails**

Run: `rtk pnpm test -- trigger/__tests__/generate-template.test.ts`

Expected: FAIL because current task calls `template-generator` and writes chapter rows directly.

- [ ] **Step 3: Implement v2 chapter function**

```ts
async function buildChapterArtifact(input: ChapterBuildInput) {
  const profile = await buildOrReuseSourceProfile(input);
  const trace = await classifyTraceWithOneValidationRetry(input);
  const validated = validateTraceIr(trace, TEMPLATE_RECIPE_REGISTRY);
  const compiled = compileTrace(validated);
  await assertCompiledTemplateClean(compiled, profile);
  return saveRunArtifact({
    ...input,
    traceIr: validated,
    compiledTemplate: compiled.blocks,
    artifactHash: compiled.artifactHash,
  });
}
```

Stage B `assertCompiledTemplateClean` runs deterministic baseline checks and compiler invariants. Stage C later adds full template-scoped detector signals.

Implement it by flattening every compiled field with Stage A
`collectTemplateFields`, running the fail-closed baseline blocklist, hashing each
field's normalized 5/8-grams, and comparing hashes against this chapter profile.
Containment above `0.15` throws `OriginalityError`; the report keeps field path,
score, threshold, and hashes only.

Classifier retry is exactly bounded:

```ts
async function classifyTraceWithOneValidationRetry(
  input: TraceClassifierInput,
): Promise<TraceIr> {
  let firstError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await executeTraceClassifier(input);
      return validateTraceIr(result.data, TEMPLATE_RECIPE_REGISTRY);
    } catch (error) {
      firstError ??= error;
      if (!isTraceOutputError(error) || attempt === 1) throw error;
    }
  }
  throw firstError;
}
```

- [ ] **Step 4: Implement task state transitions**

Task payload removes `templateGeneratorRevisionId` and adds:

```ts
{
  pipelineRunId: string;
  templateId: string;
  rhetoricTraceRevisionId: string;
  sourceProfilerRevisionId: string;
  chapters: ChapterPayload[];
  model?: string;
  effort?: ReasoningEffort;
}
```

Validate the rhetoric revision declares `trace-ir-v2` and profiler revision declares `source-profile-v1`. Run chapter builds with concurrency 3. Finalize only when all fulfill. Classify errors:

- detector evidence → run/template `quarantined`;
- provider/network/schema after bounded retries → `failed`;
- trace validation second failure → `failed`;
- compiler/invariant/finalization error → `failed`.

- [ ] **Step 5: Run and commit**

Run: `rtk pnpm test -- trigger/__tests__/generate-template.test.ts lib/template-pipeline/__tests__`

Expected: PASS and zero Template Generator calls.

```bash
rtk git add trigger/generate-template.ts trigger/__tests__/generate-template.test.ts
rtk git commit -m "feat: replace creative template pass"
```

### Task 7: Cut over template API and creation UI

**Files:**

- Modify: `app/api/books/auto/route.ts:19`
- Modify: `app/templates/create/page.tsx:23`
- Modify: `app/api/books/[id]/route.ts:1`
- Modify: `app/templates/[id]/page.tsx:80`
- Create: `components/templates/pipeline-status.tsx`
- Create: `lib/__tests__/safe-template-api.test.ts`
- Create: `app/templates/create/__tests__/page.test.tsx`
- Create: `components/templates/__tests__/pipeline-status.test.tsx`

- [ ] **Step 1: Write failing API/UI tests**

```ts
it("rejects a trace revision without trace-ir-v2 configuration", async () => {
  const response = await postAutoTemplate({
    rhetoricTraceRevisionId: legacyTraceRevision.id,
    chapters: [chapterFixture],
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: "rhetoricTraceRevisionId must implement trace-ir-v2",
  });
});

it("does not render a Template Generator selector", async () => {
  render(<CreateTemplatePage />);
  expect(screen.queryByLabelText("Template Generator Revision")).toBeNull();
  expect(screen.getByText(/Compiler template-compiler-v1/)).toBeVisible();
  expect(screen.getByText(/Policy originality-policy-v2/)).toBeVisible();
});

it("distinguishes quarantine from technical failure", () => {
  render(<PipelineStatus run={{
    status: "quarantined",
    completedArtifacts: 1,
    totalChapters: 3,
    failureStage: "template_validation",
  }} />);
  expect(screen.getByText("Quarantined")).toBeVisible();
  expect(screen.queryByText("Failed")).toBeNull();
  expect(screen.getByText("1 / 3 chapters")).toBeVisible();
});
```

- [ ] **Step 2: Run and verify legacy contract failure**

Run: `rtk pnpm test -- lib/__tests__/safe-template-api.test.ts app/templates/create/__tests__/page.test.tsx`

Expected: FAIL because API/UI still require `templateGeneratorRevisionId`.

- [ ] **Step 3: Validate revision contracts server-side**

Remove `templateGeneratorRevisionId` from request parsing, audit metadata, and task payload. Resolve the rhetoric revision and profiler default before inserting template/run:

```ts
assertRevisionConfiguration(
  rhetoricRevision,
  "pipelineContract",
  "trace-ir-v2",
);
assertRevisionConfiguration(
  profilerRevision,
  "pipelineContract",
  "source-profile-v1",
);
```

Reject client-supplied `templateGeneratorRevisionId` with status 400 so stale clients do not believe it was honored.

- [ ] **Step 4: Remove selector and display immutable runtime metadata**

Keep only compatible Rhetoric Trace revisions. Show:

```text
Compiler template-compiler-v1
Policy originality-policy-v2
Source profile source-profile-v1
```

Update explanatory copy: source is classified into a closed structural trace and compiled by trusted code.

- [ ] **Step 5: Expose safe progress and render distinct states**

`GET /api/books/[id]` adds:

```ts
pipelineRun: {
  id: string;
  status: "running" | "clean" | "quarantined" | "failed";
  completedArtifacts: number;
  totalChapters: number;
  failureStage: string | null;
  compilerVersion: string | null;
  compilerHash: string | null;
  originalityPolicyVersion: string;
} | null;
```

Never return `report`, profiles, labels, fingerprints, or embeddings. Detail page
polls every two seconds only while `running`, stops on terminal state, and renders
separate `Quarantined` and `Failed` badges.

- [ ] **Step 6: Run and commit**

Run: `rtk pnpm test -- lib/__tests__/safe-template-api.test.ts app/templates/create/__tests__/page.test.tsx components/templates/__tests__/pipeline-status.test.tsx`

Expected: PASS.

```bash
rtk git add app/api/books/auto/route.ts app/api/books/'[id]'/route.ts app/templates/create/page.tsx app/templates/create/__tests__/page.test.tsx app/templates/'[id]'/page.tsx components/templates/pipeline-status.tsx components/templates/__tests__/pipeline-status.test.tsx lib/__tests__/safe-template-api.test.ts
rtk git commit -m "feat: cut over safe template creation"
```

### Task 8: Verify Stage B end-to-end

**Files:**

- No planned file changes.

- [ ] **Step 1: Run focused safe-template suite**

Run:

```bash
rtk pnpm test -- \
  lib/__tests__/safe-template-prompt-migration.test.ts \
  lib/prompts/__tests__/executor.test.ts \
  lib/template-pipeline/__tests__ \
  trigger/__tests__/generate-template.test.ts \
  lib/__tests__/safe-template-api.test.ts \
  app/templates/create/__tests__/page.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run full verification**

Run: `rtk pnpm typecheck`

Expected: PASS.

Run: `rtk pnpm lint`

Expected: PASS.

Run: `rtk pnpm test`

Expected: PASS.

- [ ] **Step 3: Verify deterministic/retry behavior locally**

Create one synthetic two-chapter source fixture through the API twice using the same run/task idempotency inputs. Verify:

- no persisted execution message contains source prose;
- source profile tables contain hashes/fingerprints/embeddings but no raw chunks;
- no `template-generator` execution exists;
- repeated compile yields identical artifact hashes;
- prompts/placeholders appear only after both artifacts pass;
- active run is clean and project-eligible;
- a forced second-chapter failure leaves zero active prompts/placeholders.

## Stage B exit criteria

- Source text reaches profiler and trace classifier only.
- New execution persistence stores source hash/length redactions, never source prose.
- Trace output cannot carry free text or unknown keys.
- Template Generator LLM receives zero calls.
- Same Trace IR/compiler/catalog produces byte-identical output/hash.
- One failed chapter prevents all prompt/placeholder activation.
- Clean v2 templates become eligible; legacy templates remain blocked.
- Full tests, typecheck, lint, and migration pass.
