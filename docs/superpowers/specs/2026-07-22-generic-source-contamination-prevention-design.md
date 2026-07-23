# Generic Source Contamination Prevention

**Date:** 2026-07-22  
**Status:** approved  
**Scope:** template extraction, generated project content, lineage, and legacy remediation

## 1. Problem

The template pipeline accepts a source chapter, extracts a rhetoric trace, converts
that trace into reusable prompts, fills placeholders for a different project topic,
and later generates fragments and assembled chapters.

The current pipeline can preserve source-specific material while changing its
surface wording. Confirmed contamination includes:

- source-specific quantitative models;
- recognizable metaphors and examples;
- coined concepts;
- argument sequences;
- source-derived placeholder names and functions;
- sibling definitions that reconstruct the source domain;
- translated or paraphrased material that bypasses lexical comparison.

The incident investigated for project
`f67abde7-06d6-4222-bd11-ac919ecf06ed` and chapter
`7cd9272e-42fb-43b6-a36a-51a63d143e0a` demonstrates the full chain:

1. Rhetoric Trace `1.0` received the complete source chapter.
2. Its free-text output retained the 1% model, compounding, a physical phase
   transition, latent progress, and goals-versus-systems distinctions.
3. Template Generator `1.0` received both that trace and the complete source.
4. The generated template persisted source-derived prompts and placeholder
   functions.
5. A project copied that template as a snapshot.
6. Placeholder fill later stopped receiving raw prompt/source text, but still
   received a contaminated `function` and contaminated sibling definitions.
7. The model reconstructed the melting-ice metaphor for the new topic.
8. The originality checker accepted it because the Spanish regex was too narrow
   and the shingle corpus used English source text.

Removing the source from Template Generator v7 reduced one exposure path but did
not solve the problem. Rhetoric Trace remained free text and continued carrying
source semantics into Pass 2.

## 2. Root Causes

### 2.1 Free-text intermediate representation

Rhetoric Trace currently emits:

- `operation`;
- `description`;
- `effectOnReader`;
- `assemblyNotes`.

All four fields can encode source content. Zod validates shape, not semantic
nullity.

### 2.2 Generator trusts an unvalidated trace

Template Generator describes the trace as validated, but no semantic validator
exists between Pass 1 and Pass 2.

### 2.3 Source-specific examples inside defensive prompts

Prompt instructions include negative and positive examples derived from the same
source family. Even when labeled incorrect, those examples expose the model to
the concepts that the pipeline is trying to remove.

### 2.4 Advisory and partial template checks

Template generation checks only `block.content`, uses advisory mode, and persists
flagged output. It does not enforce originality across:

- `name`;
- `userPrompt`;
- `function`;
- `sourceContext`;
- `notes`;
- placeholder names;
- placeholder functions.

### 2.5 Static corpus instead of template-scoped provenance

The checker knows about a local James Clear corpus. It does not automatically
compare generated content with the source used to build each template.

### 2.6 Cross-language blind spot

Word shingles and longest-common-substring comparison require lexical overlap.
Translation and semantic paraphrase commonly produce zero overlap.

### 2.7 Definition cascade

Single-placeholder fill sends every sibling definition to the LLM. One
contaminated definition becomes context for later definitions.

### 2.8 Incomplete staleness model

Placeholder freshness currently depends on prompt and editorial-brief hashes.
It does not include:

- template pipeline version;
- compiler version/hash;
- source profile version/hash;
- originality policy version;
- placeholder function hash;
- placeholder-fill prompt revision.

Changing a defense therefore does not invalidate previously generated content.

### 2.9 Legacy snapshots are not retroactive

Projects copy template prompts and placeholders. Changing the default prompt
revision does not update existing templates or projects.

## 3. Design Objective

Prevent source contamination generically for any source by:

1. limiting source influence to a closed, content-free rhetoric representation;
2. compiling templates from trusted code instead of a second creative LLM pass;
3. building a private source-specific anti-leak profile;
4. checking every downstream generated output against that profile;
5. failing closed before contaminated text becomes application data;
6. preserving immutable lineage;
7. quarantining and regenerating legacy data instead of rewriting it.

## 4. Contamination Contract

The contract is versioned as `originality-policy-v2`.

### 4.1 Allowed inheritance

The pipeline may preserve:

- broad rhetoric move categories;
- ordering of broad move categories;
- abstract dependencies between moves;
- general resource classes;
- general intended reader effects;
- general discourse relations.

Examples of allowed information:

