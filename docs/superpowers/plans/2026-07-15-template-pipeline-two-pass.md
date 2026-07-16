# Template Generation Pipeline — Two-Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace single-pass `meta-template` prompt with two LLM passes per chapter (rhetoric trace extraction → template generation) and make `userPrompt` mandatory in template blocks.

**Architecture:** Two new `prompt_definitions` kinds (`rhetoric-trace`, `template-generator`) replace the archived `meta-template`. Per-chapter loop calls `executeVersionedPrompt` twice sequentially — first with `rhetoric-trace` kind, second with `template-generator` kind. No changes to executor, repository, composer, or revision infrastructure.

**Tech Stack:** Next.js 15, Trigger.dev, Drizzle ORM, Zod, Vitest

## Global Constraints

- `executeVersionedPrompt`, `resolvePromptRevision`, `composePrompt`, `writeCurrentChapterPromptRevision`, `snapshotChapterPrompt` — NOT modified
- `userPrompt` is mandatory in all new template blocks
- Per-chapter — trace extraction runs once per chapter, not once per book
- Legacy `meta-template` kind: `archivedAt` set on definition, NOT deleted
- Existing templates (`status: "ready"`) left as-is; `prompts.user_prompt` = NULL is valid
- All tests pass after each task
- Conventional Commits

---

## File Structure

| File                                          | Role             | Change                                           |
| --------------------------------------------- | ---------------- | ------------------------------------------------ |
| `lib/db/schema/prompt-registry.ts`            | Kind enum        | Add 2 values                                     |
| `lib/prompts/contracts.ts`                    | Marker contracts | Add 2 entries, remove 1                          |
| `trigger/generate-template.ts`                | Core task        | Major: schemas, two-pass loop, userPrompt insert |
| `app/api/books/auto/route.ts`                 | API entry point  | Payload fields                                   |
| `trigger/__tests__/generate-template.test.ts` | Tests            | Update mocks, payload, assertions                |

---

### Task 1: Add new `prompt_definitions` kinds

**Files:**

- Modify: `lib/db/schema/prompt-registry.ts`

**Interfaces:**

- Produces: `PromptKind` union now includes `'rhetoric-trace'` and `'template-generator'`

- [ ] **Step 1: Add kind values**

In `lib/db/schema/prompt-registry.ts`, add `'rhetoric-trace'` and `'template-generator'` to `promptKindValues`:

```ts
export const promptKindValues = [
  'generation-system',
  'meta-template',
  'assembly-planner',
  'assembly',
  'critique',
  'corrector',
  'title',
  'placeholder-fill',
  'editorial-brief-extractor',
  'rhetoric-trace', // NEW
  'template-generator', // NEW
] as const;
```

Note: `meta-template` stays in the array for now (archival is a DB operation, not a code change). The kind still exists in code so historical references resolve — the definition's `archivedAt` flag handles rejection at runtime via `resolvePromptRevision`.

- [ ] **Step 2: Typecheck**

Run: `rtk pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
rtk git add lib/db/schema/prompt-registry.ts
rtk git commit -m "feat: add rhetoric-trace and template-generator prompt kinds"
```

---

### Task 2: Add required markers for new kinds

**Files:**

- Modify: `lib/prompts/contracts.ts`

**Interfaces:**

- Consumes: `PromptKind` from Task 1 (now includes `'rhetoric-trace'`, `'template-generator'`)
- Produces: `requiredMarkersByKind` includes both new kinds

- [ ] **Step 1: Add marker entries, remove meta-template**

In `lib/prompts/contracts.ts`, replace the `'meta-template'` entry in `requiredMarkersByKind` with the two new kinds:

