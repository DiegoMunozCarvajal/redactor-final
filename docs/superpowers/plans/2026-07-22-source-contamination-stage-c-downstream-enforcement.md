# Source Contamination Stage C: Downstream Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Check every generated manuscript candidate against its template-specific private source profile before persistence, block definition cascades, and make all generated content stale when safety lineage changes.

**Architecture:** A versioned policy combines deterministic hashed-shingle/distinctive-element signals with multilingual embeddings and an escalation-only reviewer. One orchestration service owns clean/suspect/contaminated decisions, one bounded suspect retry, hash-only assessment persistence, and atomic accepted-content persistence. Every output stores a discriminated lineage snapshot; template-free projects use an explicit empty profile set and baseline policy.

**Tech Stack:** Next.js 15, TypeScript, Drizzle/PostgreSQL/pgvector, Zod, OpenAI embeddings, versioned prompt registry, Trigger.dev 4, Vitest.

---

## Dependencies and delivery boundary

- Run after Stage B: `docs/superpowers/plans/2026-07-22-source-contamination-stage-b-trace-compiler.md`
- Approved design: `docs/superpowers/specs/2026-07-22-generic-source-contamination-prevention-design.md`
- Stage C does not mutate or regenerate legacy templates/projects. Stage D handles remediation.
- Existing static James Clear rules remain a baseline signal, not sole or template-specific evidence.

## File map

- Create `supabase/migrations/20260722000002_add_originality_assessments.sql`: decisions, safe reports, quarantine status, and reviewer prompt revision.
- Create `lib/db/schema/originality-assessments.ts`; modify schema index and generation status.
- Create `lib/originality/contracts.ts`: policy, signals, assessment, context, lineage types.
- Create `lib/originality/profile-loader.ts`: authorized private profile loading and label-embedding cache.
- Create `lib/originality/deterministic-detectors.ts`: baseline, hashed n-grams, protected elements.
- Create `lib/originality/semantic-detectors.ts`: chunk/label similarity.
- Create `lib/originality/reviewer.ts`: escalation-only structured reviewer.
- Create `lib/originality/evaluate.ts`: pure decision engine.
- Create `lib/originality/gate.ts`: retries, assessment records, quarantine, atomic accepted persistence.
- Create `lib/originality/lineage.ts`: lineage creation/equality/staleness.
- Modify placeholder, fragment, assembly, title, critique, and correction paths to use the gate.
- Modify placeholder context selection to use only persisted compiler dependencies.
- Modify UI staleness/blocked-state rendering.
- Add calibration, false-positive control, cross-language, route, worker, and integration tests.

### Task 1: Add assessment persistence and quarantine state

**Files:**

- Create: `lib/__tests__/originality-assessment-migration.test.ts`
- Create: `supabase/migrations/20260722000002_add_originality_assessments.sql`
- Create: `lib/db/schema/originality-assessments.ts`
- Modify: `lib/db/schema/chapter-generations.ts:6`
- Modify: `lib/db/schema/index.ts:1`
- Modify: `lib/db/schema/prompt-registry.ts:5`
- Modify: `lib/prompts/contracts.ts:6`
- Modify: `lib/prompts/kinds.ts:3`
- Modify: `lib/generation-status.ts:1`
- Modify: `lib/api/rate-limit.ts:20`
- Modify: `lib/__tests__/generation-status.test.ts`
- Modify: `lib/__tests__/rate-limit.test.ts`

- [ ] **Step 1: Write failing migration tests**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../../supabase/migrations/20260722000002_add_originality_assessments.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("originality assessment migration", () => {
  it("stores decisions without candidate prose", () => {
    expect(sql).toContain("CREATE TABLE originality_assessments");
    expect(sql).toContain("candidate_hash text NOT NULL");
    expect(sql).toContain("signals jsonb NOT NULL");
    expect(sql).not.toContain("candidate_text");
    expect(sql).not.toContain("source_text");
  });

  it("enforces source-free versus template lineage", () => {
    expect(sql).toContain("scope IN ('template', 'source-free')");
    expect(sql).toContain("pipeline_run_id IS NOT NULL");
    expect(sql).toContain("pipeline_run_id IS NULL");
  });

  it("adds quarantined generation status and reviewer kind", () => {
    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'quarantined'");
    expect(sql).toContain("'source-leakage-review'");
    expect(sql).toContain("definition_origin text NOT NULL DEFAULT 'legacy'");
  });
});
```

- [ ] **Step 2: Run and verify missing migration failure**

Run: `rtk pnpm test -- lib/__tests__/originality-assessment-migration.test.ts`

Expected: FAIL with `ENOENT`.

- [ ] **Step 3: Create assessment table and indexes**

```sql
ALTER TYPE generation_status ADD VALUE IF NOT EXISTS 'quarantined';

