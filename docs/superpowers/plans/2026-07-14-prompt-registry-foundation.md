# Prompt Registry Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add immutable, user-visible prompt definitions/revisions, exact prompt composition, execution snapshots, and generic prompt administration without switching existing generation stages yet.

**Architecture:** New registry tables own reusable prompts; exact revision IDs own defaults and project bindings. A pure composer replaces declared markers and rejects implicit text. A thin executor calls `generateCompletion()` and stores exact semantic messages plus provider metadata. Existing stage code remains on legacy paths until plans 2 and 3 migrate it.

**Tech Stack:** Next.js 15 route handlers, React 19, TypeScript, Drizzle ORM, PostgreSQL/Supabase RLS, Zod, Vitest.

---

## Dependency and boundaries

Run first. Plans `2026-07-14-planned-editorial-assembly.md` and `2026-07-14-runtime-prompt-transparency-migration.md` depend on its schema and services.

Do not modify production generation calls in this plan. Foundation must be deployable before cutover.

## File map

- Create `supabase/migrations/20260714000002_add_prompt_registry.sql`: registry, bindings, execution table, RLS, legacy imports.
- Create `lib/db/schema/prompt-registry.ts`: Drizzle definitions for new tables.
- Modify `lib/db/schema/index.ts`: export registry schema.
- Create `lib/prompts/contracts.ts`: kinds, marker contracts, Zod inputs.
- Create `lib/prompts/composer.ts`: pure fail-closed marker substitution.
- Create `lib/prompts/repository.ts`: revision/default/binding lookup and immutable revision writes.
- Create `lib/prompts/executor.ts`: completion call plus exact execution persistence.
- Create `app/api/prompt-definitions/route.ts`: list/create definitions.
- Create `app/api/prompt-definitions/[id]/route.ts`: read/archive definition.
- Create `app/api/prompt-definitions/[id]/revisions/route.ts`: list/create immutable revisions.
- Create `app/api/prompt-defaults/[kind]/route.ts`: read/set exact default revision.
- Create `app/api/projects/[id]/prompt-bindings/route.ts`: owner-scoped project bindings.
- Create `app/api/prompt-executions/route.ts`: authorized execution summaries by project, generation, template, and stage.
- Create `app/api/prompt-executions/[id]/route.ts`: owner/admin execution inspection.
- Create `components/prompts/prompt-definition-list.tsx`: kind-filtered list and creation.
- Create `components/prompts/prompt-revision-editor.tsx`: immutable revision creation/history.
- Modify `app/generation/page.tsx`: registry tabs/list.
- Modify `app/generation/[id]/page.tsx`: definition/revision screen.
- Test with new focused files under `lib/__tests__/` and `lib/prompts/__tests__/`.

### Task 1: Add registry database schema and safe legacy import

**Files:**

- Create: `lib/__tests__/prompt-registry-migration.test.ts`
- Create: `supabase/migrations/20260714000002_add_prompt_registry.sql`
- Create: `lib/db/schema/prompt-registry.ts`
- Modify: `lib/db/schema/index.ts`

- [ ] **Step 1: Write failing migration assertions**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../../supabase/migrations/20260714000002_add_prompt_registry.sql', import.meta.url),
  'utf8',
);

describe('prompt registry migration', () => {
  it('creates immutable registry and exact bindings', () => {
    for (const table of [
      'prompt_definitions',
      'prompt_revisions',
      'prompt_defaults',
      'project_prompt_bindings',
      'llm_prompt_executions',
    ])
      expect(sql).toContain(`CREATE TABLE ${table}`);
    expect(sql).toContain('UNIQUE (prompt_definition_id, revision_number)');
    expect(sql).toContain('UNIQUE (prompt_definition_id, version_label)');
    expect(sql).toContain('CREATE TRIGGER prompt_revisions_immutable');
    expect(sql).toContain('CREATE TRIGGER prompt_defaults_kind_guard');
    expect(sql).toContain('CREATE TRIGGER project_prompt_bindings_kind_guard');
  });

  it('imports every visible legacy prompt source', () => {
    expect(sql).toContain('FROM generation_system_prompts');
    expect(sql).toContain('FROM meta_prompts');
    expect(sql).toContain('FROM prompt_library');
  });

  it('enables RLS and preserves legacy tables', () => {
    expect(sql.match(/ENABLE ROW LEVEL SECURITY/g)).toHaveLength(5);
    expect(sql).not.toMatch(
      /DROP TABLE\s+(generation_system_prompts|meta_prompts|prompt_library)/i,
    );
  });
});
```

- [ ] **Step 2: Run test; verify missing migration failure**

Run: `rtk pnpm test -- lib/__tests__/prompt-registry-migration.test.ts`

Expected: FAIL because migration file does not exist.

- [ ] **Step 3: Add migration with exact constraints and idempotent imports**

```sql
BEGIN;