- opening with a case;
- following a claim with a contrast;
- using an analogy;
- supporting a prior move;
- closing with a synthesis.

### 4.2 Forbidden inheritance

The pipeline must not preserve:

- thesis or substantive arguments;
- concrete causal, normative, or comparative claims;
- named people, organizations, places, products, or methods;
- figures, percentages, formulas, or distinctive quantitative models;
- coined terms or named frameworks;
- identifiable stories, cases, examples, analogies, or metaphors;
- source-specific resource subtypes;
- distinctive creative sequences inside a move;
- placeholder names/functions that reveal source propositions;
- fixed predicates that reconstruct a source claim;
- close translation or semantic paraphrase of source expression.

Examples:

- `analogy` is allowed;
- `ice melting after gradual heating reaches a threshold` is forbidden;
- `quantitative illustration` is allowed;
- `one-percent daily compounding to 37x` is forbidden.

### 4.3 Decision states

Every gate returns exactly one state:

- `clean`: no actionable signal;
- `suspect`: probabilistic signal requiring one independent review;
- `contaminated`: strong signal; fail closed.

No detector may silently convert `suspect` or `contaminated` into `clean`.

## 5. Program Decomposition

The solution spans four dependent deliverables. Each deliverable must ship as
working, testable software before the next begins.

1. **Immediate containment and lineage foundation**
2. **Closed Trace IR and deterministic template compiler**
3. **Template-scoped downstream originality enforcement**
4. **Legacy audit, regeneration, and project replacement**

## 6. Deliverable 1: Immediate Containment and Lineage

### 6.1 Purpose

Stop known unsafe behavior before the compiler redesign is complete and create
the persistence required by later deliverables.

### 6.2 Required behavior

- Check all template output fields, not only `content`.
- Change template originality checks from advisory to fail-closed.
- Fix known regex variants such as `el hielo se derrite`.
- Prevent templates without validated pipeline lineage from creating new
  projects.
- Preserve read access to legacy projects.
- Add centralized generation authorization.
- Create run and artifact persistence.

### 6.3 Central authorization

Add:

```ts
type GenerationAuthorization =
  | {
      scope: "template";
      pipelineRunId: string;
      sourceProfileSetHash: string;
      originalityPolicyVersion: string;
    }
  | {
      scope: "source-free";
      pipelineRunId: null;
      sourceProfileSetHash: typeof EMPTY_SOURCE_PROFILE_SET_HASH;
      originalityPolicyVersion: string;
    };

assertTemplateGenerationAllowed(
  projectId: string,
): Promise<GenerationAuthorization>
```

It resolves the project's template and active pipeline run. It either returns the
clean lineage above or throws `GenerationBlockedError` with one of:

- `template_unverified`;
- `template_quarantined`;
- `template_failed`;
- `missing_source_profile`;
- `unsupported_pipeline`;
- `unsupported_policy`.

It never returns an ignorable `allowed: false` result. Every entry point calls it
before provider invocation or application-data mutation.

A project whose `book_template_id` is null receives `scope = "source-free"` with
the canonical SHA-256 hash of an empty profile set. This preserves manual,
non-template projects without pretending that they have template lineage.
Projects that reference a template never fall back to `source-free`.

All mutating generation entry points must call this guard:

- bulk placeholder fill;
- single-placeholder fill;
- fragment generation;
- chapter generation;
- assembly;
- title generation;
- critique;
- correction.

Read-only routes remain available.

### 6.4 Operational template status

`book_templates.status` remains the sole operational status:

- `generating`;
- `ready`;
- `quarantined`;
- `failed`.

Do not add a second contamination status to `book_templates`.

Add only:

```text
active_pipeline_run_id UUID NULL
```

A template is eligible for new projects only when:

- status is `ready`;
- `active_pipeline_run_id` is non-null;
- active run status is `clean`;
- active run uses supported pipeline and policy versions.

## 7. Pipeline Persistence

### 7.1 `template_pipeline_runs`

One row represents one attempt to generate or validate a template.

Required fields:

```text
id
book_template_id
status
pipeline_version
compiler_version
compiler_hash
recipe_catalog_hash
rhetoric_trace_revision_id
source_profile_version
originality_policy_version
failure_stage
report
created_at
completed_at
```

Run status:

- `running`;
- `clean`;
- `quarantined`;
- `failed`.

`failure_stage` values:

- `source_profile`;
- `trace_classification`;
- `trace_validation`;
- `template_compilation`;
- `template_validation`;
- `finalization`;
- null for clean runs.