CREATE TABLE originality_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL,
  pipeline_run_id uuid REFERENCES template_pipeline_runs(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_id uuid REFERENCES chapters(id) ON DELETE CASCADE,
  chapter_generation_id uuid REFERENCES chapter_generations(id) ON DELETE CASCADE,
  execution_id uuid REFERENCES llm_prompt_executions(id) ON DELETE RESTRICT,
  stage text NOT NULL,
  candidate_hash text NOT NULL,
  source_profile_set_hash text NOT NULL,
  originality_policy_version text NOT NULL,
  decision text NOT NULL,
  signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  accepted_entity_type text,
  accepted_entity_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_originality_scope
    CHECK (scope IN ('template', 'source-free')),
  CONSTRAINT chk_originality_decision
    CHECK (decision IN ('clean', 'suspect', 'contaminated')),
  CONSTRAINT chk_originality_scope_run CHECK (
    (scope = 'template' AND pipeline_run_id IS NOT NULL)
    OR (scope = 'source-free' AND pipeline_run_id IS NULL)
  ),
  CONSTRAINT chk_originality_accepted_pair CHECK (
    (accepted_entity_type IS NULL) = (accepted_entity_id IS NULL)
  )
);

CREATE INDEX idx_originality_assessments_project
  ON originality_assessments(project_id, created_at DESC);
CREATE INDEX idx_originality_assessments_generation
  ON originality_assessments(chapter_generation_id, created_at);
CREATE INDEX idx_originality_assessments_candidate
  ON originality_assessments(candidate_hash, originality_policy_version);

ALTER TABLE originality_assessments ENABLE ROW LEVEL SECURITY;

ALTER TABLE chapter_placeholders
  ADD COLUMN definition_origin text NOT NULL DEFAULT 'legacy',
  ADD CONSTRAINT chk_placeholder_definition_origin
    CHECK (definition_origin IN ('legacy', 'manual', 'ai'));
```

Do not grant direct authenticated table reads. Service-role server code owns
assessment mutation/read; project-owner APIs return decision/status and
assessment ID only. Reports never expose profile labels to ordinary project APIs.

- [ ] **Step 4: Seed escalation-only reviewer**

Add `source-leakage-review` kind and marker contract:

```ts
"source-leakage-review": [
  "{{CANDIDATE_OUTPUT}}",
  "{{MATCHED_RISK_LABELS}}",
  "{{SIGNAL_REPORT}}",
  "{{OUTPUT_SCHEMA}}",
],
```

Seed system template:

```text
Review whether candidate output reconstructs the supplied private risk labels.
Return only JSON matching OUTPUT_SCHEMA.
You may mark possible reconstruction or no additional evidence.
Never quote, expand, explain, or imitate a risk label.
Never downgrade a deterministic signal.
```

Output:

```ts
z.object({
  possibleReconstruction: z.boolean(),
  matchedRiskElementIds: z.array(z.string()).max(20),
}).strict();
```

- [ ] **Step 5: Add matching Drizzle models**

Export `originalityAssessments`, add `"quarantined"` to generation status values,
add `definitionOrigin` to `chapterPlaceholders`, and add both new prompt-kind
maps/labels.

Update terminal-state helpers so `quarantined` is terminal, excluded from
rate-limit in-flight counts, never cleaned as a stale in-flight row, and returned
by generation APIs without conversion to `failed`.

- [ ] **Step 6: Run and commit**

Run: `rtk pnpm test -- lib/__tests__/originality-assessment-migration.test.ts lib/prompts/__tests__/contracts.test.ts lib/__tests__/generation-status.test.ts lib/__tests__/rate-limit.test.ts`

Expected: PASS.

```bash
rtk git add supabase/migrations/20260722000002_add_originality_assessments.sql lib/db/schema lib/prompts lib/__tests__/originality-assessment-migration.test.ts
rtk git commit -m "feat: persist originality assessments"
```

### Task 2: Define policy, signals, and lineage contracts

**Files:**

- Create: `lib/originality/contracts.ts`
- Create: `lib/originality/lineage.ts`
- Create: `lib/originality/__tests__/lineage.test.ts`
- Modify: `lib/placeholder-fill-metadata.ts:3`

- [ ] **Step 1: Write failing lineage equality tests**

```ts
it("compares the complete canonical prompt revision map", () => {
  const oldLineage = templateLineage({
    promptRevisions: {
      "chapter-content": "chapter-v1",
      "generation-system": "system-v1",
    },
  });
  const current = templateLineage({
    promptRevisions: {
      "chapter-content": "chapter-v1",
      "generation-system": "system-v2",
    },
  });
  expect(isOriginalityLineageCurrent(oldLineage, current)).toBe(false);
});

