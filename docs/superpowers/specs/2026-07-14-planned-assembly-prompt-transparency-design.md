# Planned Editorial Assembly and Prompt Transparency Design

**Date:** 2026-07-14
**Status:** approved

## Goal

Replace direct fragment assembly with an explicit editorial pipeline:

```text
content fragments -> assembly planning -> chapter assembly
```

The planner decides chapter structure and editorial treatment. `Assembly Prompt v1.3` executes that plan with enough freedom to create coherent prose, while remaining bounded by the approved `EditorialBrief`, chapter contract, source fragments, and evidence.

At the same time, remove every hidden editorial instruction added by application code. Every behavioral instruction sent to an LLM must come from a visible, user-managed, immutable prompt version. Runtime code may serialize data and enforce technical or safety contracts, but may not silently add editorial prose.

## Motivation

Current assembly algorithms only determine the order in which fragments reach the model. They cannot reason explicitly about chapter architecture, redundancy, coverage, weak material, illustration density, or where synthesis is needed. The algorithm selector exposes implementation mechanics that do not express a useful editorial choice.

Current prompt execution also violates prompt transparency. Application code adds roles, style rules, scope-specific instructions, fallback prompts, retry instructions, and missing-marker content outside the prompts visible in the UI. This makes prompt behavior hard to understand and makes a named version such as `Assembly v1.2` an incomplete description of what the model actually receives.

The new pipeline treats planning as an editorial operation and prompt composition as an auditable contract.

## Approved decisions

1. Add a separate, versioned `assembly-planner` prompt type.
2. Run planning automatically after fragments and immediately before assembly. No human approval pause.
3. Store the structured plan and show it as a read-only, collapsible result.
4. Give the planner adaptive editing authority: preserve required coverage, but cut, move, merge, or demote weak and redundant material.
5. Give the assembler editorial freedom to create transitions, synthesis, openings, closings, and explanations supported by the inputs.
6. Forbid invention of facts, statistics, sources, named people, case details, or unsupported mechanisms.
7. Do not impose a numeric illustration quota. Examples, cases, analogies, and metaphors appear only when useful; several are acceptable when each serves a distinct purpose. Avoid floods of microexamples and competing metaphors.
8. Remove the assembly algorithm selector from the UI. New generations use one `planned-editorial-v1` pipeline.
9. Remove all hidden behavioral prose from runtime composition, including `STYLE_RULES`, role prefixes, scope instructions, prompt fallbacks, and retry instructions.
10. Make prompt versions immutable and capture the exact effective messages used for every LLM call.

## Current-state diagnosis

Production LLM call sites contain these hidden instruction sources:

- `lib/ai/system-prompts.ts` defines `STYLE_RULES`, injected into assembly, critique, and correction.
- `lib/generate.ts` silently falls back to an embedded generation system prompt when no database default exists.
- `lib/generate.ts` prefixes assembly, critique, and correction prompts with hardcoded roles and style instructions.
- `lib/generate.ts` appends fragments, chapter content, or critique content with hardcoded labels when required markers are missing.
- `lib/editorial-brief/render.ts` adds stage-specific assembly, critique, correction, fragment, title, and placeholder-fill instructions plus an `<authority>` instruction.
- `lib/ai/placeholder-fill.ts` contains a complete system prompt, user-message prose, priority rules, examples, output instructions, and retry instructions.
- `lib/editorial-brief/extraction-prompt.ts` and `lib/editorial-brief/extract.ts` contain the extractor system and user prompts.
- `app/api/projects/[id]/generate-title/route.ts` contains the title-generation instruction.
- `trigger/generate-template.ts` contains a fallback meta-prompt user message.
- `lib/ai/completion.ts` appends a natural-language JSON-schema suffix for structured DeepSeek calls.

Versioning is also incomplete:

- `prompt_library`, `generation_system_prompts`, and `meta_prompts` update content in place.
- Their names may contain `v1.2` or `v5`, but the database does not enforce immutable revisions.
- `prompt_versions` covers only `title`, `content`, and `userPrompt`; it does not preserve a complete content-prompt snapshot.

## Prompt transparency contract

### Behavioral prose