Reports contain signal types, field paths, hashes, scores, and risk-element IDs.
Reports must not contain long source or generated passages.

### 7.2 `template_source_profiles`

One row exists per run and source chapter.

Required fields:

```text
id
pipeline_run_id
chapter_id
source_hash
source_language
profile_version
distinctive_elements
profile_hash
created_at
```

`distinctive_elements` is structured JSON:

```ts
interface DistinctiveElement {
  id: string;
  kind:
    | "entity"
    | "number"
    | "formula"
    | "coined_term"
    | "named_framework"
    | "metaphor"
    | "anecdote"
    | "example"
    | "creative_sequence";
  canonicalLabel: string;
  aliases: string[];
  sourceChunkIndexes: number[];
  confidence: number;
  distinctiveness: number;
}
```

Constraints:

- `canonicalLabel` max 120 characters;
- each alias max 120 characters;
- `confidence` and `distinctiveness` are numbers from zero through one;
- no verbatim passage storage;
- no element is sent to generative stages.

### 7.3 `template_source_profile_chunks`

One row exists per normalized source chunk.

Required fields:

```text
id
source_profile_id
chunk_index
content_hash
lexical_fingerprint
embedding
token_count
created_at
```

Raw chunk text is not stored in this table.

### 7.4 `template_run_artifacts`

One row exists per clean chapter artifact.

Required fields:

```text
id
pipeline_run_id
chapter_id
trace_ir
compiled_template
artifact_hash
validation_report
created_at
```

Only artifacts that passed trace, compiler, and contamination invariants may be
stored. Unique key: `(pipeline_run_id, chapter_id)`.

Artifacts make retries resumable without persisting user-visible prompts before
the complete template is clean.

### 7.5 Template artifact lineage

Add nullable migration columns:

```text
prompts.template_pipeline_run_id UUID
prompts.template_artifact_hash TEXT
chapter_placeholders.template_pipeline_run_id UUID
chapter_placeholders.template_artifact_hash TEXT
chapter_placeholders.dependency_names TEXT[]
chapter_placeholders.definition_origin TEXT
```

They remain nullable only for legacy rows. Application validation requires both
fields on every clean-v2 template prompt, copied project prompt, and compiled
placeholder.

`prompt_versions.snapshot` also records both values. Project template-copy logic
must preserve them byte-for-byte; it must not substitute the current default run.

### 7.6 `originality_assessments`

One row records each downstream gate decision without retaining candidate prose.

Required fields:

```text
id
pipeline_run_id
project_id
chapter_id
chapter_generation_id
execution_id
stage
candidate_hash
source_profile_set_hash
originality_policy_version
decision
signals
accepted_entity_type
accepted_entity_id
created_at
```

`decision` is `clean`, `suspect`, or `contaminated`. `signals` contains detector
IDs, source risk-element IDs, scores, thresholds, and field paths only.

`pipeline_run_id` is nullable only for `source-free` projects. A database check
requires it for template-scoped assessments.

For accepted content, the clean assessment and application row commit in one
transaction and reference each other through `accepted_entity_type/id`. Rejected
content has no accepted entity and retains only hash/report metadata.

## 8. Source Profile Creation

Source profiling is the only component besides Trace classification that sees
the source.

### 8.1 Deterministic profile

For every normalized source chunk:

- compute SHA-256;
- compute normalized 5-gram and 8-gram fingerprints;
- extract numbers and formulas;
- generate a multilingual embedding using the existing embedding provider;
- record token count and language.

### 8.2 Distinctive-element profiler

Add a versioned prompt kind:

```text
source-risk-profiler
```

It returns only the `DistinctiveElement[]` schema. It must not return summaries,
recommendations, prose commentary, or long quotations.

The profiler may identify source content because its output is a private detection
profile. That profile:

- is never available to template or manuscript generators;
- is never included in editorial context;
- is never exposed through ordinary project APIs;
- is visible only to authorized audit tooling.

### 8.3 Profile failure

If hashing, chunking, embedding, or structured profiling fails:

- mark the run `failed`;
- set `failure_stage = source_profile`;
- do not continue in reduced-protection mode.

## 9. Sensitive Prompt Persistence

`llm_prompt_executions.messages` currently stores complete composed messages,
including source chapters.

Extend prompt execution input with:

```ts
messagePersistence?: {
  mode: "full" | "redact-sensitive-markers";
  sensitiveMarkers?: string[];
};
```

For source-bearing prompts:

```ts
messagePersistence: {
  mode: "redact-sensitive-markers",
  sensitiveMarkers: ["{{CAPITULO_FUENTE}}"],
}
```

The provider receives the real composed message. The database stores a second
composition in which each sensitive marker value becomes:

```text
[REDACTED sha256=<hash> chars=<count>]
```

`data_manifest` retains the same hash and length. New executions must not retain
source text in `messages`.

Historical executions are not rewritten automatically.

## 10. Deliverable 2: Closed Trace IR

### 10.1 Remove free text

Rhetoric Trace v2 returns only controlled enums, integers, and typed relations.

```ts
const recipeIdValues = [
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

const resourceClassValues = [
  "none",
  "case",
  "anecdote",
  "question_set",
  "quantitative_model",
  "analogy",
  "comparison_table",
  "definition",
  "citation",
  "example",
  "list",
  "counterexample",
] as const;

const discourseRelationValues = [
  "open",
  "continue",
  "elaborate",
  "support",
  "contrast",
  "generalize",
  "reframe",
  "apply",
  "resolve",
  "close",
] as const;

const readerEffectValues = [
  "curiosity",
  "credibility",
  "surprise",
  "clarity",
  "tension",
  "reassurance",
  "reflection",
  "motivation",
  "recall",
] as const;

const slotTypeValues = [
  "concept",
  "claim",
  "example",
  "question",
  "objection",
  "response",
  "evidence",
  "application",
] as const;

const dependencyRelationValues = [
  "elaborates",
  "contrasts",
  "supports",
  "applies",
  "resolves",
] as const;
```

Trace structure:

```ts
interface TraceDependency {
  fromPosition: number;
  relation: DependencyRelation;
  slotType: SlotType;
}

interface TraceMove {
  position: number;
  recipeId: RecipeId;
  resourceClass: ResourceClass;
  discourseRelation: DiscourseRelation;
  readerEffect: ReaderEffect;
  dependencies: TraceDependency[];
}

interface TraceIr {
  moves: TraceMove[];
}
```

Forbidden fields include:

- `operation`;
- `description`;
- free-text `effectOnReader`;
- `assemblyNotes`;
- names generated by the LLM;
- free-text slot descriptions;
- catch-all or custom fields.

Zod schemas use `.strict()` at every object level.

### 10.2 Trace validation

After schema validation:

- positions begin at zero and are consecutive;
- dependencies point only to earlier positions;
- dependency positions exist;
- recipe IDs exist in the active recipe registry;
- resource class is allowed by the chosen recipe;
- dependency slot type is produced by the referenced recipe;
- required dependency relations are present;
- unsupported combinations fail;
- no unknown properties survive.

Invalid output receives one classifier retry. A second invalid output marks the run
`failed` at `trace_validation`.

### 10.3 Rhetoric Trace v2 prompt

The prompt:

- explains the contamination contract;
- lists enum semantics;
- contains examples from multiple unrelated synthetic domains;
- contains no examples from known source books;
- has configuration `pipelineContract = "trace-ir-v2"`;
- requires `{{CAPITULO_FUENTE}}` and `{{OUTPUT_SCHEMA}}`;
- uses sensitive-marker message redaction.

Template creation rejects a rhetoric revision whose configuration does not declare
`trace-ir-v2`.

## 11. Deterministic Template Compiler

### 11.1 Remove creative Pass 2

Template Generator LLM is removed from new template creation.

Legacy prompt definitions and revisions remain archived for execution history.
The auto-template API no longer accepts `templateGeneratorRevisionId`.
The creation UI removes the Template Generator revision selector and displays the
active compiler version/hash as read-only metadata.

### 11.2 Recipe registry

The compiler uses a code-owned registry:

```ts
interface TemplateRecipe {
  id: RecipeId;
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

The registry contains only explicitly supported recipes. There is no Cartesian
product generation and no generic fallback.

Unknown or incompatible input fails with `UnsupportedRecipeError`.

### 11.3 Symbol table

The compiler owns all placeholder names.

Rules:

- LLM output never contains placeholder names;
- produced slots receive canonical names by type and stable counter;
- dependencies reuse the canonical name produced at the referenced position;
- local slots receive deterministic names scoped by recipe occurrence;
- same IR and compiler hash always produce the same output and artifact hash.

Example:

```text
position 2 produces SlotType concept → {concepto_1}
position 3 elaborates position 2 / concept → reuses {concepto_1}
```

### 11.4 Compiled output

Each block contains:

```ts
interface CompiledBlock {
  title: string;
  content: string;
  userPrompt: string;
  function: string | null;
  sourceContext: string | null;
  notes: string | null;
  placeholders: Array<{
    name: string;
    function: string;
    dependsOn: string[];
  }>;
}
```

Every string comes from trusted recipes plus compiler-owned canonical placeholder
names. No source text or model-produced prose enters a compiled block.

### 11.5 Compiler invariants

For every block:

- `content` and `userPrompt` contain identical placeholder sets;
- every used placeholder is declared once within its block;
- every declared placeholder is used in its block;
- repeated declarations across blocks are byte-identical and finalization
  persists one canonical row per chapter/name;
- names use lowercase `snake_case`;
- placeholder functions come from recipes;
- every `dependsOn` name is canonical, declared by an earlier compiled move, and
  free of cycles;
- no unresolved runtime markers exist;
- all text is generated by active recipe catalog;
- output is deterministic.

Compiler failure marks the run `failed` at `template_compilation`.

## 12. Atomic Generation and Retry

Per chapter:

1. build or reuse source profile;
2. classify source into Trace IR;
3. validate IR;
4. compile template;
5. validate compiler invariants;
6. store clean run artifact.

After all chapters have clean artifacts:

1. open one short database transaction;
2. lock the template and run rows;
3. return the already-finalized result if the run is already `clean`;
4. require the run to be `running` and verify one valid artifact per source
   chapter;
5. insert compiled prompts and immutable prompt revisions;
6. insert placeholders;
7. set run status `clean`;
8. set `book_templates.active_pipeline_run_id`;
9. set template status `ready`;
10. commit.

If any chapter fails:

- no compiled prompts/placeholders become active;
- clean artifacts remain resumable;
- run receives failure/quarantine report;
- template status becomes `failed` or `quarantined`.

Task idempotency keys use `(pipeline_run_id, chapter_id, source_hash,
rhetoric_revision_id, compiler_hash)`.

## 13. Deliverable 3: Downstream Originality Enforcement

### 13.1 Source profile lookup

Every project inherits the active clean pipeline run through
`projects.book_template_id`.

Before generating text:

1. authorize project/template;
2. load all source profiles for the active run, or the empty set for a
   `source-free` project;
3. compute `sourceProfileSetHash`;
4. evaluate candidate output before application persistence.

The versioned baseline blocklist still runs for `source-free` projects. Missing
template profiles never cause a templated project to fall back to the empty set.

### 13.2 Covered outputs

Enforcement applies to:

- placeholder definitions;
- generated fragments;
- assembled chapters;
- generated titles/subtitles;
- corrections;
- other exportable manuscript text.

Critique output is checked before storage because it may quote contaminated
manuscript content.

### 13.3 Signal model

Strong deterministic signals:

- high-distinctiveness coined-term match;
- high-distinctiveness named-framework match;
- protected sequence containing at least two distinctive entities;
- formula/number combination match;
- normalized 5-gram/8-gram containment over policy threshold;
- exact or normalized high-distinctiveness metaphor/anecdote/example alias match.

Probabilistic signals:

- multilingual embedding similarity with source chunks;
- semantic similarity with distinctive-element labels;
- source-leakage review prompt.

Initial policy thresholds:

```ts
{
  profileElementConfidenceThreshold: 0.80,
  strongDistinctivenessThreshold: 0.90,
  lexicalContainmentThreshold: 0.15,
  semanticSuspectThreshold: 0.88,
  semanticStrongThreshold: 0.92,
}
```

Thresholds are configuration of `originality-policy-v2` and covered by calibration
tests. A threshold change creates a new policy version.

### 13.4 Decision rules

`contaminated`:

- any strong deterministic signal meeting the element-confidence and
  distinctiveness thresholds; or
- semantic strong signal plus matching distinctive-element signal; or
- two independent semantic signals confirmed by review.

`suspect`:

- semantic threshold exceeded without independent confirmation; or
- source-leakage reviewer reports possible reconstruction without a strong signal.

`clean`:

- no strong signal;
- semantic score below suspect threshold;
- no distinctive-element match.

The optional `source-leakage-review` prompt receives only:

- candidate output;
- matched distinctive-element labels;
- signal scores;
- hashes/IDs.

It never receives the full source. It can confirm or preserve `suspect`; it cannot
downgrade a strong deterministic signal.

Execution-message persistence redacts both `{{CANDIDATE_OUTPUT}}` and
`{{MATCHED_RISK_LABELS}}`; the provider still receives real values. Rejected
candidate prose and private labels therefore do not enter execution history.

Both `source-risk-profiler` and `source-leakage-review` become explicit
`promptKindValues`; revisions are versioned through the existing prompt registry.

### 13.5 Retry policy

- `contaminated`: fail immediately; no creative retry.
- `suspect`: one retry with generic feedback requiring a different illustration,
  argument, or formulation.
- retry feedback never contains source text or distinctive-element labels.
- second `suspect` or any `contaminated` result quarantines the generation.

No rejected candidate becomes a fragment, definition, assembly, or correction row.
Execution/audit metadata may retain hashes and signal reports, not rejected prose.

### 13.6 Sibling definitions

Placeholder fill no longer receives every existing sibling definition.

It receives only:

- definitions named by the current placeholder's persisted compiler-owned
  `dependency_names`;
- definitions that passed the current originality policy;
- definitions with matching active lineage metadata.

Definitions without explicit dependency are omitted.

## 14. Downstream Lineage and Staleness

Generated metadata must include:

```ts
interface BaseOriginalityLineage {
  scope: "template" | "source-free";
  sourceProfileSetHash: string;
  originalityPolicyVersion: string;
  promptRevisions: Record<string, string>;
}