it("never treats missing legacy lineage as current", () => {
  expect(isOriginalityLineageCurrent(null, sourceFreeLineage())).toBe(false);
});
```

Cover scope, run, compiler, catalog, artifact, profile set/version, policy, function hash, and key-order-independent prompt revision maps.

- [ ] **Step 2: Run and verify missing lineage module**

Run: `rtk pnpm test -- lib/originality/__tests__/lineage.test.ts`

Expected: FAIL because modules are absent.

- [ ] **Step 3: Define exact policy and signal types**

```ts
export const ORIGINALITY_POLICY_V2 = {
  version: "originality-policy-v2",
  profileElementConfidenceThreshold: 0.80,
  strongDistinctivenessThreshold: 0.90,
  lexicalContainmentThreshold: 0.15,
  semanticSuspectThreshold: 0.88,
  semanticStrongThreshold: 0.92,
  reviewerEnabled: true,
} as const;

export type OriginalityDecision = "clean" | "suspect" | "contaminated";

export interface OriginalitySignal {
  detector:
    | "baseline_blocklist"
    | "hashed_ngram"
    | "coined_term"
    | "named_framework"
    | "entity_sequence"
    | "formula_number"
    | "distinctive_alias"
    | "source_chunk_embedding"
    | "risk_label_embedding"
    | "source_leakage_review";
  strength: "strong" | "probabilistic";
  riskElementIds: string[];
  score?: number;
  threshold?: number;
  fieldPath: string;
}
```

- [ ] **Step 4: Implement discriminated lineage**

```ts
interface BaseOriginalityLineage {
  scope: "template" | "source-free";
  sourceProfileSetHash: string;
  originalityPolicyVersion: string;
  promptRevisions: Record<string, string>;
}

export type OriginalityLineage =
  | (BaseOriginalityLineage & {
      scope: "template";
      pipelineRunId: string;
      pipelineVersion: string;
      compilerVersion: string;
      compilerHash: string;
      recipeCatalogHash: string;
      templateArtifactHash: string;
      sourceProfileVersion: string;
      placeholderFunctionHash?: string;
    })
  | (BaseOriginalityLineage & {
      scope: "source-free";
      pipelineRunId: null;
    });
```

Normalize `promptRevisions` by sorted keys before hashing/comparison. Extend
`PlaceholderFillMetadata` with `originalityLineage`,
`originalityAssessmentId`, `definitionOrigin`, and `manualConfirmedAt`.

- [ ] **Step 5: Run and commit**

Run: `rtk pnpm test -- lib/originality/__tests__/lineage.test.ts lib/__tests__/placeholder-fill-metadata.test.ts`

Expected: PASS.

```bash
rtk git add lib/originality lib/placeholder-fill-metadata.ts lib/__tests__/placeholder-fill-metadata.test.ts
rtk git commit -m "feat: define originality lineage"
```

### Task 3: Load private profiles without exposure

**Files:**

- Create: `lib/originality/profile-loader.ts`
- Create: `lib/originality/__tests__/profile-loader.test.ts`

- [ ] **Step 1: Write failing profile-access tests**

```ts
it("loads profiles only from the authorized active run", async () => {
  const loaded = await loadOriginalityProfileSet(templateAuthorization);
  expect(loaded.pipelineRunId).toBe(templateAuthorization.pipelineRunId);
  expect(loaded.profileSetHash).toBe(templateAuthorization.sourceProfileSetHash);
});

it("returns an immutable empty set for source-free scope", async () => {
  expect(await loadOriginalityProfileSet(sourceFreeAuthorization)).toEqual({
    scope: "source-free",
    pipelineRunId: null,
    profileSetHash: EMPTY_SOURCE_PROFILE_SET_HASH,
    profiles: [],
  });
});
```

Also fail on hash mismatch, missing chunks, missing embeddings, foreign run ID, and profile-set mutation after authorization.

- [ ] **Step 2: Run and verify missing loader failure**

Run: `rtk pnpm test -- lib/originality/__tests__/profile-loader.test.ts`

Expected: FAIL because loader is absent.

- [ ] **Step 3: Implement active-run-only loader**

Load profiles/chunks by `authorization.pipelineRunId`; recompute the sorted profile-set hash and compare using `timingSafeEqual`. Never accept a caller-provided profile object.

Return an internal server-only type:

```ts
export interface LoadedProfileSet {
  scope: "template" | "source-free";
  pipelineRunId: string | null;
  profileSetHash: string;
  profiles: Array<{
    id: string;
    profileHash: string;
    elements: DistinctiveElement[];
    chunks: Array<{
      contentHash: string;
      shingles5: Set<string>;
      shingles8: Set<string>;
      embedding: number[];
    }>;
  }>;
}
```

Do not export it from client-reachable barrels.

- [ ] **Step 4: Add risk-label embedding cache**

Key cache by `(profileHash, embeddingModel)`. Batch only canonical labels/aliases that meet the confidence threshold. Cache promises to deduplicate concurrent requests. On embedding failure, throw `OriginalityDetectorUnavailableError`; never continue without semantic protection for templated projects.

- [ ] **Step 5: Run and commit**

Run: `rtk pnpm test -- lib/originality/__tests__/profile-loader.test.ts`

Expected: PASS.

```bash
rtk git add lib/originality/profile-loader.ts lib/originality/__tests__/profile-loader.test.ts
rtk git commit -m "feat: load private originality profiles"
```

### Task 4: Implement deterministic detectors

**Files:**

- Create: `lib/originality/deterministic-detectors.ts`
- Create: `lib/originality/__tests__/deterministic-detectors.test.ts`

- [ ] **Step 1: Write failing signal tests**

```ts
it("detects exact source reuse through hashed shingles", () => {
  const signals = runDeterministicDetectors({
    candidate: sourceExcerpt,
    fieldPath: "fragment.content",
    profiles: fingerprintFixture(sourceExcerpt),
    policy: ORIGINALITY_POLICY_V2,
  });
  expect(signals).toContainEqual(expect.objectContaining({
    detector: "hashed_ngram",
    strength: "strong",
  }));
});

