# Template Generation Pipeline — Two-Pass Redesign

**Date**: 2026-07-15
**Status**: approved

## Problem

Current single-pass `meta-template` prompt produces template blocks that leak the source book's thesis. Content like _"Explica el concepto de acumulación compuesta aplicado a la mejora personal..."_ paraphrases James Clear's propositions instead of producing a semantic vacuum. Root cause: the prompt operates at "function vs instance" level and instructs the LLM to preserve "argumentative progression", which induces proposition retention even after stripping proper nouns and figures.

## Solution

Two LLM passes per chapter instead of one:

1. **Pass 1 — Rhetoric trace extractor**: identifies rhetorical moves in the source chapter, producing an abstract sequence of operations with descriptions and intended reader effects. No content — only structural labels.

2. **Pass 2 — Template generator**: receives the rhetoric trace + full source chapter, produces template blocks with full semantic nullity. All source propositions become placeholders. `userPrompt` is now mandatory.

## Architecture

### New `prompt_definitions` kinds

| Kind                 | Required Markers                                                 | Purpose                                                                 |
| -------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `rhetoric-trace`     | `{{CAPITULO_FUENTE}}`, `{{OUTPUT_SCHEMA}}`                       | Pass 1: extract rhetorical trace from source chapter                    |
| `template-generator` | `{{RHETORIC_TRACE}}`, `{{CAPITULO_FUENTE}}`, `{{OUTPUT_SCHEMA}}` | Pass 2: generate template blocks from trace + source                    |
| `meta-template`      | N/A                                                              | **Archived** (`archivedAt` set, revisions marked `legacyNonExecutable`) |

Rationale for separate kinds (option B): clean semantic separation, impossible to mix 1-pass revisions with 2-pass code, no changes to `executor.ts` or `repository.ts`.

### Pass 1 schema — `rhetoricTraceOutputSchema`

```ts
const traceEntrySchema = z.object({
  operation: z.string(), // Functional label: CASO_DE_EXITO, PRINCIPIO_MATEMATICO, ...
  position: z.number(), // Sequential order starting at 0
  description: z.string(), // What this move does, in abstract structural terms
  effectOnReader: z.string(), // Intended effect: spark curiosity, refute objection, motivate...
});

const rhetoricTraceOutputSchema = z.object({
  trace: z.array(traceEntrySchema),
  assemblyNotes: z.string(), // Global notes: dependencies, overall arc, transitions
});
```

`description` and `effectOnReader` follow the same semantic nullity rules as pass 2 output — no source content, only abstract structure. `inputRegions` deliberately excluded: pass 2 already receives the full source chapter via `{{CAPITULO_FUENTE}}`. Duplicating fragments would increase leak risk and token cost.

### Pass 2 schema — `templateGeneratorOutputSchema`

```ts
const placeholderSchema = z.object({
  name: z.string(),
  function: z.string(),
  notes: z.string(),
});

const templateBlockSchema = z.object({
  name: z.string(),
  function: z.string(),
  content: z.string(), // LLM instructions — semantic vacuum
  userPrompt: z.string(), // NEW: mandatory writer-facing instructions
  sourceContext: z.string(),
  placeholders: z.array(placeholderSchema),
  notes: z.string(),
});

const templateGeneratorOutputSchema = z.object({
  templates: z.array(templateBlockSchema),
});
```

**`userPrompt` is mandatory.** Rationale: even simple transitions benefit from writer guidance. The LLM receives `content` as system message and `userPrompt` as user message — having both gives better adherence.

**Same placeholders rule:** `content` and `userPrompt` must contain exactly the same set of `{placeholders}`. The system resolves each placeholder once. Divergent sets would cause undefined variables.

### Task payload change

```ts
// OLD
{ templateId, metaPromptRevisionId, chapters, model?, effort? }

// NEW
{ templateId, rhetoricTraceRevisionId, templateGeneratorRevisionId, chapters, model?, effort? }
```

### Per-chapter generation loop

```
for each chapter (concurrency 3):
  1. executeVersionedPrompt(kind='rhetoric-trace', schema=rhetoricTraceOutputSchema)
     → traceResult.data: { trace: [...], assemblyNotes }
  2. executeVersionedPrompt(kind='template-generator', schema=templateGeneratorOutputSchema)
     → templateResult.data: { templates: [...] }
  3. Insert template blocks into `prompts` table (with userPrompt)
  4. Upsert chapter placeholders
```

### DB insertion

One line added to the existing transaction:

```ts
await tx.insert(prompts).values({
  // ... existing fields ...
  userPrompt: block.userPrompt, // NEW
});
```

`writeCurrentChapterPromptRevision` already captures `userPrompt` via `snapshotChapterPrompt` — no changes needed.

### API route

`POST /api/books/auto`:

- `metaPromptRevisionId` → removed from validation and trigger call
- `rhetoricTraceRevisionId` + `templateGeneratorRevisionId` → both required, validated as non-empty strings

### Migration strategy

- **Existing templates** (`status: "ready"`): left as-is. Legacy `prompts.user_prompt` = NULL is valid. New pipeline applies to new templates only.
- **`meta-template` definition**: archived (`archivedAt` set), NOT deleted. Preserves referential integrity for historical `llm_prompt_executions` rows.
- **`user_prompt` column**: already exists as nullable — no schema migration needed.

### Files changed

| File                               | Change                                                                                              |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| `lib/db/schema/prompt-registry.ts` | Add `'rhetoric-trace'` and `'template-generator'` to `promptKindValues`                             |
| `lib/prompts/contracts.ts`         | Add required markers for both new kinds                                                             |
| `trigger/generate-template.ts`     | Two schemas, two `executeVersionedPrompt` calls per chapter, `userPrompt` in insert, payload change |
| `app/api/books/auto/route.ts`      | Payload validation: `rhetoricTraceRevisionId` + `templateGeneratorRevisionId`                       |

### Files NOT changed

`executor.ts`, `repository.ts`, `composer.ts`, `chapter-revisions.ts`, `placeholder-transform.ts`, `prompt-versions.ts` — all already generic and reusable.

### System templates

Written by user (admin). Both `rhetoric-trace` and `template-generator` revisions are created via the existing prompt revision API/UI. The `template-generator` system template must enforce:

1. Semantic nullity: every source proposition becomes a placeholder
2. Content contains only writing verbs + placeholders
3. Same placeholders rule: `content` and `userPrompt` must use identical sets
4. `userPrompt` is writer-facing (concrete guidance), `content` is LLM-facing (structural instructions)