type OriginalityLineage =
  | (BaseOriginalityLineage & {
      scope: "template";
      pipelineRunId: string;
      pipelineVersion: string;
      compilerVersion: string;
      compilerHash: string;
      templateArtifactHash: string;
      sourceProfileVersion: string;
      placeholderFunctionHash?: string;
    })
  | (BaseOriginalityLineage & {
      scope: "source-free";
      pipelineRunId: null;
    });
```

Placeholder freshness and generation reuse require exact equality with current
lineage.

Any mismatch marks output stale:

- pipeline run changed;
- compiler changed;
- recipe catalog changed;
- source profile changed;
- policy changed;
- function changed;
- any entry in the canonical prompt-revision map changed.

Manual definitions remain distinguishable from AI-filled definitions and require
explicit user confirmation before reuse after lineage changes.

`definition_origin` is `legacy`, `manual`, or `ai`. Migration assigns `legacy`;
manual edits assign `manual`; successful fills assign `ai`. Confirming a manual
definition records current lineage and confirmation time without relabeling it as
AI-generated.

Storage mapping:

- template and copied project prompts use the structural lineage columns from
  section 7.5;
- `chapter_placeholders.fill_metadata` stores complete originality lineage plus
  the clean assessment ID;
- `fragments.metadata` stores complete originality lineage plus the clean
  assessment ID;
- chapter-generation, assembly, critique, correction, and title metadata store
  complete originality lineage plus their clean assessment IDs.

Missing lineage on any AI-generated row means legacy/stale, never implicitly
clean.

## 15. Error Policy

### 15.1 Technical failure

Examples:

- network/provider unavailable;
- embedding unavailable;
- database unavailable;
- malformed structured output;
- unsupported recipe;
- finalization failure.

Response:

- mark run/generation `failed`;
- use normal bounded task retries;
- do not label content contaminated without evidence;
- do not persist candidate application data.

### 15.2 Suspected leakage

Response:

- mark generation/run `quarantined`;
- preserve signal report;
- prevent activation or downstream reuse;
- allow authorized review.

### 15.3 Confirmed leakage

Response:

- mark generation/run `quarantined`;
- no automatic rewriting;
- no output activation;
- no reuse as context;
- require regeneration through a clean pipeline.

### 15.4 Fail-closed requirements

No reduced-protection mode exists for:

- missing source profile on a templated project;
- unavailable detector;
- unsupported policy version;
- unsupported compiler version;
- unknown template lineage.

## 16. Deliverable 4: Legacy Audit and Remediation

### 16.1 Audit command

Add:

```bash
rtk pnpm audit:template-contamination --dry-run
```

The command reports:

- template ID/name/status;
- template-generation revisions;
- source availability;
- pipeline lineage;
- matched fields/signals;
- derived projects;
- generation counts;
- recommended action.

It does not mutate data in dry-run mode.

### 16.2 Legacy classification

Legacy states are reported in run/audit data:

- `legacy_unverified`;
- `suspect`;
- `contaminated`;
- `clean_v2`.

Existing templates do not become eligible for new projects until a clean v2 run is
active.

### 16.3 Source recovery

Preferred source input for regeneration is explicit admin re-upload.

Historical `llm_prompt_executions.messages` may make a source recoverable, but:

- audit may report recoverability;
- regeneration does not read it automatically;
- use requires explicit `--allow-execution-source`;
- recovered text is hashed and profiled;
- no new raw copy is persisted in execution messages.

If source is unavailable, the template remains `legacy_unverified`.

### 16.4 Mutation operation ledger

Add `pipeline_maintenance_operations`:

```text
id
kind
input_hash
status
result_template_id
result_project_id
report
created_at
completed_at
```

`kind` is `template_regeneration` or `project_clone`. The caller supplies `id` as
`operation-id`. A unique primary key and immutable `input_hash` provide retry
idempotency. Status is `running`, `completed`, or `failed`.

### 16.5 Template regeneration

Add:

```bash
rtk pnpm regenerate:template \
  --template-id <id> \
  --source-dir <path> \
  --operation-id <uuid> \
  [--dry-run]