Every natural-language instruction that can influence model behavior must exist in a selected prompt version. Examples include role, voice, editorial priorities, evidence behavior, retry behavior, output wording, and use of supplied data.

Runtime code must not:

- prepend a role;
- append style rules;
- append a fallback task;
- invent instructions when a marker is absent;
- add stage-specific EditorialBrief interpretation rules;
- add a retry instruction not present in the selected version;
- replace a missing database prompt with embedded prose.

Missing prompt selection, missing required marker, or incompatible prompt kind fails before the provider call with a clear configuration error.

### Technical framing

Code may perform operations that are not editorial instructions:

- escape untrusted values;
- serialize fragments, plans, contracts, and research results as XML or JSON;
- substitute declared markers;
- enforce structured-output schemas;
- select provider/model parameters;
- enforce token, size, authentication, ownership, rate-limit, and timeout constraints;
- run originality and protected-source checks;
- validate model output.

These operations must be visible in the effective-prompt preview or execution metadata. Technical framing may not contain behavioral prose. For providers that need a schema in text, the prompt version declares an `{{OUTPUT_SCHEMA}}` marker; runtime inserts only the schema data. Instructions such as “return only JSON” belong to the prompt version.

Editorial length limits currently enforced in placeholder code move into prompt-version configuration. Safety and structural limits remain code-level policies and appear in execution metadata.

### Explicit data markers

No contextual data is appended implicitly. Prompt versions declare where data enters using documented markers. Core markers include:

| Marker                    | Data                                                             |
| ------------------------- | ---------------------------------------------------------------- |
| `{{EDITORIAL_CONTEXT}}`   | Data-only approved EditorialBrief and current chapter contract   |
| `{{SECCIONES_GENERADAS}}` | Serialized original fragments with stable IDs and titles         |
| `{{ASSEMBLY_PLAN}}`       | Validated `AssemblyPlanV1` JSON                                  |
| `{{CONTENIDO_CAPITULO}}`  | Chapter text being critiqued or corrected                        |
| `{{CONTENIDO_CRITICA}}`   | Critique applied by corrector                                    |
| `{{RESEARCH_RESULTS}}`    | Retrieved evidence or explicit empty result                      |
| `{{PLACEHOLDER_CONTEXT}}` | Placeholder function, notes, existing values, and prompt context |
| `{{VALIDATION_FEEDBACK}}` | Empty on first attempt; structured failure data on retry         |
| `{{RESEARCH_DOCUMENT}}`   | Escaped research source used by EditorialBrief extractor         |
| `{{CHAPTER_CONTEXT}}`     | Chapter IDs, titles, and available placeholders                  |
| `{{CAPITULO_FUENTE}}`     | Source chapter used by template meta-prompt                      |
| `{{OUTPUT_SCHEMA}}`       | Machine-generated JSON schema when text delivery is required     |

Dynamic book placeholders such as `{tema}` remain separate from double-brace runtime markers.

## Prompt version model

### Global prompt registry

Introduce a shared registry for reusable runtime prompts:

```text
prompt_definitions
  id
  kind
  name
  description
  created_by
  archived_at
  created_at

prompt_revisions
  id
  prompt_definition_id
  revision_number
  version_label
  system_template
  user_template
  required_markers
  output_contract
  configuration
  created_by
  created_at

prompt_defaults
  kind
  prompt_revision_id

project_prompt_bindings
  project_id
  kind
  prompt_revision_id
  updated_at
```

`prompt_revisions` rows are immutable. Editing creates a new revision. `revision_number` provides ordering; `version_label` supports user-facing labels such as `1.3`. A unique constraint covers `(prompt_definition_id, revision_number)` and another covers `(prompt_definition_id, version_label)`.

`prompt_defaults` has one row per globally defaulted kind. `project_prompt_bindings` has a unique key on `(project_id, kind)`. Both reference exact revisions and validate that revision kind matches binding kind. Per-run overrides also accept revision IDs and perform the same validation.

Supported `kind` values:

- `generation-system`
- `meta-template`
- `assembly-planner`
- `assembly`
- `critique`
- `corrector`
- `title`
- `placeholder-fill`
- `editorial-brief-extractor`