it("does not treat one common entity as a protected sequence", () => {
  const signals = runDeterministicDetectors({
    candidate: "Google provides a public service.",
    fieldPath: "fragment.content",
    profiles: twoEntityFixture(),
    policy: ORIGINALITY_POLICY_V2,
  });
  expect(signals.some(signal => signal.detector === "entity_sequence"))
    .toBe(false);
});
```

Cover high-confidence/distinctiveness bounds, coined terms, named frameworks, two-entity ordered sequences, formula+number pairs, metaphor/anecdote/example aliases, low-confidence controls, empty text, Spanish accents, and source-free baseline blocklist.

- [ ] **Step 2: Run and verify missing detector failure**

Run: `rtk pnpm test -- lib/originality/__tests__/deterministic-detectors.test.ts`

Expected: FAIL because detector module is absent.

- [ ] **Step 3: Implement hashed containment**

```ts
function containment(candidate: Set<string>, source: Set<string>): number {
  if (candidate.size === 0) return 0;
  let matches = 0;
  for (const hash of candidate) if (source.has(hash)) matches += 1;
  return matches / candidate.size;
}
```

Compute both 5/8-gram hashes. Emit one strong signal with maximum score/profile/chunk IDs when either exceeds policy threshold. Never reconstruct raw source shingles.

- [ ] **Step 4: Implement protected-element rules**

- exact normalized coined term/framework requires both configured thresholds;
- entity sequence requires at least two distinct matched element IDs in candidate order;
- formula/number requires matching elements from both kinds;
- metaphor/anecdote/example alias requires both thresholds;
- a label below either threshold can contribute only to probabilistic semantic signals;
- baseline blocklist hits emit stable detector IDs, not regex source text.

- [ ] **Step 5: Run and commit**

Run: `rtk pnpm test -- lib/originality/__tests__/deterministic-detectors.test.ts`

Expected: PASS.

```bash
rtk git add lib/originality/deterministic-detectors.ts lib/originality/__tests__/deterministic-detectors.test.ts
rtk git commit -m "feat: detect deterministic source reuse"
```

### Task 5: Add semantic signals and escalation-only review

**Files:**

- Create: `lib/originality/semantic-detectors.ts`
- Create: `lib/originality/reviewer.ts`
- Create: `lib/originality/evaluate.ts`
- Create: `lib/originality/__tests__/semantic-detectors.test.ts`
- Create: `lib/originality/__tests__/evaluate.test.ts`

- [ ] **Step 1: Write failing cross-language/control tests**

Fixtures must use short synthetic text, not copyrighted passages:

```ts
it("flags a translated paraphrase of a distinctive synthetic metaphor", async () => {
  const result = await evaluateOriginality({
    candidate: "La presión acumulada transforma lentamente el material.",
    fieldPath: "placeholder.definition",
    profileSet: syntheticPhaseChangeProfile,
    policy: ORIGINALITY_POLICY_V2,
  });
  expect(["suspect", "contaminated"]).toContain(result.decision);
});