```ts
export const requiredMarkersByKind: Record<PromptKind, readonly string[]> = {
  'generation-system': ['{{EDITORIAL_CONTEXT}}'],
  'rhetoric-trace': ['{{CAPITULO_FUENTE}}', '{{OUTPUT_SCHEMA}}'],
  'template-generator': ['{{RHETORIC_TRACE}}', '{{CAPITULO_FUENTE}}', '{{OUTPUT_SCHEMA}}'],
  'assembly-planner': ['{{EDITORIAL_CONTEXT}}', '{{SECCIONES_GENERADAS}}', '{{OUTPUT_SCHEMA}}'],
  assembly: ['{{EDITORIAL_CONTEXT}}', '{{ASSEMBLY_PLAN}}', '{{SECCIONES_GENERADAS}}'],
  critique: ['{{EDITORIAL_CONTEXT}}', '{{CONTENIDO_CAPITULO}}'],
  corrector: ['{{EDITORIAL_CONTEXT}}', '{{CONTENIDO_CAPITULO}}', '{{CONTENIDO_CRITICA}}'],
  title: ['{{EDITORIAL_CONTEXT}}', '{{PROJECT_TOPIC}}', '{{OUTPUT_SCHEMA}}'],
  'placeholder-fill': [
    '{{EDITORIAL_CONTEXT}}',
    '{{PLACEHOLDER_CONTEXT}}',
    '{{RESEARCH_RESULTS}}',
    '{{VALIDATION_FEEDBACK}}',
    '{{OUTPUT_SCHEMA}}',
  ],
  'editorial-brief-extractor': [
    '{{PROJECT_TOPIC}}',
    '{{CHAPTER_CONTEXT}}',
    '{{RESEARCH_DOCUMENT}}',
    '{{OUTPUT_SCHEMA}}',
  ],
};
```

The old `'meta-template'` entry is removed. `{{RHETORIC_TRACE}}` is a new marker — the composer will inject the JSON-serialized trace output at this position.

- [ ] **Step 2: Typecheck**

Run: `rtk pnpm typecheck`
Expected: PASS (TypeScript should enforce that all PromptKind values have entries)

- [ ] **Step 3: Commit**

```bash
rtk git add lib/prompts/contracts.ts
rtk git commit -m "feat: add required markers for rhetoric-trace and template-generator kinds"
```

---

### Task 3: Rewrite `generate-template` task with two-pass pipeline

**Files:**

- Modify: `trigger/generate-template.ts`

**Interfaces:**

- Consumes:
  - `PromptKind` from Task 1
  - `requiredMarkersByKind` from Task 2
  - `executeVersionedPrompt` from `lib/prompts/executor.ts` (unchanged)
- Produces:
  - `generateTemplate` task with new payload type
  - `rhetoricTraceOutputSchema` Zod schema
  - `templateGeneratorOutputSchema` Zod schema (extends old schema with `userPrompt`)

- [ ] **Step 1: Replace schemas and payload type**

Replace lines 15-40 in `trigger/generate-template.ts`. The old `placeholderSchema`, `templateBlockSchema`, `metaPromptOutputSchema` and `ChapterPayload` interface are replaced:

```ts
// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

// Pass 1: rhetoric trace
const traceEntrySchema = z.object({
  operation: z.string(),
  position: z.number(),
  description: z.string(),
  effectOnReader: z.string(),
});

const rhetoricTraceOutputSchema = z.object({
  trace: z.array(traceEntrySchema),
  assemblyNotes: z.string(),
});

// Pass 2: template blocks (extended — userPrompt is mandatory)
const placeholderSchema = z.object({
  name: z.string(),
  function: z.string(),
  notes: z.string(),
});

const templateBlockSchema = z.object({
  name: z.string(),
  function: z.string(),
  content: z.string(),
  userPrompt: z.string(),
  sourceContext: z.string(),
  placeholders: z.array(placeholderSchema),
  notes: z.string(),
});

const templateGeneratorOutputSchema = z.object({
  templates: z.array(templateBlockSchema),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChapterPayload {
  chapterId: string;
  title: string;
  contentMd: string;
  position: number;
}
```

- [ ] **Step 2: Update payload type in task definition**

Replace the payload parameter (lines 50-56). Old:

```ts
run: async (payload: {
  templateId: string;
  metaPromptRevisionId: string;
  chapters: ChapterPayload[];
  model?: string;
  effort?: ReasoningEffort;
}) => {
  const { templateId, metaPromptRevisionId, chapters, model = DEFAULT_GENERATION_MODEL, effort } = payload;
```