Defaults and project bindings reference a specific `prompt_revisions.id`, not a mutable definition. A generation therefore remains reproducible after newer revisions exist.

Existing `generation_system_prompts`, `meta_prompts`, and `prompt_library` rows migrate into definitions and initial revisions. Compatibility reads may remain temporarily, but all new runtime execution uses the registry.

Creating a revision never changes a default or project binding automatically. User explicitly selects the new revision. Referenced revisions cannot be deleted; definitions can be archived without affecting historical execution.

### Chapter content prompts

Chapter content prompts remain attached to chapters because position, function, notes, source context, and placeholder relationships are domain data. Their revision system is expanded to preserve a complete immutable snapshot:

- title;
- system and user content;
- position;
- role flags;
- function;
- notes;
- source context.

Each prompt points to its current revision. Fragment generation records that exact revision ID. Existing incomplete versions remain readable and receive a legacy marker.

## Data-only EditorialBrief rendering

`renderEditorialScope()` stops emitting behavioral instructions. It serializes only approved project data:

- requested global EditorialBrief sections;
- current chapter contract when applicable;
- brief version and hash;
- bound evidence identifiers and research basis when applicable.

Remove:

- `<authority>`;
- `<assembly_instructions>`;
- `<adherence_rubric>`;
- `<correction_instructions>`;
- `<fragment_instructions>`;
- `<title_instructions>`;
- `<placeholder_fill_instructions>`.

Stage projections may remain as documented data minimization, but they cannot carry instructions. The exact serialized context appears in effective-prompt inspection.

`mustCover` remains user-approved contract data. Planner and assembly prompt revisions define how to apply it. No code-level sentence interprets it.

## Planned editorial pipeline

### State transition

```text
pending -> generating -> planning -> assembling -> completed
                                      \-> failed
                         \-> failed
```

After all content fragments complete:

1. Resolve the selected `assembly-planner` revision.
2. Compose its declared markers with fragments and data-only editorial context.
3. Generate and validate `AssemblyPlanV1`.
4. Persist the plan and planner execution snapshot.
5. Resolve selected `assembly` revision `1.3`.
6. Supply the validated plan, original fragments, and same editorial context.
7. Generate the chapter and persist the assembly execution snapshot.

Planning is automatic. User sees progress but does not approve plan between stages.

### Planner resolution

Selection precedence:

1. explicit per-run planner revision;
2. project planner revision;
3. global default planner revision.

Assembly uses equivalent precedence. A missing default or invalid revision fails explicitly. No legacy algorithm fallback occurs.

### Stored plan

`chapter_generations` stores:

- `assemblyPlan` JSONB;
- `plannerPromptRevisionId`;
- `assemblyPromptRevisionId`;
- planning model/provider, usage, duration, and completion timestamp;
- pipeline identifier `planned-editorial-v1`.

The generic prompt-execution record stores exact messages and data manifests for both calls.

## `AssemblyPlanV1` contract

The planner emits structured JSON, validated before assembly:

```ts
interface AssemblyPlanV1 {
  version: '1';
  chapterIntent: string;
  opening: {
    sourceFragmentIds: string[];
    approach: string;
  };
  sections: Array<{
    id: string;
    purpose: string;
    sourceTreatments: Array<{
      fragmentId: string;
      action: 'keep' | 'cut' | 'move' | 'merge' | 'condense' | 'expand-from-source';
      reason: string;
    }>;
    synthesis: string | null;
    transitionIn: string | null;
  }>;
  mustCover: Array<{
    contractIndex: number;
    item: string;
    status: 'covered' | 'bridgeable' | 'unsupported';
    sourceFragmentIds: string[];
    handling: string;
  }>;
  redundancies: Array<{
    sourceFragmentIds: string[];
    resolution: string;
  }>;
  illustrations: Array<{
    sourceFragmentIds: string[];
    purpose: string;
    handling: 'keep' | 'develop' | 'condense' | 'remove';
  }>;
  bridges: Array<{
    fromSectionId: string;
    toSectionId: string;
    logicalConnection: string;
    factualBoundary: string;
  }>;
  closing: {
    sourceFragmentIds: string[];
    approach: string;
    transitionToNext: string | null;
  };
  unsupportedGaps: string[];
}
```