it("keeps unrelated generic advice clean", async () => {
  const result = await evaluateOriginality({
    candidate: "Haz una pregunta breve y escucha la respuesta.",
    fieldPath: "placeholder.definition",
    profileSet: syntheticPhaseChangeProfile,
    policy: ORIGINALITY_POLICY_V2,
  });
  expect(result.decision).toBe("clean");
});
```

Mock embeddings with deterministic vectors. Test exact boundary values 0.8799, 0.88, 0.9199, and 0.92.

- [ ] **Step 2: Run and verify missing semantic engine**

Run: `rtk pnpm test -- lib/originality/__tests__/semantic-detectors.test.ts lib/originality/__tests__/evaluate.test.ts`

Expected: FAIL because modules are absent.

- [ ] **Step 3: Implement cosine signals**

```ts
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0)
    throw new OriginalityDetectorUnavailableError("embedding dimension mismatch");
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] ** 2;
    normB += b[i] ** 2;
  }
  if (normA === 0 || normB === 0)
    throw new OriginalityDetectorUnavailableError("zero embedding");
  return dot / Math.sqrt(normA * normB);
}
```

Embed candidate once. Emit maximum source-chunk and label similarities with risk IDs only.

- [ ] **Step 4: Implement pure decision matrix**

```ts
if (strongDeterministic.length > 0) return contaminated(signals);
if (sourceSemantic >= 0.92 && labelSemantic >= 0.88)
  return contaminated(signals);
if (sourceSemantic >= 0.88 || labelSemantic >= 0.88)
  return suspect(signals);
return clean(signals);
```

The reviewer can add `source_leakage_review` and escalate clean/suspect to suspect/contaminated when combined with two independent semantic signals. It cannot remove or weaken a signal.

- [ ] **Step 5: Implement reviewer input minimization**

Send candidate, matched labels limited to 120 characters, risk IDs, numeric scores, and schema. Never send source chunks. Validate returned IDs are a subset of supplied IDs.

Call the executor with:

```ts
messagePersistence: {
  mode: "redact-sensitive-markers",
  sensitiveMarkers: [
    "{{CANDIDATE_OUTPUT}}",
    "{{MATCHED_RISK_LABELS}}",
  ],
},
```

Assert persisted reviewer messages contain both hash/length redactions and
contain neither rejected candidate nor private labels.

- [ ] **Step 6: Run and commit**

Run: `rtk pnpm test -- lib/originality/__tests__/semantic-detectors.test.ts lib/originality/__tests__/evaluate.test.ts`

Expected: PASS.

```bash
rtk git add lib/originality/semantic-detectors.ts lib/originality/reviewer.ts lib/originality/evaluate.ts lib/originality/__tests__
rtk git commit -m "feat: detect semantic source leakage"
```

### Task 6: Build the atomic originality gate

**Files:**

- Create: `lib/originality/gate.ts`
- Create: `lib/originality/__tests__/gate.test.ts`

- [ ] **Step 1: Write failing decision/retry/persistence tests**

```ts
it("does not retry or persist application data when contaminated", async () => {
  mockEvaluate.mockResolvedValue(contaminatedResult());
  await expect(runOriginalityGate(input)).rejects.toMatchObject({
    name: "OriginalityContaminationError",
  });
  expect(input.generate).toHaveBeenCalledTimes(1);
  expect(input.persistAccepted).not.toHaveBeenCalled();
  expect(savedAssessment()).toMatchObject({ decision: "contaminated" });
});

it("retries suspect once with generic feedback", async () => {
  mockEvaluate
    .mockResolvedValueOnce(suspectResult())
    .mockResolvedValueOnce(cleanResult());
  await runOriginalityGate(input);
  expect(input.generate).toHaveBeenNthCalledWith(2, {
    feedback:
      "Use a materially different illustration, argument, and formulation.",
  });
});
```

Also assert second suspect/any contaminated quarantines generation, detector outage fails without application persistence, assessment lacks candidate prose/labels, clean assessment and application row share one transaction, and accepted entity ID is written back.

- [ ] **Step 2: Run and verify missing gate failure**

Run: `rtk pnpm test -- lib/originality/__tests__/gate.test.ts`

Expected: FAIL because gate is absent.

- [ ] **Step 3: Define exact gate API**

```ts
interface GeneratedCandidate<T> {
  value: T;
  text: string;
  executionId: string;
  promptRevisions: Record<string, string>;
}