New:

```ts
run: async (payload: {
  templateId: string;
  rhetoricTraceRevisionId: string;
  templateGeneratorRevisionId: string;
  chapters: ChapterPayload[];
  model?: string;
  effort?: ReasoningEffort;
}) => {
  const { templateId, rhetoricTraceRevisionId, templateGeneratorRevisionId, chapters, model = DEFAULT_GENERATION_MODEL, effort } = payload;
```

- [ ] **Step 3: Replace the OUTPUT_SCHEMA computation and per-chapter loop**

Replace lines 81-112 (the `outputSchemaStr` computation and the `runSettledWithConcurrency` callback body).

Old code (lines 81-112):

```ts
const outputSchemaStr = JSON.stringify(
  zodToJsonSchema(metaPromptOutputSchema, { target: 'openApi3', $refStrategy: 'none' }),
  null,
  2,
);

// Process chapters concurrently (3 at a time) to avoid sequential timeout.
const TEMPLATE_CONCURRENCY = 3;
const results = await runSettledWithConcurrency(
  chapters,
  TEMPLATE_CONCURRENCY,
  async (chapter) => {
    const capituloFuente = serializePromptText(`# ${chapter.title}\n\n${chapter.contentMd}`);

    const { result } = await executeVersionedPrompt({
      stage: 'template-generation',
      kind: 'meta-template',
      revisionId: metaPromptRevisionId,
      bookTemplateId: templateId,
      chapterId: chapter.chapterId,
      markerValues: {
        '{{CAPITULO_FUENTE}}': capituloFuente,
        '{{OUTPUT_SCHEMA}}': outputSchemaStr,
      },
      model,
      schema: metaPromptOutputSchema,
      ...(effort ? { effort } : {}),
    });

    const blocks = result.data.templates;
```

New code (replaces the same range):

```ts
// Serialize output schemas for marker injection. The two passes use
// different schemas, so compute both JSON strings before the loop.
const rhetoricTraceSchemaStr = JSON.stringify(
  zodToJsonSchema(rhetoricTraceOutputSchema, { target: 'openApi3', $refStrategy: 'none' }),
  null,
  2,
);
const templateGeneratorSchemaStr = JSON.stringify(
  zodToJsonSchema(templateGeneratorOutputSchema, { target: 'openApi3', $refStrategy: 'none' }),
  null,
  2,
);