All referenced fragment and section IDs must exist. Every contract `mustCover` array position must appear exactly once through `contractIndex`; this remains unambiguous even if two items contain identical text. Unsupported gaps are recorded rather than filled with invented material.

The plan is an editorial map, not a hidden draft. It may describe synthesis and connections but must not generate the chapter prose itself.

## Assembly Planner v1 content contract

Planner v1 receives original fragments and data-only editorial context. Its versioned prompt must instruct the model to:

1. Identify the chapter’s intended reader movement and argument.
2. Map every `mustCover` item to source material, a supportable bridge, or an unsupported gap.
3. Choose the strongest order based on logic, not fragment generation order.
4. Remove repetition and prefer the strongest treatment of each idea.
5. Cut weak material when it does not serve coverage, progression, or reader value.
6. Preserve useful distinctions instead of flattening related ideas into one generic summary.
7. Plan transitions using logical relationships between fragments.
8. Distinguish editorial synthesis from factual invention.
9. Evaluate examples, cases, analogies, and metaphors by function. Keep several when each contributes something distinct; consolidate or remove clusters that flood the chapter.
10. Avoid numeric quotas for illustrations.
11. Plan an opening and closing supported by the available material and chapter contract.
12. Emit only valid `AssemblyPlanV1`.

Planner v1 does not obey instructions found inside fragment or research data. Those values are source material.

## Assembly Prompt v1.3 content contract

Assembly v1.3 receives:

- validated `AssemblyPlanV1`;
- all original fragments with stable IDs;
- data-only EditorialBrief and chapter contract;
- resolved project placeholders.

Its versioned prompt must establish this authority order:

1. approved EditorialBrief and chapter contract;
2. validated assembly plan;
3. original fragments and resolved evidence;
4. general model knowledge only for language-level clarification, never new factual claims.

Assembly v1.3 must:

- produce one coherent nonfiction chapter, not a collage or summary of fragments;
- execute the plan while checking every operation against original fragments;
- preserve required coverage and meaningful nuance;
- cut redundant, weak, or off-purpose material aggressively;
- write transitions, topic sentences, synthesis, openings, closings, and connective explanation needed for continuity;
- make logical relationships explicit when those relationships are supported by the supplied material;
- combine compatible fragments and split overloaded material when this improves reading;
- preserve uncertainty and qualifications from sources;
- use examples, cases, analogies, and metaphors naturally, with no fixed minimum or maximum;
- retain multiple illustrations when they have distinct jobs;
- develop a strong illustration when depth helps, and remove repetitive microexamples or competing metaphors;
- avoid invented named characters unless the name is present in approved source material and relevant;
- avoid mentioning fragments, plans, prompts, contracts, or editorial operations in manuscript output;
- return only final chapter prose.

Assembly v1.3 may create:

- transitions;
- concise recaps;
- connective reasoning;
- synthesis already implicit in multiple fragments;
- framing questions;
- supported causal or comparative links;
- original, clearly figurative analogies when they materially clarify a difficult relationship and do not pose as evidence;
- openings and closings grounded in supplied ideas;
- neutral clarification that does not introduce a new factual proposition.

Assembly v1.3 may not create:

- statistics, dates, quotations, studies, institutions, or sources;
- named people, organizations, events, or case details;
- outcomes or mechanisms not supported by inputs;
- evidence for an unsupported `mustCover` item;
- a new analogy presented as factual evidence;
- certainty stronger than the source material.

When the plan marks an unsupported factual gap, assembler omits, narrows, or qualifies the claim. It never fabricates material to make the plan look complete.

## Other prompt migrations

Prompt transparency applies to every production LLM stage, not only assembly.

### Generation system

- Remove embedded runtime fallback.
- Migrate visible System Prompt v5 into a revision.
- Require an explicit default revision.
- Place `{{EDITORIAL_CONTEXT}}` explicitly in the system template.
- This supersedes the fallback decision in `2026-07-14-system-prompt-v5-design.md`; DB revision is now sole behavioral source.

### Critique and correction

- Remove hardcoded role prefixes and `STYLE_RULES`.
- Remove missing-marker append fallbacks.
- Require explicit chapter, critique, and editorial-context markers.
- Keep their behavior entirely in selected revisions.