interface OriginalityGateInput<T> {
  context: {
    projectId: string;
    chapterId?: string;
    chapterGenerationId?: string;
    stage: OriginalityStage;
    fieldPath: string;
    authorization: GenerationAuthorization;
    templateArtifactHash?: string;
    placeholderFunctionHash?: string;
  };
  generate(input: { feedback?: string }): Promise<GeneratedCandidate<T>>;
  persistAccepted(
    tx: PostgresJsDatabase<typeof schema>,
    candidate: GeneratedCandidate<T>,
    assessmentId: string,
    lineage: OriginalityLineage,
  ): Promise<{ entityType: string; entityId: string }>;
}
```

- [ ] **Step 4: Implement bounded state machine**

1. Load/verify profile set.
2. Generate first candidate.
3. Evaluate and record non-clean assessment hash/report.
4. Contaminated: quarantine generation and throw.
5. Suspect: generate exactly once with fixed generic feedback.
6. Evaluate second candidate.
7. Second non-clean: record, quarantine, throw.
8. Clean: transaction inserts assessment, invokes `persistAccepted`, and updates accepted entity fields.

Never include labels/source text in feedback or persisted signals.

- [ ] **Step 5: Run and commit**

Run: `rtk pnpm test -- lib/originality/__tests__/gate.test.ts`

Expected: PASS.

```bash
rtk git add lib/originality/gate.ts lib/originality/__tests__/gate.test.ts
rtk git commit -m "feat: gate generated content atomically"
```

### Task 7: Gate placeholder fills and remove sibling cascade

**Files:**

- Modify: `lib/ai/placeholder-fill.ts:647`
- Modify: `lib/ai/__tests__/placeholder-fill.test.ts`
- Modify: `lib/placeholders/prompt-data.ts`
- Modify: `app/api/projects/[id]/chapters/[chapterId]/placeholders/fill/route.ts`
- Modify: `app/api/projects/[id]/chapters/[chapterId]/placeholders/[name]/fill/route.ts`
- Modify: `app/api/projects/[id]/chapters/[chapterId]/placeholders/route.ts`
- Modify: `lib/placeholder-utils.ts:55`
- Modify: `lib/__tests__/placeholder-fill-metadata.test.ts`

- [ ] **Step 1: Write failing dependency/cascade tests**

```ts
it("sends only clean declared dependencies", async () => {
  const context = selectPlaceholderDependencies({
    current: { name: "respuesta_1", dependencyNames: ["objecion_1"] },
    rows: [
      cleanDefinition("objecion_1"),
      cleanDefinition("ejemplo_1"),
      staleDefinition("afirmacion_1"),
    ],
    currentLineage,
  });
  expect(context).toEqual({ objecion_1: "clean objection" });
});

it("never stores a contaminated definition", async () => {
  mockFill.mockResolvedValue(contaminatedIceDefinition);
  await postSingleFill();
  expect(updatedPlaceholder.definition).toBeNull();
  expect(generation.status).toBe("quarantined");
});