CREATE TABLE prompt_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN (
    'generation-system','meta-template','assembly-planner','assembly',
    'critique','corrector','title','placeholder-fill','editorial-brief-extractor'
  )),
  name text NOT NULL,
  description text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE prompt_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_definition_id uuid NOT NULL REFERENCES prompt_definitions(id) ON DELETE RESTRICT,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  version_label text NOT NULL CHECK (length(btrim(version_label)) > 0),
  system_template text NOT NULL,
  user_template text NOT NULL,
  required_markers jsonb NOT NULL DEFAULT '[]'::jsonb,
  output_contract text,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (prompt_definition_id, revision_number),
  UNIQUE (prompt_definition_id, version_label)
);

CREATE TABLE prompt_defaults (
  kind text PRIMARY KEY CHECK (kind IN (
    'generation-system','meta-template','assembly-planner','assembly',
    'critique','corrector','title','placeholder-fill','editorial-brief-extractor'
  )),
  prompt_revision_id uuid NOT NULL REFERENCES prompt_revisions(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE project_prompt_bindings (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN (
    'generation-system','meta-template','assembly-planner','assembly',
    'critique','corrector','title','placeholder-fill','editorial-brief-extractor'
  )),
  prompt_revision_id uuid NOT NULL REFERENCES prompt_revisions(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, kind)
);

CREATE TABLE llm_prompt_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  book_template_id uuid REFERENCES book_templates(id) ON DELETE CASCADE,
  chapter_id uuid REFERENCES chapters(id) ON DELETE CASCADE,
  chapter_generation_id uuid REFERENCES chapter_generations(id) ON DELETE CASCADE,
  stage text NOT NULL,
  prompt_revision_id uuid REFERENCES prompt_revisions(id) ON DELETE RESTRICT,
  chapter_prompt_revision_id uuid REFERENCES prompt_versions(id) ON DELETE RESTRICT,
  model text NOT NULL,
  provider text NOT NULL,
  messages jsonb NOT NULL,
  data_manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_contract text,
  technical_policies jsonb NOT NULL DEFAULT '[]'::jsonb,
  provider_payload_manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'started' CHECK (status IN ('started','completed','failed')),
  usage jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX idx_prompt_definitions_kind ON prompt_definitions(kind) WHERE archived_at IS NULL;
CREATE INDEX idx_prompt_revisions_definition ON prompt_revisions(prompt_definition_id, revision_number DESC);
CREATE INDEX idx_llm_prompt_executions_generation ON llm_prompt_executions(chapter_generation_id, created_at);
CREATE INDEX idx_llm_prompt_executions_template ON llm_prompt_executions(book_template_id, created_at);

CREATE FUNCTION reject_prompt_revision_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'prompt revisions are immutable';
END;
$$;
CREATE TRIGGER prompt_revisions_immutable
BEFORE UPDATE OR DELETE ON prompt_revisions
FOR EACH ROW EXECUTE FUNCTION reject_prompt_revision_mutation();

CREATE FUNCTION enforce_prompt_binding_kind() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE revision_kind text;
BEGIN
  SELECT pd.kind INTO revision_kind
  FROM prompt_revisions pr
  JOIN prompt_definitions pd ON pd.id = pr.prompt_definition_id
  WHERE pr.id = NEW.prompt_revision_id;
  IF revision_kind IS NULL OR revision_kind <> NEW.kind THEN
    RAISE EXCEPTION 'prompt revision kind % does not match binding kind %', revision_kind, NEW.kind;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER prompt_defaults_kind_guard
BEFORE INSERT OR UPDATE ON prompt_defaults
FOR EACH ROW EXECUTE FUNCTION enforce_prompt_binding_kind();
CREATE TRIGGER project_prompt_bindings_kind_guard
BEFORE INSERT OR UPDATE ON project_prompt_bindings
FOR EACH ROW EXECUTE FUNCTION enforce_prompt_binding_kind();

-- Namespaced deterministic IDs prevent collisions between legacy tables and
-- make migration retries harmless.
INSERT INTO prompt_definitions (id, kind, name, description)
SELECT md5('definition:generation_system_prompts:' || id::text)::uuid,
       'generation-system', name, description FROM generation_system_prompts
ON CONFLICT (id) DO NOTHING;
INSERT INTO prompt_revisions (
  id, prompt_definition_id, revision_number, version_label,
  system_template, user_template, required_markers, output_contract, configuration
)
SELECT md5('revision:generation_system_prompts:' || id::text)::uuid,
       md5('definition:generation_system_prompts:' || id::text)::uuid,
       1, 'imported-1', content, '', '[]'::jsonb, NULL,
       jsonb_build_object(
         'legacySource', 'generation_system_prompts',
         'legacyNonExecutable', true
       )
FROM generation_system_prompts
ON CONFLICT (id) DO NOTHING;

INSERT INTO prompt_definitions (id, kind, name, description)
SELECT md5('definition:meta_prompts:' || id::text)::uuid,
       'meta-template', name, description FROM meta_prompts
ON CONFLICT (id) DO NOTHING;
INSERT INTO prompt_revisions (
  id, prompt_definition_id, revision_number, version_label,
  system_template, user_template, required_markers, output_contract, configuration
)
SELECT md5('revision:meta_prompts:' || id::text)::uuid,
       md5('definition:meta_prompts:' || id::text)::uuid,
       1, 'imported-1', content, coalesce(user_prompt, ''),
       '["{{CAPITULO_FUENTE}}"]'::jsonb, 'meta-prompt-output',
       jsonb_build_object('legacySource', 'meta_prompts', 'legacyNonExecutable', true)
FROM meta_prompts
ON CONFLICT (id) DO NOTHING;

INSERT INTO prompt_definitions (id, kind, name, description)
SELECT md5('definition:prompt_library:' || id::text)::uuid,
       category, name, description FROM prompt_library
ON CONFLICT (id) DO NOTHING;
INSERT INTO prompt_revisions (
  id, prompt_definition_id, revision_number, version_label,
  system_template, user_template, required_markers, output_contract, configuration
)
SELECT md5('revision:prompt_library:' || id::text)::uuid,
       md5('definition:prompt_library:' || id::text)::uuid,
       1, 'imported-1', content, coalesce(user_prompt, ''), '[]'::jsonb, NULL,
       jsonb_build_object('legacySource', 'prompt_library', 'legacyNonExecutable', true)
FROM prompt_library
ON CONFLICT (id) DO NOTHING;

INSERT INTO prompt_defaults (kind, prompt_revision_id)
SELECT 'generation-system', md5('revision:generation_system_prompts:' || id::text)::uuid
FROM generation_system_prompts WHERE is_default = true
ON CONFLICT (kind) DO NOTHING;

-- Preserve explicit per-project generation-system choices. Assembly bindings
-- intentionally do not migrate: plan 2 replaces legacy assembly behavior with
-- planner + Assembly v1.3.
INSERT INTO project_prompt_bindings (project_id, kind, prompt_revision_id)
SELECT p.id, 'generation-system',
       md5('revision:generation_system_prompts:' || p.generation_system_prompt_id::text)::uuid
FROM projects p
WHERE p.generation_system_prompt_id IS NOT NULL
ON CONFLICT (project_id, kind) DO NOTHING;

ALTER TABLE prompt_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_prompt_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_prompt_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY prompt_definitions_read ON prompt_definitions FOR SELECT TO authenticated USING (true);
CREATE POLICY prompt_revisions_read ON prompt_revisions FOR SELECT TO authenticated USING (true);
CREATE POLICY prompt_defaults_read ON prompt_defaults FOR SELECT TO authenticated USING (true);
CREATE POLICY prompt_definitions_admin ON prompt_definitions FOR ALL TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
CREATE POLICY prompt_revisions_admin ON prompt_revisions FOR INSERT TO authenticated
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
CREATE POLICY prompt_defaults_admin ON prompt_defaults FOR ALL TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
CREATE POLICY project_prompt_bindings_owner ON project_prompt_bindings FOR ALL TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = (select auth.uid())))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = (select auth.uid())));
CREATE POLICY llm_prompt_executions_owner_read ON llm_prompt_executions FOR SELECT TO authenticated
  USING (
    project_id IN (SELECT id FROM projects WHERE user_id = (select auth.uid()))
    OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

COMMIT;
```

- [ ] **Step 4: Add matching Drizzle schema**

Define `promptKindValues` once in `lib/db/schema/prompt-registry.ts`; export `promptDefinitions`, `promptRevisions`, `promptDefaults`, `projectPromptBindings`, and `llmPromptExecutions`. Use `jsonb(...).$type<...>()` for markers/messages/manifests. Export file from `lib/db/schema/index.ts`.

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
] as const;
export type PromptKind = (typeof promptKindValues)[number];
```

- [ ] **Step 5: Run focused tests and typecheck**

Run: `rtk pnpm test -- lib/__tests__/prompt-registry-migration.test.ts`

Expected: PASS.

Run: `rtk pnpm typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add supabase/migrations/20260714000002_add_prompt_registry.sql lib/db/schema/prompt-registry.ts lib/db/schema/index.ts lib/__tests__/prompt-registry-migration.test.ts
rtk git commit -m "feat: add prompt registry schema"
```

### Task 2: Define prompt kinds and fail-closed marker contracts

**Files:**

- Create: `lib/prompts/contracts.ts`
- Create: `lib/prompts/__tests__/contracts.test.ts`

- [ ] **Step 1: Write failing contract tests**

```ts
import { describe, expect, it } from 'vitest';
import { assertPromptMarkers, promptRevisionInputSchema } from '@/lib/prompts/contracts';

describe('prompt marker contracts', () => {
  it('requires planner data and schema markers', () => {
    expect(() => assertPromptMarkers('assembly-planner', 'sys', '{{SECCIONES_GENERADAS}}')).toThrow(
      '{{EDITORIAL_CONTEXT}}',
    );
  });

  it('rejects undeclared runtime markers', () => {
    expect(() =>
      assertPromptMarkers(
        'assembly',
        '{{EDITORIAL_CONTEXT}}',
        '{{ASSEMBLY_PLAN}} {{SECCIONES_GENERADAS}} {{SECRET_RULE}}',
      ),
    ).toThrow('Unknown runtime marker {{SECRET_RULE}}');
  });

  it('accepts immutable revision input', () => {
    expect(
      promptRevisionInputSchema.parse({
        versionLabel: '1.3',
        systemTemplate: '{{EDITORIAL_CONTEXT}}',
        userTemplate: '{{ASSEMBLY_PLAN}} {{SECCIONES_GENERADAS}}',
        configuration: {},
      }).versionLabel,
    ).toBe('1.3');
  });
});
```

- [ ] **Step 2: Run test; verify missing module failure**

Run: `rtk pnpm test -- lib/prompts/__tests__/contracts.test.ts`

Expected: FAIL resolving `@/lib/prompts/contracts`.

- [ ] **Step 3: Implement kind-specific contracts**

```ts
import { z } from 'zod';
import type { PromptKind } from '@/lib/db/schema/prompt-registry';

export const RUNTIME_MARKER_RE = /\{\{[A-Z][A-Z0-9_]*\}\}/g;

export const requiredMarkersByKind: Record<PromptKind, readonly string[]> = {
  'generation-system': ['{{EDITORIAL_CONTEXT}}'],
  'meta-template': ['{{CAPITULO_FUENTE}}', '{{OUTPUT_SCHEMA}}'],
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

export const promptRevisionInputSchema = z.object({
  versionLabel: z.string().trim().min(1).max(80),
  systemTemplate: z.string().max(100_000),
  userTemplate: z.string().max(100_000),
  outputContract: z.string().trim().max(120).nullable().optional(),
  configuration: z.record(z.unknown()).default({}),
});

export function assertPromptMarkers(kind: PromptKind, system: string, user: string): string[] {
  const text = `${system}\n${user}`;
  const found = [...new Set(text.match(RUNTIME_MARKER_RE) ?? [])];
  for (const required of requiredMarkersByKind[kind]) {
    if (!found.includes(required))
      throw new Error(`Missing required marker ${required} for ${kind}`);
  }
  const allowed = new Set(requiredMarkersByKind[kind]);
  for (const marker of found) {
    if (!allowed.has(marker)) throw new Error(`Unknown runtime marker ${marker} for ${kind}`);
  }
  return found;
}
```

- [ ] **Step 4: Run test and commit**

Run: `rtk pnpm test -- lib/prompts/__tests__/contracts.test.ts`

Expected: PASS.

```bash
rtk git add lib/prompts/contracts.ts lib/prompts/__tests__/contracts.test.ts
rtk git commit -m "feat: validate prompt marker contracts"
```

### Task 3: Implement immutable registry repository

**Files:**

- Create: `lib/prompts/repository.ts`
- Create: `lib/prompts/__tests__/repository.test.ts`

- [ ] **Step 1: Write repository behavior tests with injected DB**

Test these cases explicitly:

```ts
it('resolves run override before project binding and global default', async () => {
  expect(
    await resolvePromptRevision(
      {
        kind: 'assembly',
        runRevisionId: 'run-id',
        projectId: 'project-id',
      },
      fakeDb,
    ),
  ).toMatchObject({ id: 'run-id', kind: 'assembly' });
});

it('rejects a revision whose definition kind differs', async () => {
  await expect(
    resolvePromptRevision(
      {
        kind: 'assembly',
        runRevisionId: 'critique-id',
      },
      fakeDb,
    ),
  ).rejects.toThrow('expected assembly, received critique');
});

it('rejects an imported revision that depended on legacy hidden composition', async () => {
  await expect(
    resolvePromptRevision({ kind: 'assembly', runRevisionId: 'legacy-non-executable-id' }, fakeDb),
  ).rejects.toThrow('legacy revision is read-only and not executable');
});

it('allocates next revision under row lock', async () => {
  const revision = await createPromptRevision('definition-id', input, 'admin-id', fakeDb);
  expect(revision.revisionNumber).toBe(3);
});
```

- [ ] **Step 2: Run and verify failures**

Run: `rtk pnpm test -- lib/prompts/__tests__/repository.test.ts`

Expected: FAIL because repository functions do not exist.

- [ ] **Step 3: Implement exact precedence and transactional revision creation**

Export:

```ts
export interface ResolvedPromptRevision {
  id: string;
  definitionId: string;
  kind: PromptKind;
  name: string;
  revisionNumber: number;
  versionLabel: string;
  systemTemplate: string;
  userTemplate: string;
  requiredMarkers: string[];
  outputContract: string | null;
  configuration: Record<string, unknown>;
}

export async function resolvePromptRevision(
  input: { kind: PromptKind; runRevisionId?: string; projectId?: string },
  ctx: DB = db,
): Promise<ResolvedPromptRevision>;

export async function createPromptRevision(
  definitionId: string,
  input: PromptRevisionInput,
  userId: string,
  ctx: DB = db,
): Promise<ResolvedPromptRevision>;
```

Resolution order must be `runRevisionId -> project_prompt_bindings -> prompt_defaults`. Join revision to definition and validate kind after every lookup. Reject `configuration.legacyNonExecutable === true`; those imports remain inspectable only because their old behavior required hidden runtime composition. `createPromptRevision()` locks the definition row, computes `coalesce(max(revision_number),0)+1`, validates markers, rejects reserved configuration keys beginning with `legacy`, inserts, and never updates an existing revision.

- [ ] **Step 4: Run focused tests and commit**

Run: `rtk pnpm test -- lib/prompts/__tests__/repository.test.ts`

Expected: PASS.

```bash
rtk git add lib/prompts/repository.ts lib/prompts/__tests__/repository.test.ts
rtk git commit -m "feat: resolve immutable prompt revisions"
```

### Task 4: Compose prompts without implicit prose

**Files:**

- Create: `lib/prompts/composer.ts`
- Create: `lib/prompts/__tests__/composer.test.ts`

- [ ] **Step 1: Write exact byte-level tests**

```ts
import { describe, expect, it } from 'vitest';
import { composePrompt } from '@/lib/prompts/composer';

const revision = {
  id: 'rev-1',
  kind: 'assembly' as const,
  systemTemplate: 'SYS\n{{EDITORIAL_CONTEXT}}',
  userTemplate: 'PLAN={{ASSEMBLY_PLAN}}\nFRAGS={{SECCIONES_GENERADAS}}',
  requiredMarkers: ['{{EDITORIAL_CONTEXT}}', '{{ASSEMBLY_PLAN}}', '{{SECCIONES_GENERADAS}}'],
};

it('replaces only declared markers byte for byte', () => {
  expect(
    composePrompt(revision, {
      '{{EDITORIAL_CONTEXT}}': '<brief />',
      '{{ASSEMBLY_PLAN}}': '{"version":"1"}',
      '{{SECCIONES_GENERADAS}}': '<fragmentos />',
    }),
  ).toEqual({
    systemMessage: 'SYS\n<brief />',
    userMessage: 'PLAN={"version":"1"}\nFRAGS=<fragmentos />',
    dataManifest: expect.any(Object),
  });
});

it('fails when a value is missing', () => {
  expect(() => composePrompt(revision, {})).toThrow('Missing marker value {{EDITORIAL_CONTEXT}}');
});

it('fails when replacement leaves a runtime marker', () => {
  expect(() =>
    composePrompt(revision, {
      '{{EDITORIAL_CONTEXT}}': '{{HIDDEN}}',
      '{{ASSEMBLY_PLAN}}': '{}',
      '{{SECCIONES_GENERADAS}}': '[]',
    }),
  ).toThrow('Unresolved runtime marker {{HIDDEN}}');
});
```

- [ ] **Step 2: Run and verify failure**

Run: `rtk pnpm test -- lib/prompts/__tests__/composer.test.ts`

Expected: FAIL resolving composer.

- [ ] **Step 3: Implement literal replacement and manifest hashing**

`composePrompt()` must iterate `revision.requiredMarkers`, require every value, use `split(marker).join(value)`, then reject any remaining `RUNTIME_MARKER_RE`. `dataManifest` records `{ marker, sha256, chars }` using `node:crypto`; it never copies injected values. Stage code may later attach entity/version lineage but cannot replace these computed hashes.

- [ ] **Step 4: Run and commit**

Run: `rtk pnpm test -- lib/prompts/__tests__/composer.test.ts`

Expected: PASS.

```bash
rtk git add lib/prompts/composer.ts lib/prompts/__tests__/composer.test.ts
rtk git commit -m "feat: compose prompts explicitly"
```

### Task 5: Execute and persist exact semantic messages

**Files:**

- Create: `lib/prompts/executor.ts`
- Create: `lib/prompts/__tests__/executor.test.ts`

- [ ] **Step 1: Write failing executor test**

Mock `generateCompletion`, registry repository, and DB writes. Assert executor inserts `status: "started"` before provider invocation, provider receives composed strings, and persisted `messages` equals:

```ts
[
  { role: 'system', content: 'SYS\n<brief />' },
  { role: 'user', content: 'PLAN={}\nFRAGS=<fragments />' },
];
```

Also assert execution row carries `promptRevisionId`, stage, model, provider, marker hashes/sizes, supplied entity/version lineage, output contract, technical policies, and `providerPayloadManifest.cacheMode = "none"`. Assert lineage cannot override computed hashes. Add a rejection test: provider failure updates same execution to `status: "failed"`, sanitized error, and `completedAt`; successful call updates it to `status: "completed"` with usage.

- [ ] **Step 2: Run and verify failure**

Run: `rtk pnpm test -- lib/prompts/__tests__/executor.test.ts`

Expected: FAIL resolving executor.

- [ ] **Step 3: Implement executor with dependency injection**

```ts
export interface ExecuteVersionedPromptInput<T extends z.ZodTypeAny | undefined> {
  stage: string;
  kind: PromptKind;
  revisionId?: string;
  projectId?: string;
  bookTemplateId?: string;
  chapterId?: string;
  chapterGenerationId?: string;
  markerValues: Record<string, string>;
  dataLineage?: Record<
    string,
    {
      entityIds?: string[];
      versionIds?: string[];
      sourceHashes?: string[];
    }
  >;
  model: string;
  schema?: T;
  temperature?: number;
  maxTokens?: number;
  effort?: ReasoningEffort;
  technicalPolicies?: string[];
  signal?: AbortSignal;
}

export async function executeVersionedPrompt<T extends z.ZodTypeAny | undefined>(
  input: ExecuteVersionedPromptInput<T>,
): Promise<{
  result: CompletionResult<T extends z.ZodTypeAny ? z.infer<T> : string>;
  executionId: string;
  revision: ResolvedPromptRevision;
}>;
```

Resolve exact revision and compose. Validate that `dataLineage` keys are declared markers, merge entity/version lineage with composer-generated hash/size entries, and reject caller attempts to override computed hashes. Insert execution with `status: "started"` before calling `generateCompletion()`. Derive provider with `getProviderForModel()` and store native structured-output mode/schema name plus `cacheMode: "none"` in `providerPayloadManifest`, not schema prose. Registry execution initially disables provider prompt caching so saved semantic messages have no unrecorded cache-block split. On success, update usage/status/completedAt. On failure, update sanitized error/status/completedAt and rethrow. Every attempted provider call therefore has an inspectable exact prompt.

- [ ] **Step 4: Run and commit**

Run: `rtk pnpm test -- lib/prompts/__tests__/executor.test.ts`

Expected: PASS.

```bash
rtk git add lib/prompts/executor.ts lib/prompts/__tests__/executor.test.ts
rtk git commit -m "feat: record effective prompt executions"
```

### Task 6: Add immutable registry APIs

**Files:**

- Create: `app/api/prompt-definitions/route.ts`
- Create: `app/api/prompt-definitions/[id]/route.ts`
- Create: `app/api/prompt-definitions/[id]/revisions/route.ts`
- Create: `app/api/prompt-defaults/[kind]/route.ts`
- Create: `app/api/projects/[id]/prompt-bindings/route.ts`
- Create: `app/api/prompt-executions/route.ts`
- Create: `app/api/prompt-executions/[id]/route.ts`
- Create: `lib/__tests__/prompt-registry-routes.test.ts`

- [ ] **Step 1: Write route tests first**

Cover:

- unauthenticated list returns 401;
- non-admin create/revision/default returns 403;
- definition create returns 201;
- revision create returns next immutable revision and never calls update;
- archive refuses missing definition and leaves revisions untouched;
- project owner can set binding; other user gets 404;
- project owner can clear one binding and resolution returns to global default;
- binding rejects kind mismatch;
- default/binding rejects a legacy non-executable revision;
- execution list accepts one authorized filter from `projectId`, `chapterGenerationId`, or `bookTemplateId` plus optional `stage`;
- execution list returns summaries only and rejects unscoped requests;
- execution GET allows owner/admin and hides other projects.

- [ ] **Step 2: Run and verify failures**

Run: `rtk pnpm test -- lib/__tests__/prompt-registry-routes.test.ts`

Expected: FAIL because routes do not exist.

- [ ] **Step 3: Implement handlers using shared schemas/repository**

Definition POST body:

```ts
const createDefinitionSchema = z.object({
  kind: z.enum(promptKindValues),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
});
```

Revision POST uses `promptRevisionInputSchema`. Default PUT accepts `{ promptRevisionId: z.string().uuid() }`; verify executable revision/kind, lock the current default row, and upsert. Binding PUT accepts `{ kind, promptRevisionId }`; verify project owner, executable revision/kind, then upsert. Binding DELETE requires `?kind=...`, verifies project ownership, and deletes only that kind. Definition DELETE is not supported; PATCH sets `archivedAt` after ensuring no current default/binding points at any revision in the definition.

Execution GET selects execution plus definition/revision display data, verifies project owner or admin, and returns exact messages. Never expose unrelated project IDs through different 403/404 responses; use 404.

Execution list GET requires exactly one ownership scope (`projectId`, `chapterGenerationId`, or `bookTemplateId`), accepts optional `stage`, and returns `{ id, stage, status, promptName, versionLabel, createdAt, completedAt }`. Project and generation scopes require project ownership; template scope requires admin. Exact messages remain exclusive to `/api/prompt-executions/[id]`.

- [ ] **Step 4: Run route tests and commit**

Run: `rtk pnpm test -- lib/__tests__/prompt-registry-routes.test.ts`

Expected: PASS.

```bash
rtk git add app/api/prompt-definitions app/api/prompt-defaults app/api/projects/'[id]'/prompt-bindings app/api/prompt-executions lib/__tests__/prompt-registry-routes.test.ts
rtk git commit -m "feat: add prompt registry APIs"
```

### Task 7: Replace generation prompt administration with revision UI

**Files:**

- Create: `components/prompts/prompt-definition-list.tsx`
- Create: `components/prompts/prompt-revision-editor.tsx`
- Modify: `app/generation/page.tsx`
- Modify: `app/generation/[id]/page.tsx`
- Create: `components/prompts/__tests__/prompt-registry-ui.test.tsx`

- [ ] **Step 1: Write component tests**

Use Testing Library. Assert tabs include all kinds, current default badge uses exact revision label, default changes only through explicit confirmation, “New revision” sends POST to `/api/prompt-definitions/:id/revisions`, required-marker violations block save, two revisions can be compared, and editing an existing revision is impossible.

- [ ] **Step 2: Run and verify failure**

Run: `rtk pnpm test -- components/prompts/__tests__/prompt-registry-ui.test.tsx`

Expected: FAIL because components do not exist.

- [ ] **Step 3: Build kind-filtered list**

`PromptDefinitionList` props:

```ts
interface PromptDefinitionListProps {
  kind: PromptKind;
  definitions: Array<{
    id: string;
    name: string;
    description: string | null;
    latestRevision: { id: string; versionLabel: string; revisionNumber: number } | null;
    defaultRevisionId: string | null;
  }>;
  onCreate(input: { kind: PromptKind; name: string; description?: string }): Promise<void>;
}
```

Render Spanish labels: Sistema, Meta-prompt, Planificador, Ensamblaje, Crítica, Corrector, Título, Placeholders, Extractor editorial.

- [ ] **Step 4: Build immutable revision editor**

Show read-only existing revisions. Imported legacy revisions carry “Histórica—no ejecutable” and cannot become defaults/bindings. “Crear revisión” opens empty/copy-latest form with version label, system template, user template, output contract, configuration, and marker checklist; copy removes reserved legacy flags. Validate exact kind contract before POST. Save creates a new revision; no PUT/PATCH content action exists. Add two-revision compare with system/user/markers/configuration differences; compare never edits either revision.

- [ ] **Step 5: Wire generation pages and explicit default selection**

Definition page loads revision history and compare view. Default action sends exact revision ID to `/api/prompt-defaults/:kind` only after confirmation; creating a revision never changes default.

- [ ] **Step 6: Run UI and type tests**

Run: `rtk pnpm test -- components/prompts/__tests__/prompt-registry-ui.test.tsx`

Expected: PASS.

Run: `rtk pnpm typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
rtk git add app/generation components/prompts/prompt-definition-list.tsx components/prompts/prompt-revision-editor.tsx components/prompts/__tests__/prompt-registry-ui.test.tsx
rtk git commit -m "feat: manage immutable prompt revisions"
```

### Task 8: Foundation verification

**Files:** No production changes.

- [ ] **Step 1: Run focused suite**

```bash
rtk pnpm test -- lib/__tests__/prompt-registry-migration.test.ts lib/prompts/__tests__ lib/__tests__/prompt-registry-routes.test.ts components/prompts/__tests__/prompt-registry-ui.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run repository checks**

```bash
rtk pnpm test
rtk pnpm typecheck
rtk pnpm lint
rtk pnpm build
```

Expected: all PASS. If unrelated pre-existing failure appears, record exact output and stop; do not modify unrelated user files.

- [ ] **Step 3: Verify no runtime cutover occurred**

Run: `rtk rg -n "executeVersionedPrompt" lib trigger app/api`

Expected: matches only new foundation/tests/API utilities; no generation call site migrated yet.

- [ ] **Step 4: Confirm clean plan scope**

Run: `rtk git status --short`

Expected: only changes intentionally created by Tasks 1–7; no unrelated user files.