### Title

- Add versioned `title` kind.
- Migrate current title task into a visible initial revision.
- Require project topic, editorial context, and output schema markers.

### Placeholder fill

- Move system instructions, data-section wording, priority rules, examples, empty-research behavior, and retry behavior into a visible revision.
- Use one revision for first attempt and retry. `{{VALIDATION_FEEDBACK}}` is empty initially and contains structured failure data on retry.
- Remove hardcoded factual/narrative word ceilings. Any desired length policy belongs to prompt configuration and placeholder notes.
- Retain structural validation, originality checks, and required-evidence failures as visible technical policies.

### EditorialBrief extractor

- Add versioned `editorial-brief-extractor` kind.
- Move both system and user instructions into its revision.
- Preserve XML escaping, output schema validation, exact chapter-ID coverage, and evidence-placeholder validation in code.

### Meta-template

- Remove fallback user prose.
- Require system and user templates in every selected revision.
- Keep structured template output schema as a technical contract.

## Execution transparency

Add a generic execution record for every production LLM call:

```text
llm_prompt_executions
  id
  project_id
  chapter_id
  chapter_generation_id
  stage
  prompt_revision_id
  chapter_prompt_revision_id
  model
  provider
  messages
  data_manifest
  output_contract
  technical_policies
  provider_payload_manifest
  created_at
```

`messages` stores the ordered system/user content blocks after marker replacement, including Anthropic cached-system block separation. `provider_payload_manifest` records non-secret provider-native framing such as structured-output mode and schema identity. Together they represent the exact semantic input delivered to the provider without pretending all providers use the same wire format. No provider adapter may add undeclared natural-language instructions. `data_manifest` records marker names, source entity IDs, versions, hashes, and sizes. None of these fields may contain API keys or provider credentials.

Owner/admin authorization protects inspection. Existing project authorization rules apply. Prompt execution data follows project deletion and retention behavior.

UI provides “Ver prompt efectivo” from generation, plan, assembly, critique, correction, title, placeholder, extractor, and template-generation results. It shows:

- prompt name and immutable version;
- exact system message;
- exact user message;
- model and provider;
- technical schema/policies;
- timestamp.

## UI changes

### Prompt administration

Replace category-only prompt CRUD with prompt definitions and immutable revisions:

- tabs by prompt kind;
- definition list;
- revision history;
- create revision action;
- compare revisions;
- default revision selection where supported;
- required-marker validation before save;
- no in-place content overwrite.

Add `Planner` tab for `assembly-planner` prompts. Assembly remains a separate tab.

### Project configuration

Project settings expose selected revisions for:

- generation system;
- assembly planner;
- assembly;
- critique/corrector where currently assignable.

Per-run planner and assembly overrides remain possible through generation controls/API. UI defaults to project selection.

### Chapter generation

- Remove merge-sort/sequential/halves selector.
- Show stages: Generating fragments, Planning chapter, Assembling chapter.
- Add collapsed “Assembly plan” panel after planning succeeds.
- Add “Effective prompt” inspection for planner and assembly.
- Existing historical generations continue to display their legacy algorithm metadata.

## Legacy algorithm disposition

New generations cannot select `merge-sort`, `sequential`, or `halves`. Runtime uses `planned-editorial-v1` only.

Legacy algorithm functions remain temporarily isolated for reading historical results and controlled rollback during validation. They are not exposed in normal UI and receive no new feature work. Remove them after planned pipeline validation and data-retention review.

There is no automatic fallback from planning failure to a legacy algorithm. Such fallback would silently change editorial behavior.

## Migration strategy

1. Create prompt registry, revisions, defaults/bindings, complete content-prompt revisions, execution records, planner selection, and assembly-plan storage.
2. Migrate existing visible system, meta, assembly, critique, and corrector records into immutable revisions.
3. Seed visible initial revisions for title, placeholder fill, and EditorialBrief extraction from current hardcoded behavior.
4. Seed `Assembly Planner v1` and `Assembly Prompt v1.3` as visible revisions.
5. Create complete current revisions for existing chapter content prompts.
6. Preserve existing IDs through a migration mapping table or compatibility columns until all bindings are converted.
7. Switch reads to version IDs and fail closed when configuration is missing.
8. Remove hidden prose injection and legacy marker fallbacks.
9. Remove algorithm selection from new-generation UI/API.
10. Retain old tables read-only during a bounded compatibility window, then remove after verification.