// Process chapters concurrently (3 at a time) to avoid sequential timeout.
// Each chapter runs two LLM calls in sequence: trace extraction → template generation.
const TEMPLATE_CONCURRENCY = 3;
const results = await runSettledWithConcurrency(
  chapters,
  TEMPLATE_CONCURRENCY,
  async (chapter) => {
    const capituloFuente = serializePromptText(`# ${chapter.title}\n\n${chapter.contentMd}`);

    // ---- Pass 1: Extract rhetoric trace ----
    const { result: traceResult } = await executeVersionedPrompt({
      stage: 'template-generation',
      kind: 'rhetoric-trace',
      revisionId: rhetoricTraceRevisionId,
      bookTemplateId: templateId,
      chapterId: chapter.chapterId,
      markerValues: {
        '{{CAPITULO_FUENTE}}': capituloFuente,
        '{{OUTPUT_SCHEMA}}': rhetoricTraceSchemaStr,
      },
      model,
      schema: rhetoricTraceOutputSchema,
      ...(effort ? { effort } : {}),
    });

    // ---- Pass 2: Generate template blocks from trace ----
    const { result: templateResult } = await executeVersionedPrompt({
      stage: 'template-generation',
      kind: 'template-generator',
      revisionId: templateGeneratorRevisionId,
      bookTemplateId: templateId,
      chapterId: chapter.chapterId,
      markerValues: {
        '{{RHETORIC_TRACE}}': JSON.stringify(traceResult.data),
        '{{CAPITULO_FUENTE}}': capituloFuente,
        '{{OUTPUT_SCHEMA}}': templateGeneratorSchemaStr,
      },
      model,
      schema: templateGeneratorOutputSchema,
      ...(effort ? { effort } : {}),
    });

    const blocks = templateResult.data.templates;
```

- [ ] **Step 4: Add `userPrompt` to the insert**

Replace the `tx.insert(prompts).values({...})` block (lines 156-165) to include `userPrompt`:

Old:

```ts
const [inserted] = await tx
  .insert(prompts)
  .values({
    chapterId: chapter.chapterId,
    position: i,
    isAssembly: false,
    title: block.name,
    content: block.content,
    function: block.function,
    notes: block.notes,
    sourceContext: (block.sourceContext?.slice(0, 300) || null) as string | null,
  })
  .returning({ id: prompts.id });
```

New:

```ts
const [inserted] = await tx
  .insert(prompts)
  .values({
    chapterId: chapter.chapterId,
    position: i,
    isAssembly: false,
    title: block.name,
    content: block.content,
    userPrompt: block.userPrompt,
    function: block.function,
    notes: block.notes,
    sourceContext: (block.sourceContext?.slice(0, 300) || null) as string | null,
  })
  .returning({ id: prompts.id });
```

- [ ] **Step 5: Remove the `outputSchemaStr` variable reference in the schema comment**

The old code has a comment at line 81 `// Serialize the output schema for the {{OUTPUT_SCHEMA}} marker — same value`. This is already replaced by the new code in Step 3 which has its own comment.

- [ ] **Step 6: Typecheck**

Run: `rtk pnpm typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
rtk git add trigger/generate-template.ts
rtk git commit -m "feat: two-pass template generation with rhetoric trace and mandatory userPrompt"
```

---

### Task 4: Update API route payload

**Files:**

- Modify: `app/api/books/auto/route.ts`

**Interfaces:**

- Consumes: `generateTemplate` from Task 3 (new payload type)
- Produces: validated POST body with new fields

- [ ] **Step 1: Replace payload destructuring and validation**

In `app/api/books/auto/route.ts`, replace lines 20-27.

Old:

```ts
const { name, description, metaPromptRevisionId, chapters: chapterList, model, effort } = body;

if (!name || typeof name !== 'string' || name.length < 1 || name.length > 200) {
  return NextResponse.json({ error: 'name must be 1-200 characters' }, { status: 400 });
}
if (!metaPromptRevisionId || typeof metaPromptRevisionId !== 'string') {
  return NextResponse.json({ error: 'metaPromptRevisionId is required' }, { status: 400 });
}
```

New:

```ts
const {
  name,
  description,
  rhetoricTraceRevisionId,
  templateGeneratorRevisionId,
  chapters: chapterList,
  model,
  effort,
} = body;

if (!name || typeof name !== 'string' || name.length < 1 || name.length > 200) {
  return NextResponse.json({ error: 'name must be 1-200 characters' }, { status: 400 });
}
if (!rhetoricTraceRevisionId || typeof rhetoricTraceRevisionId !== 'string') {
  return NextResponse.json({ error: 'rhetoricTraceRevisionId is required' }, { status: 400 });
}
if (!templateGeneratorRevisionId || typeof templateGeneratorRevisionId !== 'string') {
  return NextResponse.json({ error: 'templateGeneratorRevisionId is required' }, { status: 400 });
}
```

- [ ] **Step 2: Replace trigger call payload**

Replace lines 80-86.

Old:

```ts
await generateTemplate.trigger({
  templateId: template.template.id,
  metaPromptRevisionId,
  chapters: chapterPayloads,
  ...(model ? { model } : {}),
  ...(effort ? { effort } : {}),
});
```

New:

```ts
await generateTemplate.trigger({
  templateId: template.template.id,
  rhetoricTraceRevisionId,
  templateGeneratorRevisionId,
  chapters: chapterPayloads,
  ...(model ? { model } : {}),
  ...(effort ? { effort } : {}),
});
```

- [ ] **Step 3: Replace audit log metadata reference**

Replace line 95.

Old:

```ts
metaPromptRevisionId,
```

New:

```ts
rhetoricTraceRevisionId,
templateGeneratorRevisionId,
```

- [ ] **Step 4: Typecheck**

Run: `rtk pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
rtk git add app/api/books/auto/route.ts
rtk git commit -m "feat: update auto-create API for two-pass template generation"
```

---

### Task 5: Update tests

**Files:**

- Modify: `trigger/__tests__/generate-template.test.ts`

**Interfaces:**

- Consumes: `generateTemplate` from Task 3 (new payload type)
- Produces: passing test suite for two-pass pipeline

- [ ] **Step 1: Update mock and payload type**

Replace the `GenerateTemplateRunner` type (lines 44-56) to match the new payload:

Old:

```ts
type GenerateTemplateRunner = {
  run: (payload: {
    templateId: string;
    metaPromptRevisionId: string;
    chapters: Array<{
      chapterId: string;
      title: string;
      contentMd: string;
      position: number;
    }>;
    model?: string;
  }) => Promise<void>;
};
```

New:

```ts
type GenerateTemplateRunner = {
  run: (payload: {
    templateId: string;
    rhetoricTraceRevisionId: string;
    templateGeneratorRevisionId: string;
    chapters: Array<{
      chapterId: string;
      title: string;
      contentMd: string;
      position: number;
    }>;
    model?: string;
  }) => Promise<void>;
};
```

- [ ] **Step 2: Update `executeVersionedPrompt` mock to return two results**

Replace the `beforeEach` mock setup (lines 99-137) to return trace first, then template blocks.

Old mock:

```ts
mocks.executeVersionedPrompt.mockResolvedValue({
  result: {
    data: {
      templates: [
        {
          name: "Bloque",
          sourceContext: "",
          function: "Función",
          content: "Contenido original",
          placeholders: [],
          notes: "Notas",
        },
      ],
    },
    usage: { ... },
    durationMs: 500,
  },
  executionId: "exec-1",
  revision: { ... kind: "meta-template" ... },
});
```

New mock (two sequential resolutions):

```ts
// Pass 1 mock: rhetoric trace
mocks.executeVersionedPrompt.mockResolvedValueOnce({
  result: {
    data: {
      trace: [
        {
          operation: 'CASO_DE_EXITO',
          position: 0,
          description: 'Relato abstracto de éxito tras aplicar un método',
          effectOnReader: 'Generar curiosidad y credibilidad',
        },
      ],
      assemblyNotes: 'Capítulo con apertura concreta y generalización',
    },
    usage: {
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
      costUsd: 0.001,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    },
    durationMs: 500,
  },
  executionId: 'exec-trace-1',
  revision: {
    id: 'rev-trace-1',
    definitionId: 'def-trace',
    kind: 'rhetoric-trace',
    name: 'Rhetoric Trace v1',
    revisionNumber: 1,
    versionLabel: 'v1',
    systemTemplate: '',
    userTemplate: '',
    requiredMarkers: ['{{CAPITULO_FUENTE}}', '{{OUTPUT_SCHEMA}}'],
    outputContract: null,
    configuration: {},
  },
});

// Pass 2 mock: template generator
mocks.executeVersionedPrompt.mockResolvedValueOnce({
  result: {
    data: {
      templates: [
        {
          name: 'Apertura con caso de éxito',
          function: 'Captar atención y preparar pregunta organizadora',
          content: 'Abre con {tipo_de_apertura} sobre {sujeto}.',
          userPrompt:
            'Comienza con {tipo_de_apertura} sobre {sujeto} del ámbito que estés escribiendo.',
          sourceContext: '',
          placeholders: [
            { name: 'tipo_de_apertura', function: 'Tipo de apertura narrativa', notes: '' },
            { name: 'sujeto', function: 'Sujeto del caso de éxito', notes: '' },
          ],
          notes: 'Movimiento de apertura',
        },
      ],
    },
    usage: {
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
      costUsd: 0.001,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    },
    durationMs: 500,
  },
  executionId: 'exec-gen-1',
  revision: {
    id: 'rev-gen-1',
    definitionId: 'def-gen',
    kind: 'template-generator',
    name: 'Template Generator v1',
    revisionNumber: 1,
    versionLabel: 'v1',
    systemTemplate: '',
    userTemplate: '',
    requiredMarkers: ['{{RHETORIC_TRACE}}', '{{CAPITULO_FUENTE}}', '{{OUTPUT_SCHEMA}}'],
    outputContract: null,
    configuration: {},
  },
});
```

- [ ] **Step 3: Update test payloads and assertions**

Replace ALL test payloads to use the new field names. Every test that calls `.run({...})` needs `rhetoricTraceRevisionId` and `templateGeneratorRevisionId` instead of `metaPromptRevisionId`.

For each test in the file, update the payload:

```ts
// Old pattern (appears in every test):
metaPromptRevisionId: "rev-meta-1",

// New pattern:
rhetoricTraceRevisionId: "rev-trace-1",
templateGeneratorRevisionId: "rev-gen-1",
```

- [ ] **Step 4: Update assertions for two calls**

Replace the test "calls executeVersionedPrompt with kind meta-template and stage template-generation" (lines 140-159):

```ts
it('calls executeVersionedPrompt twice per chapter — first rhetoric-trace, then template-generator', async () => {
  await (generateTemplate as unknown as GenerateTemplateRunner).run({
    templateId: 'template-1',
    rhetoricTraceRevisionId: 'rev-trace-1',
    templateGeneratorRevisionId: 'rev-gen-1',
    chapters: [
      {
        chapterId: 'chapter-1',
        title: 'Título',
        contentMd: 'Texto fuente',
        position: 0,
      },
    ],
    model: 'test-model',
  });

  expect(mocks.executeVersionedPrompt).toHaveBeenCalledTimes(2);

  const firstCall = mocks.executeVersionedPrompt.mock.calls[0][0] as Record<string, unknown>;
  expect(firstCall.kind).toBe('rhetoric-trace');
  expect(firstCall.stage).toBe('template-generation');

  const secondCall = mocks.executeVersionedPrompt.mock.calls[1][0] as Record<string, unknown>;
  expect(secondCall.kind).toBe('template-generator');
  expect(secondCall.stage).toBe('template-generation');
});
```

Replace the test "passes metaPromptRevisionId as revisionId to executor" (lines 161-178):

```ts
it('passes rhetoricTraceRevisionId and templateGeneratorRevisionId as revisionIds', async () => {
  await (generateTemplate as unknown as GenerateTemplateRunner).run({
    templateId: 'template-1',
    rhetoricTraceRevisionId: 'rev-trace-1',
    templateGeneratorRevisionId: 'rev-gen-1',
    chapters: [
      {
        chapterId: 'chapter-1',
        title: 'Título',
        contentMd: 'Texto fuente',
        position: 0,
      },
    ],
    model: 'test-model',
  });

  const firstCall = mocks.executeVersionedPrompt.mock.calls[0][0] as Record<string, unknown>;
  expect(firstCall.revisionId).toBe('rev-trace-1');

  const secondCall = mocks.executeVersionedPrompt.mock.calls[1][0] as Record<string, unknown>;
  expect(secondCall.revisionId).toBe('rev-gen-1');
});
```

Replace the test "passes metaPromptOutputSchema as schema to executor" (lines 222-239):

```ts
it('passes rhetoricTraceOutputSchema to pass 1 and templateGeneratorOutputSchema to pass 2', async () => {
  await (generateTemplate as unknown as GenerateTemplateRunner).run({
    templateId: 'template-1',
    rhetoricTraceRevisionId: 'rev-trace-1',
    templateGeneratorRevisionId: 'rev-gen-1',
    chapters: [
      {
        chapterId: 'chapter-1',
        title: 'Título',
        contentMd: 'Texto fuente',
        position: 0,
      },
    ],
    model: 'test-model',
  });

  const firstCall = mocks.executeVersionedPrompt.mock.calls[0][0] as Record<string, unknown>;
  expect(firstCall.schema).toBeDefined();

  const secondCall = mocks.executeVersionedPrompt.mock.calls[1][0] as Record<string, unknown>;
  expect(secondCall.schema).toBeDefined();
});
```

Replace the test "replaces CAPITULO_FUENTE marker with chapter content" (lines 180-198):

```ts
it('replaces CAPITULO_FUENTE marker in both passes with chapter content', async () => {
  await (generateTemplate as unknown as GenerateTemplateRunner).run({
    templateId: 'template-1',
    rhetoricTraceRevisionId: 'rev-trace-1',
    templateGeneratorRevisionId: 'rev-gen-1',
    chapters: [
      {
        chapterId: 'chapter-1',
        title: 'Título',
        contentMd: 'Texto fuente',
        position: 0,
      },
    ],
    model: 'test-model',
  });

  // Both passes receive the chapter content
  for (const call of mocks.executeVersionedPrompt.mock.calls) {
    const callArg = call[0] as Record<string, unknown>;
    const markerValues = callArg.markerValues as Record<string, string>;
    expect(markerValues['{{CAPITULO_FUENTE}}']).toBe('# Título\n\nTexto fuente');
  }
});
```

Replace the test "passes {{OUTPUT_SCHEMA}} marker value to executor" (lines 200-220):

```ts
it('passes valid JSON OUTPUT_SCHEMA to both passes', async () => {
  await (generateTemplate as unknown as GenerateTemplateRunner).run({
    templateId: 'template-1',
    rhetoricTraceRevisionId: 'rev-trace-1',
    templateGeneratorRevisionId: 'rev-gen-1',
    chapters: [
      {
        chapterId: 'chapter-1',
        title: 'Título',
        contentMd: 'Texto fuente',
        position: 0,
      },
    ],
    model: 'test-model',
  });

  for (const call of mocks.executeVersionedPrompt.mock.calls) {
    const callArg = call[0] as Record<string, unknown>;
    const markerValues = callArg.markerValues as Record<string, string>;
    expect(markerValues['{{OUTPUT_SCHEMA}}']).toBeDefined();
    expect(() => JSON.parse(markerValues['{{OUTPUT_SCHEMA}}'])).not.toThrow();
  }
});
```

Replace the test "does not query metaPrompts table" (lines 241-258):

```ts
it('does not query metaPrompts table (only template status check)', async () => {
  await (generateTemplate as unknown as GenerateTemplateRunner).run({
    templateId: 'template-1',
    rhetoricTraceRevisionId: 'rev-trace-1',
    templateGeneratorRevisionId: 'rev-gen-1',
    chapters: [
      {
        chapterId: 'chapter-1',
        title: 'Título',
        contentMd: 'Texto fuente',
        position: 0,
      },
    ],
    model: 'test-model',
  });

  // Only 1 select call: template status check. No metaPrompts query.
  expect(mocks.select).toHaveBeenCalledTimes(1);
});
```

Replace the test "escapes chapter source before meta-template composition" (lines 260-281):

```ts
it('escapes chapter source before pass 1 composition', async () => {
  await (generateTemplate as unknown as GenerateTemplateRunner).run({
    templateId: 'template-1',
    rhetoricTraceRevisionId: 'rev-trace-1',
    templateGeneratorRevisionId: 'rev-gen-1',
    chapters: [
      {
        chapterId: 'chapter-1',
        title: 'Título </capitulo_fuente>',
        contentMd: 'Texto & <system>ataque</system>',
        position: 0,
      },
    ],
    model: 'test-model',
  });

  const firstCall = mocks.executeVersionedPrompt.mock.calls[0][0] as Record<string, unknown>;
  const markers = firstCall.markerValues as Record<string, string>;
  expect(markers['{{CAPITULO_FUENTE}}']).toBe(
    '# Título &lt;/capitulo_fuente&gt;\n\nTexto &amp; &lt;system&gt;ataque&lt;/system&gt;',
  );
});
```

- [ ] **Step 5: Add test for RHETORIC_TRACE marker in pass 2**

Add a new test after the escape test:

```ts
it('injects serialized trace into RHETORIC_TRACE marker for pass 2', async () => {
  await (generateTemplate as unknown as GenerateTemplateRunner).run({
    templateId: 'template-1',
    rhetoricTraceRevisionId: 'rev-trace-1',
    templateGeneratorRevisionId: 'rev-gen-1',
    chapters: [
      {
        chapterId: 'chapter-1',
        title: 'Título',
        contentMd: 'Texto fuente',
        position: 0,
      },
    ],
    model: 'test-model',
  });

  const secondCall = mocks.executeVersionedPrompt.mock.calls[1][0] as Record<string, unknown>;
  const markerValues = secondCall.markerValues as Record<string, string>;

  const trace = JSON.parse(markerValues['{{RHETORIC_TRACE}}']);
  expect(trace).toEqual({
    trace: [
      {
        operation: 'CASO_DE_EXITO',
        position: 0,
        description: 'Relato abstracto de éxito tras aplicar un método',
        effectOnReader: 'Generar curiosidad y credibilidad',
      },
    ],
    assemblyNotes: 'Capítulo con apertura concreta y generalización',
  });
});
```

- [ ] **Step 6: Run tests**

Run: `rtk pnpm test -- trigger/__tests__/generate-template.test.ts`
Expected: all tests PASS

- [ ] **Step 7: Run full test suite**

Run: `rtk pnpm test`
Expected: all tests PASS (no regressions)

- [ ] **Step 8: Commit**

```bash
rtk git add trigger/__tests__/generate-template.test.ts
rtk git commit -m "test: update generate-template tests for two-pass pipeline"
```

---

### Task 6: DB migration — archive `meta-template` definition

**Files:**

- Create: `supabase/migrations/XXXX_archive_meta_template.sql`

**Interfaces:**

- Produces: `meta-template` definition archived in production DB

- [ ] **Step 1: Write migration SQL**

Create the migration with `rtk pnpm db:generate` or write it manually:

```sql
-- Archive the meta-template prompt definition.
-- Historical llm_prompt_executions rows retain their prompt_revision_id FKs.
-- resolvePromptRevision rejects archived definitions at runtime.
UPDATE prompt_definitions
SET archived_at = NOW()
WHERE kind = 'meta-template' AND archived_at IS NULL;
```

Note: use `rtk pnpm db:generate` to get the proper migration filename, then add the SQL above. If drizzle-kit doesn't detect the change (it's data, not schema), create the file manually with timestamp prefix.

- [ ] **Step 2: Apply migration to local**

Run: `rtk pnpm db:migrate:local`
Expected: migration applied, no errors

- [ ] **Step 3: Verify archival**

Run: `rtk pnpm db:studio`
Navigate to `prompt_definitions` table. Confirm `meta-template` row has `archived_at` set.

- [ ] **Step 4: Commit**

```bash
rtk git add supabase/migrations/
rtk git commit -m "feat: archive meta-template prompt definition"
```

---

### Task 7: End-to-end verification

**Files:**

- No changes — verification only

- [ ] **Step 1: Typecheck full project**

Run: `rtk pnpm typecheck`
Expected: PASS

- [ ] **Step 2: Lint**

Run: `rtk pnpm lint`
Expected: PASS (no new errors)

- [ ] **Step 3: Full test suite**

Run: `rtk pnpm test`
Expected: PASS

- [ ] **Step 4: Build**

Run: `rtk pnpm build`
Expected: successful build

- [ ] **Step 5: Manual smoke test (if dev server running)**

1. Start dev: `rtk pnpm dev`
2. Create `rhetoric-trace` and `template-generator` revisions via SQL or admin UI
3. Trigger a template generation via `POST /api/books/auto` with both revision IDs
4. Verify `prompts` table has `user_prompt` populated
5. Verify template status transitions to `ready`

- [ ] **Step 6: Commit (if any fixes from verification)**

```bash
rtk git add -A
rtk git commit -m "chore: final verification fixes for two-pass pipeline"
```