it("requires a legacy definition to be saved manually before confirmation", async () => {
  await expect(confirmManualDefinition(legacyDefinition, currentLineage))
    .rejects.toMatchObject({ code: "legacy_definition_requires_manual_save" });
});
```

- [ ] **Step 2: Run and verify all-sibling/current-persistence failures**

Run: `rtk pnpm test -- lib/ai/__tests__/placeholder-fill.test.ts lib/__tests__/placeholder-fill-metadata.test.ts`

Expected: FAIL because all siblings are passed and gate lineage is absent.

- [ ] **Step 3: Select dependency context explicitly**

Lookup only names in `current.dependencyNames`. Require each dependency:

- has definition;
- fill status `completed`;
- clean assessment ID;
- exact current originality lineage;
- no duplicate case-folded name.

Missing/stale dependency blocks current fill with a typed `PlaceholderDependencyError`; it never falls back to all siblings.

- [ ] **Step 4: Wrap single and batch generation**

Use `runOriginalityGate` for every definition. `persistAccepted` updates definition plus:

```ts
fillMetadata: buildPlaceholderFillMetadata({
  ...existingMetadata,
  status: "completed",
  originalityLineage: lineage,
  originalityAssessmentId: assessmentId,
  definitionOrigin: "ai",
}),
```

Batch streaming sends a success event only after the atomic clean commit. Suspect/contaminated events expose generic reason/code, not risk labels.

- [ ] **Step 5: Replace staleness comparison**

`needsPlaceholderFill` returns true when definition missing, editorial/prompt
hash differs, or `isOriginalityLineageCurrent` is false. Manual-save routes set
`definition_origin = manual`. Add a `confirmManualDefinition` action that records
current lineage and `manualConfirmedAt` without calling a provider; legacy
definitions cannot be confirmed until the user opens and saves them as manual.

- [ ] **Step 6: Run and commit**

Run: `rtk pnpm test -- lib/ai/__tests__/placeholder-fill.test.ts lib/__tests__/placeholder-fill-metadata.test.ts`

Expected: PASS.

```bash
rtk git add lib/ai/placeholder-fill.ts lib/ai/__tests__/placeholder-fill.test.ts lib/placeholders/prompt-data.ts app/api/projects/'[id]'/chapters/'[chapterId]'/placeholders lib/placeholder-utils.ts lib/__tests__/placeholder-fill-metadata.test.ts
rtk git commit -m "feat: gate placeholder definitions"
```

### Task 8: Gate fragments

**Files:**

- Modify: `app/api/projects/[id]/prompts/[promptId]/generate/route.ts:165`
- Modify: `lib/generate.ts`
- Modify: `lib/prompts/chapter-executor.ts`
- Modify: `lib/prompts/__tests__/chapter-executor.test.ts`
- Create: `lib/__tests__/fragment-originality-gate.test.ts`

- [ ] **Step 1: Write failing fragment persistence tests**

Assert contaminated/suspect-after-retry candidates create no `fragments` row; clean candidate creates one row whose metadata contains full lineage and assessment ID. Assert prompt revision map contains both:

```ts
{
  "chapter-content": chapterPromptRevisionId,
  "generation-system": runtimePromptRevisionId,
}
```

- [ ] **Step 2: Run and verify direct fragment insert failure**

Run: `rtk pnpm test -- lib/__tests__/fragment-originality-gate.test.ts lib/prompts/__tests__/chapter-executor.test.ts`

Expected: FAIL because current route inserts generated content without atomic assessment.

- [ ] **Step 3: Return complete prompt lineage from executor**

Extend executor result with resolved runtime revision ID while preserving chapter prompt revision ID:

```ts
promptRevisions: {
  "chapter-content": input.chapterPromptRevisionId,
  "generation-system": execution.revision.id,
}
```

- [ ] **Step 4: Gate and atomically insert fragment**

Move fragment insertion into `persistAccepted`. Set:

```ts
metadata: {
  ...existingMetadata,
  originalityLineage: lineage,
  originalityAssessmentId: assessmentId,
},
```

Do not keep the pre-gate candidate in generation metadata.

- [ ] **Step 5: Run and commit**

Run: `rtk pnpm test -- lib/__tests__/fragment-originality-gate.test.ts lib/prompts/__tests__/chapter-executor.test.ts`

Expected: PASS.

```bash
rtk git add app/api/projects/'[id]'/prompts/'[promptId]'/generate/route.ts lib/generate.ts lib/prompts/chapter-executor.ts lib/prompts/__tests__/chapter-executor.test.ts lib/__tests__/fragment-originality-gate.test.ts
rtk git commit -m "feat: gate generated fragments"
```

### Task 9: Gate assembly, critique, correction, and title outputs

**Files:**

- Modify: `trigger/generate-chapter.ts`
- Modify: `trigger/generate-critique.ts`
- Modify: `trigger/generate-correction.ts`
- Modify: `app/api/projects/[id]/generate-title/route.ts:135`
- Modify: `lib/title/generate.ts`
- Modify: `lib/title/__tests__/generate.test.ts`
- Modify: `lib/assembly/__tests__/assembler.test.ts`
- Modify: `lib/review/__tests__/critique.test.ts`
- Modify: `lib/review/__tests__/correction.test.ts`
- Create: `lib/__tests__/downstream-originality-gates.test.ts`

- [ ] **Step 1: Write failing stage matrix tests**

For each stage `assembly`, `critique`, `correction`, `title`:

- contaminated first attempt → no output field update, generation quarantined;
- suspect then clean → exactly two provider calls, second output stored;
- suspect twice → no output stored, generation quarantined;
- clean → output, assessment, and metadata lineage commit together.

Title candidate text is canonical:

```ts
const candidateText = [title, subtitle].filter(Boolean).join("\n");
```

- [ ] **Step 2: Run and verify unguarded outputs**

Run: `rtk pnpm test -- lib/__tests__/downstream-originality-gates.test.ts lib/title/__tests__/generate.test.ts lib/assembly/__tests__/assembler.test.ts lib/review/__tests__/critique.test.ts lib/review/__tests__/correction.test.ts`

Expected: FAIL for direct persistence.

- [ ] **Step 3: Wrap each provider-producing stage**

Each generator returns value, text, execution ID, and exact revision map:

- assembly: `assembly-planner`, `assembly`;
- critique: `critique`;
- correction: `corrector` plus inherited `critique`;
- title: `title`.

Pass the stage-specific `templateArtifactHash` for chapter outputs. For project title, use canonical hash of all project chapter artifact hashes sorted by chapter position.

- [ ] **Step 4: Persist only through gate transaction**

Assembly/critique/correction update `chapter_generations.assembled_content` and metadata. Title updates `projects.title/subtitle` and title generation metadata. All include `originalityLineage` and `originalityAssessmentId`.

- [ ] **Step 5: Run and commit**

Run: `rtk pnpm test -- lib/__tests__/downstream-originality-gates.test.ts lib/title/__tests__/generate.test.ts lib/assembly/__tests__/assembler.test.ts lib/review/__tests__/critique.test.ts lib/review/__tests__/correction.test.ts`

Expected: PASS.

```bash
rtk git add trigger/generate-chapter.ts trigger/generate-critique.ts trigger/generate-correction.ts app/api/projects/'[id]'/generate-title/route.ts lib/title lib/assembly/__tests__ lib/review/__tests__ lib/__tests__/downstream-originality-gates.test.ts
rtk git commit -m "feat: gate all manuscript outputs"
```

### Task 10: Surface quarantine and lineage staleness in UI

**Files:**

- Modify: `components/projects/placeholder-fill-section.tsx:427`
- Modify: `components/projects/generate-chapter-button.tsx`
- Modify: `app/api/chapter-generations/[id]/route.ts`
- Create: `components/projects/__tests__/originality-status.test.tsx`

- [ ] **Step 1: Write failing UI-state tests**

```ts
it("shows stale when policy lineage changes", () => {
  renderStatus({ saved: policyV2Lineage, current: policyV3Lineage });
  expect(screen.getByText("stale")).toBeVisible();
});