Migrations are additive first. No existing prompt or generation history is deleted.

## Failure behavior

Configuration errors fail before provider call and name the missing item:

- no selected/default prompt revision;
- wrong prompt kind;
- missing required marker;
- unknown marker;
- invalid or stale fragment ID in plan;
- incomplete `mustCover` mapping;
- invalid output schema;
- unavailable chapter content revision.

Planner schema failure uses normal task retry with the same exact revision and recorded attempt. It never adds hidden retry prose. If a retry needs feedback, that feedback enters through a declared marker already present in the revision.

Assembly failure leaves the validated plan stored for diagnosis. User can inspect plan and effective prompts before retrying.

## Testing

Implementation follows TDD.

### Prompt transparency

1. Static test inventories every production provider call and requires use of the central prompt composer.
2. Test rejects runtime natural-language prefixes/suffixes outside selected prompt revisions.
3. Test no runtime import of `STYLE_RULES` or embedded generation fallback remains.
4. Test every kind enforces its required markers.
5. Test missing markers and defaults fail before provider call.
6. Test effective messages equal prompt templates plus declared marker substitutions, byte for byte.
7. Test DeepSeek structured output adds no undeclared natural-language suffix.

### Versioning

1. Editing creates an immutable revision rather than overwriting content.
2. Project and run bindings resolve exact revision IDs.
3. Historical executions retain original revision and effective messages.
4. Content-prompt revisions preserve all behavioral and contextual fields.
5. Migration creates revisions for every active legacy prompt without deleting rows.

### Editorial context

1. Renderer emits data fields, version, and hash only.
2. Renderer contains no authority, rubric, rule, or stage-instruction blocks.
3. `mustCover` values survive unchanged.
4. Stage projections remain deterministic and visible.

### Planner

1. Schema rejects unknown fragment IDs and duplicate/missing `mustCover` items.
2. Planner call receives original fragments and current EditorialBrief contract.
3. Valid plan persists before assembly begins.
4. Planning failure never invokes legacy algorithms.
5. Automatic state transitions and retries are idempotent.

### Assembly

1. Assembly receives plan, original fragments, and same EditorialBrief version.
2. Prompt v1.3 contains approved editing freedom and factual ceiling.
3. Prompt has no numeric illustration quota and rejects illustration flooding by purpose, not count.
4. Output contains chapter prose only.
5. Originality and structural validation still run and appear in technical policy metadata.

### UI and API

1. Algorithm selector is absent for new runs.
2. Planner CRUD/revision UI validates required markers.
3. Plan panel renders persisted plan.
4. Effective-prompt view enforces owner/admin access.
5. Existing legacy generations remain readable.

Run focused tests, full Vitest suite, typecheck, lint, and production build before completion.

## Non-goals

- Human approval between planning and assembly.
- User-editable provider authentication, rate limits, escaping, or authorization.
- Turning deterministic safety checks into prompt prose.
- Rewriting existing historical generation outputs.
- Continuing multiple user-selectable assembly algorithms.
- Book-level orchestration beyond the existing per-chapter pipeline.
- Subjective guarantee that every generated chapter is good; prompt transparency and stored plans make quality diagnosable and iteratively improvable.

## Success criteria

- Every production LLM call identifies an immutable user-visible prompt revision.
- Exact system and user messages sent to the model can be inspected after execution.
- No application code injects hidden editorial prose.
- No silent prompt, marker, system-prompt, retry, or algorithm fallback remains.
- EditorialBrief rendering is data-only.
- New chapter generation follows fragments -> planning -> assembly.
- Planner produces valid, persisted `AssemblyPlanV1` before assembly.
- Assembly v1.3 can create strong connective prose without inventing unsupported factual content.
- Examples, cases, analogies, and metaphors appear according to editorial need rather than a fixed quota.
- Merge-sort, sequential, and halves disappear from normal generation UI.
- Existing prompt and generation history remains readable throughout migration.