```

Behavior:

- dry-run validates inputs, computes source hashes, and reports planned IDs/actions
  without mutation;
- create a new template ID;
- create a new pipeline run;
- generate through v2;
- record legacy template ID in regeneration metadata;
- leave original template unchanged;
- activate only after all chapters pass.

`operation-id` has a unique database record. Repeating the command with the same
ID and identical input hashes returns the prior result. Reusing it with different
inputs fails.

No script edits legacy prompts in place.

### 16.6 Project replacement

In-place rebase is prohibited because fragments and prompt versions depend on prompt
rows with cascading relationships.

Add nullable:

```text
projects.supersedes_project_id
```

Add:

```bash
rtk pnpm clone:project-to-clean-template \
  --project-id <legacy-project-id> \
  --template-id <clean-template-id> \
  --operation-id <uuid> \
  [--dry-run]
```

The clone copies only authorized project configuration:

- owner;
- internal project name with replacement suffix;
- topic;
- user-provided project sources and their derived chunks after source-ID
  remapping;
- approved editorial brief content, contracts, and source bindings after
  chapter/source-ID remapping;
- project-level prompt bindings that remain compatible.

It does not copy:

- placeholder definitions;
- fragments;
- chapter generations;
- assembled text;
- manuscript title/subtitle;
- critiques;
- corrections;
- legacy prompt rows.
- template source profiles or template-generation execution messages.

The original project remains read-only and auditable. The new project points to the
old project through `supersedes_project_id`.

Dry-run validates chapter remapping, prompt-binding compatibility, and target
lineage without mutation. Clone operations use the same unique operation-ID
contract as template regeneration.

## 17. API and UI Changes

### 17.1 Template creation API

Remove:

```text
templateGeneratorRevisionId
```

Require:

```text
rhetoricTraceRevisionId
```

Validate:

- revision kind is `rhetoric-trace`;
- configuration declares `trace-ir-v2`;
- compiler and policy versions are supported.

### 17.2 Template creation UI

- remove Template Generator revision selector;
- keep Rhetoric Trace v2 selector;
- display compiler version/hash;
- display originality policy version;
- show pipeline run progress by chapter;
- show `quarantined` separately from technical failure.

### 17.3 Project creation UI

Only show templates with active clean v2 runs.

### 17.4 Legacy project UI

- retain read access;
- display read-only contamination/lineage notice;
- disable generation controls;
- link to clean replacement project when one exists.

## 18. Testing Strategy

### 18.1 Unit tests

Trace IR:

- rejects free text and unknown properties;
- rejects skipped/duplicate positions;
- rejects forward or missing dependencies;
- rejects recipe/resource incompatibility;
- rejects dependency slots not produced by referenced recipes.

Compiler:

- compiles every registered recipe;
- uses identical placeholders in `content` and `userPrompt`;
- declares every placeholder once;
- reuses dependency slots;
- assigns deterministic local slots;
- produces stable artifact hashes;
- fails unsupported recipe keys.

Source profile:

- chunks deterministically;
- generates stable hashes/fingerprints;
- rejects long distinctive-element labels;
- never stores raw chunk text;
- fails closed when embeddings/profiler fail.

Authorization:

- returns lineage only for an active clean run;
- throws a typed error for every blocked state;
- runs before provider invocation and persistence in every generation entry point;
- rejects missing or unsupported versions.

Originality policy:

- detects lexical source reuse;
- detects translated/paraphrased distinctive metaphors as suspect/contaminated;
- does not condemn unrelated generic advice;
- requires independent evidence before semantic-only contamination;
- never lets reviewer downgrade a strong signal.

Lineage:

- detects every version/hash mismatch;
- marks legacy metadata stale;
- distinguishes manual definitions.

### 18.2 Property and registry tests

For every registered recipe:

- schema-valid output;
- compiler invariants pass;
- output contains only trusted recipe text and canonical names;
- same IR produces byte-identical output;
- recipe-declared resources and dependencies match validator rules.

Tests iterate registered recipes, not the Cartesian product of enums.

### 18.3 Integration tests

- source appears in provider payload but redacted execution messages;
- Template Generator LLM is not called;
- no prompts/placeholders activate before all chapters pass;
- clean artifacts resume after retry;
- one failing chapter prevents finalization;
- contaminated downstream candidate never reaches application tables;
- every accepted downstream row has one clean assessment with matching hash;
- rejected candidates leave assessment metadata but no application row;
- unverified/quarantined template blocks every generation entry point;
- clean template permits all entry points;
- project cloning preserves old history and creates clean empty generation state.

### 18.4 Migration tests

- schema migration works on fresh database;
- migration works with existing templates/projects;
- legacy templates remain readable;
- legacy templates disappear from project creation;
- audit dry-run is read-only;
- repeated audit/regeneration commands are idempotent;
- repeated clone commands are idempotent;
- operation-ID reuse with different inputs fails;
- project clone cannot target unclean template;
- project clone never copies generated content.

### 18.5 Regression corpus

Use:

- synthetic sources with distinctive figures/metaphors;
- short legally minimal regression phrases;
- existing private local corpora only in local integration checks;
- unrelated control texts for false-positive calibration;
- cross-language paraphrase fixtures.

Do not add long copyrighted passages to test fixtures.

## 19. Acceptance Criteria

### 19.1 Prevention

- Pass 1 output contains no free-text source-derived field.
- New template creation has no creative Pass 2.
- Compiler output is deterministic and source-independent.
- Source text is redacted from new execution persistence.
- A failed or quarantined chapter prevents template activation.

### 19.2 Downstream

- Every templated exportable generation is checked against template-scoped source
  profiles; source-free generation is checked against the baseline policy and
  canonical empty profile set.
- Melting-ice and equivalent cross-language paraphrases from the investigated
  source are rejected or quarantined.
- Generic unrelated analogies remain clean.
- Contaminated sibling definitions cannot cascade.
- Policy/version changes invalidate prior AI output.

### 19.3 Legacy

- Template `091ea922-6293-45d6-936b-39c18b330649` is identified as unsafe legacy.
- Its derived projects are enumerated.
- It cannot create new projects or new generated content.
- Regeneration creates a separate clean template.
- Project remediation creates a separate clean project without deleting history.

### 19.4 Operations

- Reports contain actionable signal IDs and field paths without source passages.
- Technical failures remain distinguishable from contamination.
- All scripts support dry-run where mutation risk exists.
- All mutation scripts are idempotent.

## 20. Rollout

### Stage A: containment

- schema and run foundation;
- expanded field scan;
- fail-closed template guard;
- central generation authorization;
- legacy templates hidden from project creation.

### Stage B: safe template generation

- source profiling;
- redacted execution persistence;
- Trace IR v2;
- recipe registry/compiler;
- atomic artifacts/finalization;
- API/UI cutover.

### Stage C: downstream enforcement

- profile lookup;
- generic signal engine;
- optional leakage reviewer;
- coverage across all output stages;
- lineage-based staleness.

### Stage D: remediation

- audit dry-run;
- quarantine workflow;
- clean template regeneration;
- clean project cloning;
- incident-specific verification.

Each stage has its own implementation plan and may deploy independently after its
tests and acceptance criteria pass.

## 21. Non-Goals

- Automatically rewriting contaminated templates.
- Mutating legacy projects in place.
- Guaranteeing legal conclusions about copyright.
- Preserving source-specific creative devices.
- Supporting arbitrary free-text custom rhetoric moves in v2.
- Allowing generation without a valid source profile.
- Deleting historical data automatically.

## 22. Architecture Decision

Adopt:

- closed Trace IR;
- deterministic code-owned template compiler;
- template-scoped private source profiles;
- fail-closed downstream originality enforcement;
- immutable run/artifact lineage;
- new IDs for regenerated templates/projects;
- legacy read-only quarantine.

Reject:

- prompt-only semantic-nullity defenses;
- audit-and-rewrite of existing templates;
- LLM judge as sole gate;
- embeddings as sole proof;
- advisory contamination checks;
- destructive in-place project rebase.