it("shows quarantine without source details", () => {
  renderStatus({ generationStatus: "quarantined" });
  expect(screen.getByText("Contenido en cuarentena")).toBeVisible();
  expect(screen.queryByText(/James Clear|hielo|risk_/i)).toBeNull();
});

it("requires confirmation before stale manual definition reuse", async () => {
  renderStatus({
    placeholder: staleManualDefinition,
    current: currentLineage,
  });
  expect(screen.getByRole("button", { name: "Confirmar definición manual" }))
    .toBeVisible();
  expect(screen.getByRole("button", { name: "Generar capítulo" }))
    .toBeDisabled();
});
```

- [ ] **Step 2: Run and verify missing state**

Run: `rtk pnpm test -- components/projects/__tests__/originality-status.test.tsx`

Expected: FAIL because UI only knows prompt/editorial hashes and failed status.

- [ ] **Step 3: Render safe status**

API returns decision/status codes and assessment ID only. UI messages:

- `stale`: “Regenera: cambió lineage de seguridad.”
- `quarantined`: “Contenido en cuarentena. No se guardó ni reutilizó.”
- detector unavailable: “Generación bloqueada porque verificación no estuvo disponible.”

Do not return signals, labels, source hashes, or profile IDs through ordinary project APIs.

Manual confirmation calls the placeholder route action from Task 7, displays the
current lineage version/policy without private hashes, and enables generation
only after the server returns updated confirmation metadata.

- [ ] **Step 4: Run and commit**

Run: `rtk pnpm test -- components/projects/__tests__/originality-status.test.tsx`

Expected: PASS.

```bash
rtk git add components/projects app/api/chapter-generations/'[id]'/route.ts
rtk git commit -m "feat: show originality safety state"
```

### Task 11: Verify Stage C with calibration corpus

**Files:**

- Create: `lib/originality/__tests__/fixtures/synthetic-source-cases.ts`
- Create: `lib/originality/__tests__/calibration.test.ts`

- [ ] **Step 1: Add short synthetic calibration fixtures**

Include:

- unique number/formula combination;
- named synthetic framework;
- ordered two-entity case;
- phase-transition metaphor and Spanish paraphrase;
- unrelated generic advice controls;
- same-topic but independently phrased controls;
- borderline embedding vectors.

No long copyrighted passage enters repository fixtures.

- [ ] **Step 2: Run focused suite**

Run:

```bash
rtk pnpm test -- \
  lib/__tests__/originality-assessment-migration.test.ts \
  lib/originality/__tests__ \
  lib/ai/__tests__/placeholder-fill.test.ts \
  lib/__tests__/fragment-originality-gate.test.ts \
  lib/__tests__/downstream-originality-gates.test.ts \
  components/projects/__tests__/originality-status.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run full verification**

Run: `rtk pnpm typecheck`

Expected: PASS.

Run: `rtk pnpm lint`

Expected: PASS.

Run: `rtk pnpm test`

Expected: PASS.

- [ ] **Step 4: Verify database safety properties**

Using synthetic integration data, verify:

- rejected prose absent from application tables;
- rejected assessment contains hash/signals only;
- accepted entity hash matches assessment candidate hash;
- active template profile-set hash matches every accepted lineage;
- source-free assessment has null run ID and empty-set hash;
- template project never falls back to empty profiles;
- stale dependency definition never enters sibling context;
- detector outage stores no output and returns blocked state.

- [ ] **Step 5: Commit calibration/verification**

```bash
rtk git add lib/originality/__tests__/fixtures/synthetic-source-cases.ts lib/originality/__tests__/calibration.test.ts
rtk git diff --cached --name-only
rtk git commit -m "test: calibrate originality policy"
```

## Stage C exit criteria

- Every exportable output passes one current-policy gate before persistence.
- Strong deterministic evidence fails immediately.
- Suspect output receives one generic retry only.
- Rejected output leaves no application row and no stored prose.
- Accepted output and clean assessment commit atomically.
- Cross-language synthetic paraphrases are suspect/contaminated.
- Unrelated generic controls remain clean.
- Placeholder fill uses only declared, clean, current dependencies.
- Any lineage component change marks prior AI content stale.
- Full tests, typecheck, lint, and migration pass.
