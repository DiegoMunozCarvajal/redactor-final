# Unified Global Prompt Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `/generation` into the only CRUD surface for all nine global prompt kinds, then safely freeze and remove legacy prompt storage without losing project bindings or historical prompt text.

**Architecture:** Keep the existing prompt registry as canonical storage. Add a focused admin read model for bulk usage aggregation, enforce archive invariants in repository resolution, and let `/generation` consume one canonical API. Cut legacy pages and APIs before an idempotent catch-up/parity migration drops legacy columns and tables.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Drizzle ORM, PostgreSQL/Supabase migrations, Zod, Radix/shadcn UI, Vitest, Testing Library.

**Design:** `docs/superpowers/specs/2026-07-14-unified-global-prompt-management-design.md`

---

## Scope and execution constraints

- Start implementation in a dedicated worktree because the source workspace contains unrelated user changes.
- Preserve historical migrations `20260714000002_add_prompt_registry.sql` and `20260714000004_seed_transparent_runtime_prompts.sql`; add a new contraction migration.
- Do not move template/project chapter prompts into the global registry.
- Do not change prompt text, output contracts, provider/model selection, or assembly behavior.
- Use `rtk` prefix for every shell command.
- Follow red-green-refactor. Commit after every task with only that task's files staged.

## File responsibility map

### New files

- `lib/prompts/admin-types.ts` — client-safe DTOs for definition/revision usage.
- `lib/prompts/admin-repository.ts` — fixed-count bulk reads and archive state transitions.
- `lib/prompts/kinds.ts` — nine-kind grouping, labels, and URL parsing without server dependencies.
- `lib/prompts/__tests__/admin-repository.test.ts` — registry usage/archive integration tests.
- `components/prompts/prompt-kind-nav.tsx` — six Core tabs plus Utilities dropdown.
- `components/prompts/revision-diff.tsx` — base-to-draft system/user diff.
- `lib/api/legacy-prompt-gone.ts` — shared `410 Gone` response.
- `lib/prompts/legacy-redirects.ts` — deterministic legacy-page redirect targets.
- `lib/__tests__/legacy-prompt-cutover.test.ts` — redirects, `410`, static read audit.
- `lib/__tests__/legacy-prompt-contraction-migration.test.ts` — catch-up/parity/drop migration contract.
- `supabase/migrations/20260714000007_contract_legacy_prompt_storage.sql` — final snapshot, gates, and destructive contraction.

### Modified files

- `lib/prompts/repository.ts` and `lib/prompts/__tests__/repository.test.ts` — reject archived revisions/definitions.
- `app/api/prompt-definitions/route.ts` — filtered bulk definition summary API.
- `app/api/prompt-definitions/[id]/route.ts` — usage detail, metadata update, archive/restore.
- `app/api/prompt-definitions/[id]/revisions/route.ts` — duplicate-label conflict mapping.
- `app/generation/page.tsx` — URL-driven kind/archive catalog.
- `app/generation/[id]/page.tsx` — metadata, default, archive/restore orchestration.
- `components/prompts/prompt-definition-list.tsx` — exact default and usage badges.
- `components/prompts/prompt-revision-editor.tsx` — create from any revision, JSON configuration, live diff, set default.
- `components/prompts/__tests__/prompt-registry-ui.test.tsx` — real UI behavior tests.
- `components/patterns/sidebar.tsx` — one Prompts navigation entry.
- Six legacy API route files — `410` handlers only.
- Four legacy page files — server redirects only.
- `lib/db/schema/projects.ts` and `lib/db/schema/index.ts` — remove legacy table dependencies.
- `lib/__tests__/prompt-transparency.test.ts` — enforce zero legacy production reads.

### Deleted files

- `scripts/assemble-chapter.ts`
- `lib/db/schema/prompt-library.ts`
- `lib/db/schema/meta-prompts.ts`
- `lib/db/schema/generation-prompts.ts`

---

### Task 1: Enforce archive invariants in runtime resolution

**Files:**

- Modify: `lib/prompts/__tests__/repository.test.ts:15-280`
- Modify: `lib/prompts/repository.ts:35-250`

- [ ] **Step 1: Add failing resolver and revision-creation tests**

Add `archivedAt` to `revRow()` and these cases:

```ts
function revRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rev-1',
    promptDefinitionId: 'def-1',
    revisionNumber: 1,
    versionLabel: '1.0',
    systemTemplate: 'SYS {{TEST}}',
    userTemplate: 'USER {{TEST}}',
    requiredMarkers: ['{{TEST}}'],
    outputContract: null,
    configuration: {},
    kind: 'assembly',
    name: 'Test Assembly',
    archivedAt: null,
    ...overrides,
  };
}

it('rejects an archived definition during explicit resolution', async () => {
  const chain = makeChain([revRow({ archivedAt: new Date('2026-07-14') })]);
  mockDb.select.mockReturnValue(chain);

  await expect(resolvePromptRevision({ kind: 'assembly', runRevisionId: 'rev-1' })).rejects.toThrow(
    'belongs to an archived definition',
  );
});

it('falls back from a missing project binding to the global default', async () => {
  mockDb.select
    .mockReturnValueOnce(makeChain([]))
    .mockReturnValueOnce(makeChain([revRow({ id: 'default-rev' })]));

  const result = await resolvePromptRevision({
    kind: 'assembly',
    projectId: 'project-without-binding',
  });

  expect(result.id).toBe('default-rev');
  expect(mockDb.select).toHaveBeenCalledTimes(2);
});

it('rejects creating a revision on an archived definition', async () => {
  const def = {
    id: 'def-1',
    kind: 'assembly',
    name: 'Archived',
    archivedAt: new Date('2026-07-14'),
  };
  const chain = makeChain([def]);
  chain.for = vi.fn(() => Promise.resolve([def]));
  mockDb.transaction.mockImplementation(async (fn) =>
    fn({ select: vi.fn(() => chain), insert: vi.fn() }),
  );

  await expect(
    createPromptRevision(
      'def-1',
      {
        versionLabel: '2.0',
        systemTemplate: '{{EDITORIAL_CONTEXT}}',
        userTemplate: '{{ASSEMBLY_PLAN}} {{SECCIONES_GENERADAS}}',
        configuration: {},
      },
      'user-1',
    ),
  ).rejects.toThrow('Prompt definition def-1 is archived');
});
```

- [ ] **Step 2: Run focused test and verify red**

Run:

```bash
rtk pnpm test -- lib/prompts/__tests__/repository.test.ts
```

Expected: FAIL because selected rows lack archive validation.

- [ ] **Step 3: Add archive state to repository selection and guards**

Add one property to `SelectRow`, one field to `selectFields`, then guard resolution:

```ts
archivedAt: Date | null;

archivedAt: promptDefinitions.archivedAt,

if (row.archivedAt !== null) {
  throw new Error(`Prompt revision ${row.id} belongs to an archived definition`);
}
```

The locked definition selection must include and reject archive state before computing the next revision number:

```ts
const [def] = await tx
  .select({
    id: promptDefinitions.id,
    kind: promptDefinitions.kind,
    name: promptDefinitions.name,
    archivedAt: promptDefinitions.archivedAt,
  })
  .from(promptDefinitions)
  .where(eq(promptDefinitions.id, definitionId))
  .for('update');

if (!def) throw new Error(`Prompt definition ${definitionId} not found`);
if (def.archivedAt !== null) {
  throw new Error(`Prompt definition ${definitionId} is archived`);
}
```

- [ ] **Step 4: Run focused tests and verify green**

Run:

```bash
rtk pnpm test -- lib/prompts/__tests__/repository.test.ts lib/prompts/__tests__/executor.test.ts lib/prompts/__tests__/chapter-executor.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit archive invariants**

```bash
rtk git add lib/prompts/repository.ts lib/prompts/__tests__/repository.test.ts
rtk git commit -m "fix: enforce prompt archive invariants"
```

---

### Task 2: Add bulk admin read model and archive transitions

**Files:**

- Create: `lib/prompts/admin-types.ts`
- Create: `lib/prompts/admin-repository.ts`
- Create: `lib/prompts/__tests__/admin-repository.test.ts`

- [ ] **Step 1: Write failing integration tests for exact usage/default state**

Create fixtures with two revisions, an older default, one project binding, and two executions. Assert definition-level and revision-level values:

```ts
import { describe, expect, it } from 'vitest';
import { withTestDb } from '@/lib/__tests__/helpers/db';
import { createTestProject } from '@/lib/__tests__/helpers/fixtures';
import {
  llmPromptExecutions,
  projectPromptBindings,
  promptDefaults,
  promptDefinitions,
  promptRevisions,
} from '@/lib/db/schema';
import {
  getPromptDefinitionDetail,
  listPromptDefinitionSummaries,
  setPromptDefinitionArchived,
} from '@/lib/prompts/admin-repository';

describe('prompt admin repository', () => {
  it('returns latest, exact older default, bindings, and execution attempts', async () => {
    await withTestDb(async (tx) => {
      const project = await createTestProject(tx, { name: 'Prompt usage' });
      const [definition] = await tx
        .insert(promptDefinitions)
        .values({
          kind: 'assembly',
          name: 'Assembly test',
        })
        .returning();
      const revisions = await tx
        .insert(promptRevisions)
        .values([
          {
            promptDefinitionId: definition.id,
            revisionNumber: 1,
            versionLabel: '1.0',
            systemTemplate: '{{EDITORIAL_CONTEXT}}',
            userTemplate: '{{ASSEMBLY_PLAN}} {{SECCIONES_GENERADAS}}',
            requiredMarkers: [
              '{{EDITORIAL_CONTEXT}}',
              '{{ASSEMBLY_PLAN}}',
              '{{SECCIONES_GENERADAS}}',
            ],
            configuration: {},
          },
          {
            promptDefinitionId: definition.id,
            revisionNumber: 2,
            versionLabel: '1.1',
            systemTemplate: '{{EDITORIAL_CONTEXT}} revised',
            userTemplate: '{{ASSEMBLY_PLAN}} {{SECCIONES_GENERADAS}}',
            requiredMarkers: [
              '{{EDITORIAL_CONTEXT}}',
              '{{ASSEMBLY_PLAN}}',
              '{{SECCIONES_GENERADAS}}',
            ],
            configuration: {},
          },
        ])
        .returning();
      await tx
        .insert(promptDefaults)
        .values({
          kind: 'assembly',
          promptRevisionId: revisions[0].id,
        })
        .onConflictDoUpdate({
          target: promptDefaults.kind,
          set: { promptRevisionId: revisions[0].id },
        });
      await tx.insert(projectPromptBindings).values({
        projectId: project.id,
        kind: 'assembly',
        promptRevisionId: revisions[1].id,
      });
      await tx.insert(llmPromptExecutions).values([
        {
          stage: 'assembly',
          promptRevisionId: revisions[0].id,
          model: 'test',
          provider: 'test',
          messages: [],
          status: 'completed',
        },
        {
          stage: 'assembly',
          promptRevisionId: revisions[1].id,
          model: 'test',
          provider: 'test',
          messages: [],
          status: 'failed',
        },
      ]);

      const summaries = await listPromptDefinitionSummaries(
        { kind: 'assembly', archive: 'active' },
        tx,
      );
      const summary = summaries.find((row) => row.id === definition.id)!;
      expect(summary.latestRevision?.versionLabel).toBe('1.1');
      expect(summary.defaultRevisionId).toBe(revisions[0].id);
      expect(summary.defaultVersionLabel).toBe('1.0');
      expect(summary.bindingCount).toBe(1);
      expect(summary.executionCount).toBe(2);

      const detail = await getPromptDefinitionDetail(definition.id, tx);
      expect(detail?.revisions.find((r) => r.id === revisions[0].id)?.isDefault).toBe(true);
      expect(detail?.revisions.find((r) => r.id === revisions[1].id)?.bindingCount).toBe(1);
    });
  });

  it('blocks archive while active references exist and restores idempotently', async () => {
    await withTestDb(async (tx) => {
      const [definition] = await tx
        .insert(promptDefinitions)
        .values({
          kind: 'title',
          name: 'Archive test',
        })
        .returning();
      const [revision] = await tx
        .insert(promptRevisions)
        .values({
          promptDefinitionId: definition.id,
          revisionNumber: 1,
          versionLabel: '1.0',
          systemTemplate: '{{OUTPUT_SCHEMA}}',
          userTemplate: '{{EDITORIAL_CONTEXT}} {{PROJECT_TOPIC}}',
          requiredMarkers: ['{{EDITORIAL_CONTEXT}}', '{{PROJECT_TOPIC}}', '{{OUTPUT_SCHEMA}}'],
          configuration: {},
        })
        .returning();
      await tx
        .insert(promptDefaults)
        .values({ kind: 'title', promptRevisionId: revision.id })
        .onConflictDoUpdate({
          target: promptDefaults.kind,
          set: { promptRevisionId: revision.id },
        });

      await expect(setPromptDefinitionArchived(definition.id, true, tx)).rejects.toMatchObject({
        blockers: { defaultCount: 1, bindingCount: 0 },
      });
    });
  });

  it('archives and restores an unreferenced definition idempotently', async () => {
    await withTestDb(async (tx) => {
      const [definition] = await tx
        .insert(promptDefinitions)
        .values({
          kind: 'critique',
          name: 'Unreferenced',
        })
        .returning();

      const archived = await setPromptDefinitionArchived(definition.id, true, tx);
      expect(archived?.archivedAt).not.toBeNull();
      const activeRows = await listPromptDefinitionSummaries(
        { kind: 'critique', archive: 'active' },
        tx,
      );
      const archivedRows = await listPromptDefinitionSummaries(
        { kind: 'critique', archive: 'archived' },
        tx,
      );
      expect(activeRows.some((row) => row.id === definition.id)).toBe(false);
      expect(archivedRows.some((row) => row.id === definition.id)).toBe(true);
      const archivedAgain = await setPromptDefinitionArchived(definition.id, true, tx);
      expect(archivedAgain?.archivedAt).not.toBeNull();
      const restored = await setPromptDefinitionArchived(definition.id, false, tx);
      expect(restored?.archivedAt).toBeNull();
      const restoredAgain = await setPromptDefinitionArchived(definition.id, false, tx);
      expect(restoredAgain?.archivedAt).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run test and verify missing module failure**

```bash
rtk pnpm test -- lib/prompts/__tests__/admin-repository.test.ts
```

Expected: FAIL because admin repository/types do not exist.

- [ ] **Step 3: Define client-safe DTOs**

Create `admin-types.ts`:

```ts
import type { PromptKind } from '@/lib/db/schema/prompt-registry';

export type PromptArchiveView = 'active' | 'archived' | 'all';

export interface PromptRevisionAdminSummary {
  id: string;
  revisionNumber: number;
  versionLabel: string;
  systemTemplate: string;
  userTemplate: string;
  requiredMarkers: string[];
  outputContract: string | null;
  configuration: Record<string, unknown>;
  createdAt: string;
  createdBy: string | null;
  isDefault: boolean;
  bindingCount: number;
  executionCount: number;
}

export interface PromptDefinitionSummary {
  id: string;
  name: string;
  description: string | null;
  kind: PromptKind;
  archivedAt: string | null;
  latestRevision: Pick<PromptRevisionAdminSummary, 'id' | 'versionLabel' | 'revisionNumber'> | null;
  defaultRevisionId: string | null;
  defaultVersionLabel: string | null;
  bindingCount: number;
  executionCount: number;
}

export interface PromptDefinitionDetail extends Omit<PromptDefinitionSummary, 'latestRevision'> {
  revisions: PromptRevisionAdminSummary[];
}

export interface PromptArchiveBlockers {
  defaultCount: number;
  bindingCount: number;
}
```

- [ ] **Step 4: Implement fixed-count bulk reads and archive transaction**

In `admin-repository.ts`, query definitions once, all revisions once, defaults once, grouped bindings once, and grouped executions once. Never query inside a definition/revision loop.

Core interface and guard:

```ts
import { db } from '@/lib/db';
import { and, count, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import {
  llmPromptExecutions,
  projectPromptBindings,
  promptDefaults,
  promptDefinitions,
  promptRevisions,
} from '@/lib/db/schema/prompt-registry';
import type { PromptKind } from '@/lib/db/schema/prompt-registry';
import type { DB } from '@/lib/prompts/repository';
import type {
  PromptArchiveBlockers,
  PromptArchiveView,
  PromptDefinitionDetail,
  PromptDefinitionSummary,
} from '@/lib/prompts/admin-types';

export class PromptArchiveConflictError extends Error {
  constructor(public readonly blockers: PromptArchiveBlockers) {
    super('Prompt definition has active default or project bindings');
  }
}

export async function listPromptDefinitionSummaries(
  filters: { kind?: PromptKind; archive?: PromptArchiveView },
  ctx: DB = db,
): Promise<PromptDefinitionSummary[]> {
  const conditions: SQL[] = [];
  if (filters.kind) conditions.push(eq(promptDefinitions.kind, filters.kind));
  if ((filters.archive ?? 'active') === 'active')
    conditions.push(isNull(promptDefinitions.archivedAt));
  if (filters.archive === 'archived') conditions.push(isNotNull(promptDefinitions.archivedAt));

  const definitions = await ctx
    .select()
    .from(promptDefinitions)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(promptDefinitions.createdAt)
    .limit(100);
  if (definitions.length === 0) return [];

  const definitionIds = definitions.map((row) => row.id);
  const revisions = await ctx
    .select({
      id: promptRevisions.id,
      promptDefinitionId: promptRevisions.promptDefinitionId,
      revisionNumber: promptRevisions.revisionNumber,
      versionLabel: promptRevisions.versionLabel,
    })
    .from(promptRevisions)
    .where(inArray(promptRevisions.promptDefinitionId, definitionIds))
    .orderBy(promptRevisions.promptDefinitionId, desc(promptRevisions.revisionNumber));
  const defaults = await ctx
    .select({
      definitionId: promptRevisions.promptDefinitionId,
      revisionId: promptDefaults.promptRevisionId,
      versionLabel: promptRevisions.versionLabel,
    })
    .from(promptDefaults)
    .innerJoin(promptRevisions, eq(promptDefaults.promptRevisionId, promptRevisions.id))
    .where(inArray(promptRevisions.promptDefinitionId, definitionIds));
  const bindings = await ctx
    .select({
      definitionId: promptRevisions.promptDefinitionId,
      value: count(),
    })
    .from(projectPromptBindings)
    .innerJoin(promptRevisions, eq(projectPromptBindings.promptRevisionId, promptRevisions.id))
    .where(inArray(promptRevisions.promptDefinitionId, definitionIds))
    .groupBy(promptRevisions.promptDefinitionId);
  const executions = await ctx
    .select({
      definitionId: promptRevisions.promptDefinitionId,
      value: count(),
    })
    .from(llmPromptExecutions)
    .innerJoin(promptRevisions, eq(llmPromptExecutions.promptRevisionId, promptRevisions.id))
    .where(inArray(promptRevisions.promptDefinitionId, definitionIds))
    .groupBy(promptRevisions.promptDefinitionId);

  return mergeDefinitionSummaries(definitions, revisions, defaults, bindings, executions);
}
```

Use this pure merge for list rows:

```ts
type DefinitionRow = typeof promptDefinitions.$inferSelect;
type RevisionRow = {
  id: string;
  promptDefinitionId: string;
  revisionNumber: number;
  versionLabel: string;
};
type DefaultRow = { definitionId: string; revisionId: string; versionLabel: string };
type CountRow = { definitionId: string; value: number | bigint };

function mergeDefinitionSummaries(
  definitions: DefinitionRow[],
  revisions: RevisionRow[],
  defaults: DefaultRow[],
  bindings: CountRow[],
  executions: CountRow[],
): PromptDefinitionSummary[] {
  const latest = new Map<string, RevisionRow>();
  for (const revision of revisions) {
    if (!latest.has(revision.promptDefinitionId)) {
      latest.set(revision.promptDefinitionId, revision);
    }
  }
  const defaultMap = new Map(defaults.map((row) => [row.definitionId, row]));
  const bindingMap = new Map(bindings.map((row) => [row.definitionId, Number(row.value)]));
  const executionMap = new Map(executions.map((row) => [row.definitionId, Number(row.value)]));

  return definitions.map((definition) => {
    const latestRevision = latest.get(definition.id);
    const currentDefault = defaultMap.get(definition.id);
    return {
      id: definition.id,
      name: definition.name,
      description: definition.description,
      kind: definition.kind as PromptKind,
      archivedAt: definition.archivedAt?.toISOString() ?? null,
      latestRevision: latestRevision
        ? {
            id: latestRevision.id,
            versionLabel: latestRevision.versionLabel,
            revisionNumber: latestRevision.revisionNumber,
          }
        : null,
      defaultRevisionId: currentDefault?.revisionId ?? null,
      defaultVersionLabel: currentDefault?.versionLabel ?? null,
      bindingCount: bindingMap.get(definition.id) ?? 0,
      executionCount: executionMap.get(definition.id) ?? 0,
    };
  });
}
```

Detail uses fixed bulk queries grouped by revision ID:

```ts
export async function getPromptDefinitionDetail(
  definitionId: string,
  ctx: DB = db,
): Promise<PromptDefinitionDetail | null> {
  const [definition] = await ctx
    .select()
    .from(promptDefinitions)
    .where(eq(promptDefinitions.id, definitionId))
    .limit(1);
  if (!definition) return null;

  const revisions = await ctx
    .select()
    .from(promptRevisions)
    .where(eq(promptRevisions.promptDefinitionId, definitionId))
    .orderBy(desc(promptRevisions.revisionNumber));
  const revisionIds = revisions.map((row) => row.id);
  const [currentDefault] = await ctx
    .select({
      revisionId: promptDefaults.promptRevisionId,
    })
    .from(promptDefaults)
    .where(eq(promptDefaults.kind, definition.kind))
    .limit(1);

  const bindings =
    revisionIds.length === 0
      ? []
      : await ctx
          .select({
            revisionId: projectPromptBindings.promptRevisionId,
            value: count(),
          })
          .from(projectPromptBindings)
          .where(inArray(projectPromptBindings.promptRevisionId, revisionIds))
          .groupBy(projectPromptBindings.promptRevisionId);
  const executions =
    revisionIds.length === 0
      ? []
      : await ctx
          .select({
            revisionId: llmPromptExecutions.promptRevisionId,
            value: count(),
          })
          .from(llmPromptExecutions)
          .where(inArray(llmPromptExecutions.promptRevisionId, revisionIds))
          .groupBy(llmPromptExecutions.promptRevisionId);

  const bindingMap = new Map(bindings.map((row) => [row.revisionId!, Number(row.value)]));
  const executionMap = new Map(executions.map((row) => [row.revisionId!, Number(row.value)]));
  const revisionDtos = revisions.map((revision) => ({
    id: revision.id,
    revisionNumber: revision.revisionNumber,
    versionLabel: revision.versionLabel,
    systemTemplate: revision.systemTemplate,
    userTemplate: revision.userTemplate,
    requiredMarkers: revision.requiredMarkers,
    outputContract: revision.outputContract,
    configuration: revision.configuration,
    createdAt: revision.createdAt.toISOString(),
    createdBy: revision.createdBy,
    isDefault: revision.id === currentDefault?.revisionId,
    bindingCount: bindingMap.get(revision.id) ?? 0,
    executionCount: executionMap.get(revision.id) ?? 0,
  }));
  const defaultRevision = revisionDtos.find((row) => row.isDefault) ?? null;

  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    kind: definition.kind as PromptKind,
    archivedAt: definition.archivedAt?.toISOString() ?? null,
    defaultRevisionId: defaultRevision?.id ?? null,
    defaultVersionLabel: defaultRevision?.versionLabel ?? null,
    bindingCount: revisionDtos.reduce((sum, row) => sum + row.bindingCount, 0),
    executionCount: revisionDtos.reduce((sum, row) => sum + row.executionCount, 0),
    revisions: revisionDtos,
  };
}
```

Archive transaction must lock the definition and reject active references:

```ts
export async function setPromptDefinitionArchived(
  definitionId: string,
  archived: boolean,
  ctx: DB = db,
) {
  return ctx.transaction(async (tx) => {
    const [definition] = await tx
      .select()
      .from(promptDefinitions)
      .where(eq(promptDefinitions.id, definitionId))
      .for('update');
    if (!definition) return null;
    if ((definition.archivedAt !== null) === archived) return definition;

    if (archived) {
      const revisions = await tx
        .select({ id: promptRevisions.id })
        .from(promptRevisions)
        .where(eq(promptRevisions.promptDefinitionId, definitionId));
      const ids = revisions.map((row) => row.id);
      const blockers =
        ids.length === 0
          ? { defaultCount: 0, bindingCount: 0 }
          : {
              defaultCount: Number(
                (
                  await tx
                    .select({ value: count() })
                    .from(promptDefaults)
                    .where(inArray(promptDefaults.promptRevisionId, ids))
                )[0]?.value ?? 0,
              ),
              bindingCount: Number(
                (
                  await tx
                    .select({ value: count() })
                    .from(projectPromptBindings)
                    .where(inArray(projectPromptBindings.promptRevisionId, ids))
                )[0]?.value ?? 0,
              ),
            };
      if (blockers.defaultCount || blockers.bindingCount) {
        throw new PromptArchiveConflictError(blockers);
      }
    }

    const [updated] = await tx
      .update(promptDefinitions)
      .set({ archivedAt: archived ? new Date() : null })
      .where(eq(promptDefinitions.id, definitionId))
      .returning();
    return updated;
  });
}
```

- [ ] **Step 5: Run repository tests**

```bash
rtk pnpm test -- lib/prompts/__tests__/admin-repository.test.ts lib/prompts/__tests__/repository.test.ts
```

Expected: PASS; database-dependent cases use rollback isolation.

- [ ] **Step 6: Commit admin read model**

```bash
rtk git add lib/prompts/admin-types.ts lib/prompts/admin-repository.ts lib/prompts/__tests__/admin-repository.test.ts
rtk git commit -m "feat: add prompt admin read model"
```

---

### Task 3: Make registry APIs canonical and consistent

**Files:**

- Modify: `app/api/prompt-definitions/route.ts:1-85`
- Modify: `app/api/prompt-definitions/[id]/route.ts:1-145`
- Modify: `app/api/prompt-definitions/[id]/revisions/route.ts:1-75`
- Modify: `lib/__tests__/prompt-registry-routes.test.ts:1-110`

- [ ] **Step 1: Add failing route-contract tests**

Extend the route test to inspect canonical behavior:

```ts
import { readFileSync } from 'node:fs';

const root = new URL('../..', import.meta.url).pathname;

it('definition list delegates to bulk admin repository', () => {
  const source = readFileSync(`${root}/app/api/prompt-definitions/route.ts`, 'utf8');
  expect(source).toContain('listPromptDefinitionSummaries');
  expect(source).not.toContain('definitions.map(async');
});

it('definition detail exposes archive conflict counts', () => {
  const source = readFileSync(`${root}/app/api/prompt-definitions/[id]/route.ts`, 'utf8');
  expect(source).toContain('PromptArchiveConflictError');
  expect(source).toContain('defaultCount');
  expect(source).toContain('bindingCount');
  expect(source).toContain('status: 409');
});

it('revision duplicate labels return conflict', () => {
  const source = readFileSync(`${root}/app/api/prompt-definitions/[id]/revisions/route.ts`, 'utf8');
  expect(source).toContain('23505');
  expect(source).toContain('status: 409');
});
```

- [ ] **Step 2: Run route tests and verify red**

```bash
rtk pnpm test -- lib/__tests__/prompt-registry-routes.test.ts
```

Expected: FAIL on bulk repository, blocker payload, and `23505` mapping.

- [ ] **Step 3: Replace list N+1/default fan-out with one response**

Parse filters and return the admin repository result:

```ts
const archiveViewSchema = z.enum(['active', 'archived', 'all']);

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const kind = params.get('kind');
  const archiveResult = archiveViewSchema.safeParse(params.get('archive') ?? 'active');
  if (kind && !(promptKindValues as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: `invalid kind: ${kind}` }, { status: 400 });
  }
  if (!archiveResult.success) {
    return NextResponse.json(
      { error: 'archive must be active, archived, or all' },
      { status: 400 },
    );
  }

  return NextResponse.json(
    await listPromptDefinitionSummaries({
      kind: kind as PromptKind | undefined,
      archive: archiveResult.data,
    }),
  );
}
```

Keep current `POST` authorization and validation.

- [ ] **Step 4: Route definition detail and archive/restore through repository**

`GET` returns `getPromptDefinitionDetail(id)` or `404`. `PATCH` accepts either metadata fields or `archived`, not both in one request. Map blockers structurally:

```ts
if (parsed.data.archived !== undefined) {
  try {
    const updated = await setPromptDefinitionArchived(id, parsed.data.archived);
    if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof PromptArchiveConflictError) {
      return NextResponse.json({ error: error.message, blockers: error.blockers }, { status: 409 });
    }
    throw error;
  }
}
```

Metadata update writes only `name` and `description`; `kind` remains absent from schema.

- [ ] **Step 5: Map duplicate revision labels to `409`**

Before generic `500` in revision `POST` catch:

```ts
if ((error as { code?: string }).code === '23505') {
  return NextResponse.json(
    { error: 'versionLabel already exists for this definition' },
    { status: 409 },
  );
}
```

- [ ] **Step 6: Run API/repository tests and typecheck**

```bash
rtk pnpm test -- lib/__tests__/prompt-registry-routes.test.ts lib/prompts/__tests__/admin-repository.test.ts lib/prompts/__tests__/repository.test.ts
rtk pnpm typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit canonical API changes**

```bash
rtk git add app/api/prompt-definitions/route.ts app/api/prompt-definitions/'[id]'/route.ts app/api/prompt-definitions/'[id]'/revisions/route.ts lib/__tests__/prompt-registry-routes.test.ts
rtk git commit -m "feat: expose prompt registry admin API"
```

---

### Task 4: Build nine-kind `/generation` catalog

**Files:**

- Create: `lib/prompts/kinds.ts`
- Create: `components/prompts/prompt-kind-nav.tsx`
- Modify: `components/prompts/prompt-definition-list.tsx:1-105`
- Modify: `app/generation/page.tsx:1-170`
- Modify: `app/generation/[id]/page.tsx:9`
- Modify: `components/prompts/__tests__/prompt-registry-ui.test.tsx:1-50`

- [ ] **Step 1: Add failing kind-group and list rendering tests**

Use jsdom for component behavior:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CORE_PROMPT_KINDS, UTILITY_PROMPT_KINDS } from '@/lib/prompts/kinds';
import { PromptKindNav } from '@/components/prompts/prompt-kind-nav';
import { PromptDefinitionList } from '@/components/prompts/prompt-definition-list';
import { Tabs } from '@/components/ui/tabs';

it('groups exactly six Core and three Utility kinds', () => {
  expect(CORE_PROMPT_KINDS).toEqual([
    'assembly-planner',
    'assembly',
    'critique',
    'corrector',
    'generation-system',
    'meta-template',
  ]);
  expect(UTILITY_PROMPT_KINDS).toEqual(['title', 'placeholder-fill', 'editorial-brief-extractor']);
});

it('selects a Utility through More', async () => {
  const onChange = vi.fn();
  render(
    <Tabs value="assembly">
      <PromptKindNav value="assembly" onValueChange={onChange} />
    </Tabs>,
  );
  await userEvent.click(screen.getByRole('button', { name: /more/i }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Título' }));
  expect(onChange).toHaveBeenCalledWith('title');
});

it('shows exact older default and usage counts', () => {
  render(
    <PromptDefinitionList
      kind="assembly"
      definitions={[
        {
          id: 'def-1',
          name: 'Assembly',
          description: null,
          kind: 'assembly',
          archivedAt: null,
          latestRevision: { id: 'rev-2', versionLabel: '1.1', revisionNumber: 2 },
          defaultRevisionId: 'rev-1',
          defaultVersionLabel: '1.0',
          bindingCount: 3,
          executionCount: 12,
        },
      ]}
      onCreate={vi.fn()}
    />,
  );
  expect(screen.getByText('Default: v1.0')).toBeTruthy();
  expect(screen.getByText('3 proyectos')).toBeTruthy();
  expect(screen.getByText('12 ejecuciones')).toBeTruthy();
});
```

- [ ] **Step 2: Run UI test and verify red**

```bash
rtk pnpm test -- components/prompts/__tests__/prompt-registry-ui.test.tsx
```

Expected: FAIL because grouping/nav and usage fields do not exist.

- [ ] **Step 3: Create pure kind catalog**

```ts
import type { PromptKind } from '@/lib/db/schema/prompt-registry';

export const CORE_PROMPT_KINDS = [
  'assembly-planner',
  'assembly',
  'critique',
  'corrector',
  'generation-system',
  'meta-template',
] as const satisfies readonly PromptKind[];

export const UTILITY_PROMPT_KINDS = [
  'title',
  'placeholder-fill',
  'editorial-brief-extractor',
] as const satisfies readonly PromptKind[];

export const KIND_LABELS: Record<PromptKind, string> = {
  'assembly-planner': 'Planificador',
  assembly: 'Ensamblaje',
  critique: 'Crítica',
  corrector: 'Corrector',
  'generation-system': 'Sistema',
  'meta-template': 'Meta-prompt',
  title: 'Título',
  'placeholder-fill': 'Placeholders',
  'editorial-brief-extractor': 'Extractor editorial',
};

const ALL = new Set<PromptKind>([...CORE_PROMPT_KINDS, ...UTILITY_PROMPT_KINDS]);
export function parsePromptKind(value: string | null): PromptKind {
  return value && ALL.has(value as PromptKind) ? (value as PromptKind) : 'generation-system';
}
export function isUtilityKind(kind: PromptKind): boolean {
  return (UTILITY_PROMPT_KINDS as readonly PromptKind[]).includes(kind);
}
```

- [ ] **Step 4: Implement Core tabs plus `More` dropdown**

`PromptKindNav` renders `TabsList`, one `TabsTrigger` per Core kind, and a dropdown trigger whose label becomes the selected Utility label:

```tsx
export function PromptKindNav({
  value,
  onValueChange,
}: {
  value: PromptKind;
  onValueChange(kind: PromptKind): void;
}) {
  const utility = isUtilityKind(value);
  return (
    <TabsList className="flex-wrap h-auto gap-1">
      {CORE_PROMPT_KINDS.map((kind) => (
        <TabsTrigger key={kind} value={kind}>
          {KIND_LABELS[kind]}
        </TabsTrigger>
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant={utility ? 'secondary' : 'ghost'} size="sm">
            {utility ? KIND_LABELS[value] : 'More'} <ChevronDown className="ml-1 h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {UTILITY_PROMPT_KINDS.map((kind) => (
            <DropdownMenuItem key={kind} onSelect={() => onValueChange(kind)}>
              {KIND_LABELS[kind]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </TabsList>
  );
}
```

- [ ] **Step 5: Render exact default and usage on cards**

Import DTOs from `admin-types.ts`. Replace the latest-only default comparison with fields already returned by API:

```tsx
{def.defaultVersionLabel && <Badge>Default: v{def.defaultVersionLabel}</Badge>}
<Badge variant="outline">{def.bindingCount} proyectos</Badge>
<Badge variant="outline">{def.executionCount} ejecuciones</Badge>
{def.archivedAt && <Badge variant="destructive">Archivada</Badge>}
```

- [ ] **Step 6: Make page URL-driven and remove nine default requests**

Read `kind` and `archive` from `useSearchParams`. Fetch only:

```ts
const activeKind = parsePromptKind(searchParams.get('kind'));
const archive = searchParams.get('archive') === 'archived' ? 'archived' : 'active';

const res = await fetch(`/api/prompt-definitions?kind=${activeKind}&archive=${archive}`, {
  signal,
});
```

Update query state through one helper:

```ts
function replaceQuery(next: { kind?: PromptKind; archive?: 'active' | 'archived' }) {
  const params = new URLSearchParams(searchParams.toString());
  if (next.kind) params.set('kind', next.kind);
  if (next.archive === 'archived') params.set('archive', 'archived');
  if (next.archive === 'active') params.delete('archive');
  router.replace(`/generation?${params.toString()}`);
}
```

Use `PromptKindNav`, an Active/Archived toggle button, and the existing create dialog. Delete `fetchDefaults`, `defaults` state, and the loop over `promptKindValues`.

Move every `KIND_LABELS` import to `lib/prompts/kinds.ts`, including the detail page, so Task 4 passes typecheck before Task 5 begins. Move `PromptDefinitionSummary` imports to `lib/prompts/admin-types.ts`.

- [ ] **Step 7: Run UI tests and typecheck**

```bash
rtk pnpm test -- components/prompts/__tests__/prompt-registry-ui.test.tsx
rtk pnpm typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit catalog UI**

```bash
rtk git add lib/prompts/kinds.ts components/prompts/prompt-kind-nav.tsx components/prompts/prompt-definition-list.tsx components/prompts/__tests__/prompt-registry-ui.test.tsx app/generation/page.tsx app/generation/'[id]'/page.tsx
rtk git commit -m "feat: unify global prompt catalog"
```

---

### Task 5: Add definition actions, revision cloning, diff, and defaults

**Files:**

- Create: `components/prompts/revision-diff.tsx`
- Modify: `components/prompts/prompt-revision-editor.tsx:1-330`
- Modify: `app/generation/[id]/page.tsx:1-115`
- Modify: `components/prompts/__tests__/prompt-registry-ui.test.tsx`

- [ ] **Step 1: Add failing diff and create-from-revision tests**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { RevisionDiff } from '@/components/prompts/revision-diff';
import { PromptRevisionEditor } from '@/components/prompts/prompt-revision-editor';

it('marks removed and added draft lines', () => {
  render(<RevisionDiff before={'línea anterior\n'} after={'línea nueva\n'} />);
  expect(screen.getByText('línea anterior').getAttribute('data-change')).toBe('removed');
  expect(screen.getByText('línea nueva').getAttribute('data-change')).toBe('added');
});

it('creates a draft from the selected revision, not always latest', async () => {
  render(
    <PromptRevisionEditor
      definitionId="def-1"
      definitionName="Assembly"
      kind="assembly"
      archived={false}
      currentDefaultRevisionId="rev-2"
      revisions={[
        {
          id: 'rev-2',
          revisionNumber: 2,
          versionLabel: '1.1',
          systemTemplate: 'latest',
          userTemplate: 'latest user',
          requiredMarkers: [],
          outputContract: null,
          configuration: {},
          createdAt: '2026-07-14',
          createdBy: null,
          isDefault: true,
          bindingCount: 0,
          executionCount: 0,
        },
        {
          id: 'rev-1',
          revisionNumber: 1,
          versionLabel: '1.0',
          systemTemplate: 'chosen base',
          userTemplate: 'chosen user',
          requiredMarkers: [],
          outputContract: null,
          configuration: { temperature: 0 },
          createdAt: '2026-07-13',
          createdBy: null,
          isDefault: false,
          bindingCount: 0,
          executionCount: 0,
        },
      ]}
      onChanged={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Crear desde v1.0' }));
  expect((screen.getByLabelText('System Template') as HTMLTextAreaElement).value).toBe(
    'chosen base',
  );
  expect((screen.getByLabelText('User Template') as HTMLTextAreaElement).value).toBe('chosen user');
  expect((screen.getByLabelText('Configuración JSON') as HTMLTextAreaElement).value).toBe(
    '{\n  "temperature": 0\n}',
  );
});
```

- [ ] **Step 2: Run UI test and verify red**

```bash
rtk pnpm test -- components/prompts/__tests__/prompt-registry-ui.test.tsx
```

Expected: FAIL because diff, per-revision base action, and new props do not exist.

- [ ] **Step 3: Implement line diff component**

```tsx
import { diffLines } from 'diff';

export function RevisionDiff({ before, after }: { before: string; after: string }) {
  return (
    <pre className="whitespace-pre-wrap rounded border p-3 text-xs">
      {diffLines(before, after).map((part, index) => (
        <span
          key={`${index}-${part.value.length}`}
          data-change={part.added ? 'added' : part.removed ? 'removed' : 'same'}
          className={
            part.added
              ? 'bg-green-100 dark:bg-green-950'
              : part.removed
                ? 'bg-red-100 line-through dark:bg-red-950'
                : ''
          }
        >
          {part.value}
        </span>
      ))}
    </pre>
  );
}
```

- [ ] **Step 4: Change revision editor to explicit base selection**

Replace `initFromLatest()` with `openFromRevision(base: RevisionSummary | null)`. Store `baseRevisionId`, copy every editable snapshot field, and render a `Crear desde vX` button on each revision. The top-level create button passes `null` for a blank first revision.

Replace the component-local revision interface with this alias so editor and detail API cannot drift:

```ts
import type { PromptRevisionAdminSummary } from '@/lib/prompts/admin-types';
export type RevisionSummary = PromptRevisionAdminSummary;
```

Parse configuration before save:

```ts
function parseConfiguration(): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(configurationJson);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
```

Disable save when JSON is invalid. Send parsed configuration. Show `RevisionDiff` for system and user templates against the selected base before save. Keep arbitrary two-revision comparison as a separate action.

- [ ] **Step 5: Add exact default action per revision**

For executable active revisions:

```ts
async function setDefault(revisionId: string) {
  const res = await fetch(`/api/prompt-defaults/${kind}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ promptRevisionId: revisionId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    toast.error(body.error ?? 'No se pudo cambiar el default');
    return;
  }
  toast.success('Default actualizado');
  onChanged();
}
```

Render `Default` on the exact revision. Do not show `Set default` for `legacyNonExecutable` or archived definitions.

- [ ] **Step 6: Add metadata edit and archive/restore to detail page**

Use detail DTO from API. Metadata dialog sends only `{ name, description }`. Archive and restore send only `{ archived: true|false }`. On `409`, display structured blockers:

```ts
const body = await res.json().catch(() => ({}));
if (res.status === 409 && body.blockers) {
  toast.error(
    `No se puede archivar: ${body.blockers.defaultCount} defaults, ${body.blockers.bindingCount} bindings`,
  );
  return;
}
```

Use `ConfirmDialog` for archive. Restore requires no destructive confirmation. Refetch detail after metadata/default/archive/restore success.

- [ ] **Step 7: Run UI/API tests and typecheck**

```bash
rtk pnpm test -- components/prompts/__tests__/prompt-registry-ui.test.tsx lib/__tests__/prompt-registry-routes.test.ts lib/prompts/__tests__/admin-repository.test.ts
rtk pnpm typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit detail workflows**

```bash
rtk git add components/prompts/revision-diff.tsx components/prompts/prompt-revision-editor.tsx components/prompts/__tests__/prompt-registry-ui.test.tsx app/generation/'[id]'/page.tsx
rtk git commit -m "feat: manage prompt revision lifecycle"
```

---

### Task 6: Freeze legacy APIs, redirect pages, and retire manual assembly

**Files:**

- Create: `lib/api/legacy-prompt-gone.ts`
- Create: `lib/prompts/legacy-redirects.ts`
- Create: `lib/__tests__/legacy-prompt-cutover.test.ts`
- Modify: `app/api/prompt-library/route.ts`
- Modify: `app/api/prompt-library/[id]/route.ts`
- Modify: `app/api/meta-prompts/route.ts`
- Modify: `app/api/meta-prompts/[id]/route.ts`
- Modify: `app/api/generation-prompts/route.ts`
- Modify: `app/api/generation-prompts/[id]/route.ts`
- Modify: `app/prompt-library/page.tsx`
- Modify: `app/prompt-library/[id]/page.tsx`
- Modify: `app/meta-prompts/page.tsx`
- Modify: `app/meta-prompts/[id]/page.tsx`
- Modify: `components/patterns/sidebar.tsx:1-45`
- Delete: `scripts/assemble-chapter.ts`

- [ ] **Step 1: Add failing legacy cutover tests**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { legacyPromptGone } from '@/lib/api/legacy-prompt-gone';
import { legacyPromptLibraryTarget } from '@/lib/prompts/legacy-redirects';

const root = new URL('../..', import.meta.url).pathname;

describe('legacy prompt cutover', () => {
  it('returns 410 with canonical replacement', async () => {
    const response = legacyPromptGone();
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: 'Legacy prompt endpoint has been retired',
      replacement: '/generation',
    });
  });

  it('maps old library tabs to registry kinds', () => {
    expect(legacyPromptLibraryTarget('assembly')).toBe('/generation?kind=assembly');
    expect(legacyPromptLibraryTarget('critique')).toBe('/generation?kind=critique');
    expect(legacyPromptLibraryTarget('corrector')).toBe('/generation?kind=corrector');
    expect(legacyPromptLibraryTarget('invalid')).toBe('/generation?kind=assembly');
  });

  it('sidebar exposes one global prompt destination', () => {
    const source = readFileSync(`${root}/components/patterns/sidebar.tsx`, 'utf8');
    expect(source).toContain('{ href: "/generation", label: "Prompts"');
    expect(source).not.toContain('/prompt-library');
    expect(source).not.toContain('/meta-prompts');
  });

  it('manual legacy assembly script is absent', async () => {
    const { existsSync } = await import('node:fs');
    expect(existsSync(`${root}/scripts/assemble-chapter.ts`)).toBe(false);
  });
});
```

- [ ] **Step 2: Run cutover test and verify red**

```bash
rtk pnpm test -- lib/__tests__/legacy-prompt-cutover.test.ts
```

Expected: FAIL because helper modules do not exist and legacy surfaces remain.

- [ ] **Step 3: Implement shared `410 Gone` response**

```ts
import { NextResponse } from 'next/server';

export function legacyPromptGone() {
  return NextResponse.json(
    {
      error: 'Legacy prompt endpoint has been retired',
      replacement: '/generation',
    },
    { status: 410 },
  );
}
```

Replace every legacy API file with exports only. Example index:

```ts
import { legacyPromptGone } from '@/lib/api/legacy-prompt-gone';
export const GET = legacyPromptGone;
export const POST = legacyPromptGone;
```

Export methods matching each old file exactly:

- prompt-library/meta-prompts detail: `GET`, `PUT`, `DELETE`;
- generation-prompts detail: `GET`, `PATCH`, `DELETE`.

- [ ] **Step 4: Redirect legacy pages**

Create pure mapping:

```ts
export function legacyPromptLibraryTarget(tab?: string): string {
  const kind = tab === 'critique' || tab === 'corrector' ? tab : 'assembly';
  return `/generation?kind=${kind}`;
}
```

Prompt-library list page:

```tsx
import { redirect } from 'next/navigation';
import { legacyPromptLibraryTarget } from '@/lib/prompts/legacy-redirects';

export default async function LegacyPromptLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  redirect(legacyPromptLibraryTarget(tab));
}
```

Prompt-library detail redirects to `/generation`; both Meta-Prompt pages redirect to `/generation?kind=meta-template`.

- [ ] **Step 5: Collapse sidebar and delete one-off script**

Keep one item:

```ts
{ href: "/generation", label: "Prompts", icon: Sparkles },
```

Remove unused `Wand2` and `Puzzle` imports. Delete `scripts/assemble-chapter.ts` using `apply_patch`; do not replace it with another assembly entry point.

- [ ] **Step 6: Verify all legacy methods are data-independent**

Add this assertion to cutover test:

```ts
for (const path of [
  'app/api/prompt-library/route.ts',
  'app/api/prompt-library/[id]/route.ts',
  'app/api/meta-prompts/route.ts',
  'app/api/meta-prompts/[id]/route.ts',
  'app/api/generation-prompts/route.ts',
  'app/api/generation-prompts/[id]/route.ts',
]) {
  const source = readFileSync(`${root}/${path}`, 'utf8');
  expect(source).toContain('legacyPromptGone');
  expect(source).not.toContain('@/lib/db');
}
```

- [ ] **Step 7: Run cutover/UI tests and build check**

```bash
rtk pnpm test -- lib/__tests__/legacy-prompt-cutover.test.ts components/prompts/__tests__/prompt-registry-ui.test.tsx
rtk pnpm typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit legacy freeze**

```bash
rtk git add lib/api/legacy-prompt-gone.ts lib/prompts/legacy-redirects.ts lib/__tests__/legacy-prompt-cutover.test.ts app/api/prompt-library/route.ts app/api/prompt-library/'[id]'/route.ts app/api/meta-prompts/route.ts app/api/meta-prompts/'[id]'/route.ts app/api/generation-prompts/route.ts app/api/generation-prompts/'[id]'/route.ts app/prompt-library/page.tsx app/prompt-library/'[id]'/page.tsx app/meta-prompts/page.tsx app/meta-prompts/'[id]'/page.tsx components/patterns/sidebar.tsx scripts/assemble-chapter.ts
rtk git commit -m "refactor: freeze legacy prompt surfaces"
```

---

### Task 7: Snapshot, gate, and drop legacy prompt storage

**Files:**

- Create: `lib/__tests__/legacy-prompt-contraction-migration.test.ts`
- Create: `supabase/migrations/20260714000007_contract_legacy_prompt_storage.sql`
- Modify: `lib/db/schema/projects.ts:1-40`
- Modify: `lib/db/schema/index.ts:1-20`
- Modify: `lib/__tests__/prompt-transparency.test.ts:1-120`
- Delete: `lib/db/schema/prompt-library.ts`
- Delete: `lib/db/schema/meta-prompts.ts`
- Delete: `lib/db/schema/generation-prompts.ts`

- [ ] **Step 1: Write failing migration contract tests**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL(
    '../../supabase/migrations/20260714000007_contract_legacy_prompt_storage.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('legacy prompt contraction migration', () => {
  it('freezes every legacy source with a content hash before dropping', () => {
    for (const source of ['generation_system_prompts', 'meta_prompts', 'prompt_library']) {
      expect(sql).toContain(`'legacySource', '${source}'`);
      expect(sql).toContain(`FROM ${source}`);
    }
    expect(sql).toContain("'legacySourceHash'");
    expect(sql).toContain("'legacyNonExecutable', true");
  });

  it('gates generation-system parity by imported definition', () => {
    expect(sql).toContain("ppb.kind = 'generation-system'");
    expect(sql).toContain("md5('definition:generation_system_prompts:'");
    expect(sql).toContain('generation-system binding parity failed');
  });

  it('requires executable planner and assembler defaults', () => {
    expect(sql).toContain("IN ('assembly-planner', 'assembly')");
    expect(sql).toContain('assembly defaults parity failed');
  });

  it('drops project columns before referenced tables without cascade', () => {
    const assemblyColumn = sql.indexOf('DROP COLUMN IF EXISTS assembly_prompt_id');
    const libraryTable = sql.indexOf('DROP TABLE IF EXISTS prompt_library');
    expect(assemblyColumn).toBeGreaterThan(-1);
    expect(libraryTable).toBeGreaterThan(assemblyColumn);
    expect(sql).not.toMatch(/DROP TABLE[^;]+CASCADE/i);
  });
});
```

- [ ] **Step 2: Run migration test and verify missing-file failure**

```bash
rtk pnpm test -- lib/__tests__/legacy-prompt-contraction-migration.test.ts
```

Expected: FAIL because migration does not exist.

- [ ] **Step 3: Create final idempotent catch-up snapshots**

Start migration, reject unsupported categories, and insert any definition created after the original backfill:

```sql
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM prompt_library
    WHERE category NOT IN ('assembly', 'critique', 'corrector')
  ) THEN
    RAISE EXCEPTION 'unsupported prompt_library category';
  END IF;
END $$;

INSERT INTO prompt_definitions (id, kind, name, description)
SELECT md5('definition:generation_system_prompts:' || id::text)::uuid,
       'generation-system', name, description
FROM generation_system_prompts
ON CONFLICT (id) DO NOTHING;

INSERT INTO prompt_definitions (id, kind, name, description)
SELECT md5('definition:meta_prompts:' || id::text)::uuid,
       'meta-template', name, description
FROM meta_prompts
ON CONFLICT (id) DO NOTHING;

INSERT INTO prompt_definitions (id, kind, name, description)
SELECT md5('definition:prompt_library:' || id::text)::uuid,
       category, name, description
FROM prompt_library
ON CONFLICT (id) DO NOTHING;
```

Compute a complete row hash and insert one immutable historical revision for every generation-system row:

```sql
WITH frozen AS (
  SELECT
    gsp.*,
    md5(concat_ws(E'\x1f', gsp.id::text, gsp.name,
      coalesce(gsp.description, ''), gsp.content, gsp.is_default::text)) AS source_hash
  FROM generation_system_prompts gsp
)
INSERT INTO prompt_revisions (
  id, prompt_definition_id, revision_number, version_label,
  system_template, user_template, required_markers, output_contract, configuration
)
SELECT
  md5('legacy-cutover:generation_system_prompts:' || id::text || ':' || source_hash)::uuid,
  md5('definition:generation_system_prompts:' || id::text)::uuid,
  (SELECT coalesce(max(pr.revision_number), 0) + 1
   FROM prompt_revisions pr
   WHERE pr.prompt_definition_id = md5('definition:generation_system_prompts:' || frozen.id::text)::uuid),
  'legacy-cutover-' || source_hash,
  content,
  '',
  '[]'::jsonb,
  NULL,
  jsonb_build_object(
    'legacySource', 'generation_system_prompts',
    'legacyNonExecutable', true,
    'legacyCutover', true,
    'legacySourceHash', source_hash,
    'legacyName', name,
    'legacyDescription', description
  )
FROM frozen
ON CONFLICT (id) DO NOTHING;
```

Insert the complete frozen Meta-Prompt rows:

```sql
WITH frozen AS (
  SELECT
    mp.*,
    md5(concat_ws(E'\x1f', mp.id::text, mp.name,
      coalesce(mp.description, ''), mp.content,
      coalesce(mp.user_prompt, ''))) AS source_hash
  FROM meta_prompts mp
)
INSERT INTO prompt_revisions (
  id, prompt_definition_id, revision_number, version_label,
  system_template, user_template, required_markers, output_contract, configuration
)
SELECT
  md5('legacy-cutover:meta_prompts:' || id::text || ':' || source_hash)::uuid,
  md5('definition:meta_prompts:' || id::text)::uuid,
  (SELECT coalesce(max(pr.revision_number), 0) + 1
   FROM prompt_revisions pr
   WHERE pr.prompt_definition_id = md5('definition:meta_prompts:' || frozen.id::text)::uuid),
  'legacy-cutover-' || source_hash,
  content,
  coalesce(user_prompt, ''),
  '[]'::jsonb,
  NULL,
  jsonb_build_object(
    'legacySource', 'meta_prompts',
    'legacyNonExecutable', true,
    'legacyCutover', true,
    'legacySourceHash', source_hash,
    'legacyName', name,
    'legacyDescription', description
  )
FROM frozen
ON CONFLICT (id) DO NOTHING;
```

Insert the complete frozen Prompt Library rows:

```sql
WITH frozen AS (
  SELECT
    pl.*,
    md5(concat_ws(E'\x1f', pl.id::text, pl.category, pl.name,
      coalesce(pl.description, ''), pl.content,
      coalesce(pl.user_prompt, ''))) AS source_hash
  FROM prompt_library pl
)
INSERT INTO prompt_revisions (
  id, prompt_definition_id, revision_number, version_label,
  system_template, user_template, required_markers, output_contract, configuration
)
SELECT
  md5('legacy-cutover:prompt_library:' || id::text || ':' || source_hash)::uuid,
  md5('definition:prompt_library:' || id::text)::uuid,
  (SELECT coalesce(max(pr.revision_number), 0) + 1
   FROM prompt_revisions pr
   WHERE pr.prompt_definition_id = md5('definition:prompt_library:' || frozen.id::text)::uuid),
  'legacy-cutover-' || source_hash,
  content,
  coalesce(user_prompt, ''),
  '[]'::jsonb,
  NULL,
  jsonb_build_object(
    'legacySource', 'prompt_library',
    'legacyNonExecutable', true,
    'legacyCutover', true,
    'legacySourceHash', source_hash,
    'legacyName', name,
    'legacyDescription', description,
    'legacyCategory', category
  )
FROM frozen
ON CONFLICT (id) DO NOTHING;
```

Do not update canonical definitions, defaults, or bindings.

- [ ] **Step 4: Add three fail-closed parity gates**

Generation-system definition parity:

```sql
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM projects p
    LEFT JOIN project_prompt_bindings ppb
      ON ppb.project_id = p.id AND ppb.kind = 'generation-system'
    LEFT JOIN prompt_revisions pr ON pr.id = ppb.prompt_revision_id
    LEFT JOIN prompt_definitions pd ON pd.id = pr.prompt_definition_id
    WHERE p.generation_system_prompt_id IS NOT NULL
      AND (
        ppb.project_id IS NULL
        OR pd.id IS DISTINCT FROM md5(
          'definition:generation_system_prompts:' || p.generation_system_prompt_id::text
        )::uuid
        OR pd.archived_at IS NOT NULL
        OR coalesce(pr.configuration->>'legacyNonExecutable', 'false') = 'true'
      )
  ) THEN
    RAISE EXCEPTION 'generation-system binding parity failed';
  END IF;
END $$;
```

Assembly default parity:

```sql
DO $$
BEGIN
  IF (
    SELECT count(DISTINCT defaults.kind)
    FROM prompt_defaults defaults
    JOIN prompt_revisions revisions ON revisions.id = defaults.prompt_revision_id
    JOIN prompt_definitions definitions ON definitions.id = revisions.prompt_definition_id
    WHERE defaults.kind IN ('assembly-planner', 'assembly')
      AND definitions.kind = defaults.kind
      AND definitions.archived_at IS NULL
      AND coalesce(revisions.configuration->>'legacyNonExecutable', 'false') <> 'true'
  ) <> 2 THEN
    RAISE EXCEPTION 'assembly defaults parity failed';
  END IF;
END $$;
```

Historical preservation parity uses the same complete hashes:

```sql
DO $$
BEGIN
  IF EXISTS (
    WITH expected AS (
      SELECT
        md5('definition:generation_system_prompts:' || gsp.id::text)::uuid AS definition_id,
        'generation-system'::text AS expected_kind,
        md5(concat_ws(E'\x1f', gsp.id::text, gsp.name,
          coalesce(gsp.description, ''), gsp.content, gsp.is_default::text)) AS source_hash
      FROM generation_system_prompts gsp
      UNION ALL
      SELECT
        md5('definition:meta_prompts:' || mp.id::text)::uuid,
        'meta-template'::text,
        md5(concat_ws(E'\x1f', mp.id::text, mp.name,
          coalesce(mp.description, ''), mp.content, coalesce(mp.user_prompt, '')))
      FROM meta_prompts mp
      UNION ALL
      SELECT
        md5('definition:prompt_library:' || pl.id::text)::uuid,
        pl.category,
        md5(concat_ws(E'\x1f', pl.id::text, pl.category, pl.name,
          coalesce(pl.description, ''), pl.content, coalesce(pl.user_prompt, '')))
      FROM prompt_library pl
    )
    SELECT 1
    FROM expected e
    LEFT JOIN prompt_definitions pd ON pd.id = e.definition_id
    WHERE pd.id IS NULL
       OR pd.kind IS DISTINCT FROM e.expected_kind
       OR NOT EXISTS (
         SELECT 1
         FROM prompt_revisions pr
         WHERE pr.prompt_definition_id = e.definition_id
           AND pr.configuration->>'legacySourceHash' = e.source_hash
           AND pr.configuration->>'legacyNonExecutable' = 'true'
       )
  ) THEN
    RAISE EXCEPTION 'legacy prompt snapshot parity failed';
  END IF;
END $$;
```

- [ ] **Step 5: Drop legacy columns and tables in FK order**

End migration:

```sql
ALTER TABLE projects
  DROP COLUMN IF EXISTS assembly_prompt_id,
  DROP COLUMN IF EXISTS generation_system_prompt_id;

DROP TABLE IF EXISTS prompt_library;
DROP TABLE IF EXISTS meta_prompts;
DROP TABLE IF EXISTS generation_system_prompts;

COMMIT;
```

- [ ] **Step 6: Remove legacy Drizzle schema after APIs are data-independent**

In `projects.ts`, remove imports for prompt-library/generation-prompts and both fields. In `schema/index.ts`, remove three exports. Delete three legacy schema modules using `apply_patch`.

Do not remove deprecated request-key rejection from project APIs. Do not remove historical `generationMetadata.assemblyPromptId`; it is JSON history, not a project FK or runtime read.

- [ ] **Step 7: Extend static transparency audit**

Add production-source assertions:

```ts
it('has no production reads of legacy prompt storage', () => {
  const violations = rg(
    'from\\((promptLibrary|metaPrompts|generationSystemPrompts)\\)|' +
      'projects\\.(assemblyPromptId|generationSystemPromptId)|' +
      'FROM prompt_library|FROM meta_prompts|FROM generation_system_prompts',
    ['app', 'components', 'lib', 'trigger', 'scripts'],
  )
    .split('\n')
    .filter(Boolean)
    .filter((line) => !line.includes('__tests__'));
  expect(violations).toEqual([]);
});
```

The explicit filter excludes tests. Paths do not include immutable migration SQL.

- [ ] **Step 8: Run migration, audit, and schema tests**

```bash
rtk pnpm test -- lib/__tests__/legacy-prompt-contraction-migration.test.ts lib/__tests__/legacy-prompt-cutover.test.ts lib/__tests__/prompt-transparency.test.ts lib/__tests__/prompt-registry-migration.test.ts
rtk pnpm typecheck
```

Expected: PASS.

On a disposable database with `TEST_DATABASE_URL` set:

```bash
rtk env DATABASE_URL="$TEST_DATABASE_URL" pnpm db:migrate
```

Expected: `20260714000007_contract_legacy_prompt_storage.sql` applies successfully; second run reports it already applied.

- [ ] **Step 9: Commit contraction**

```bash
rtk git add supabase/migrations/20260714000007_contract_legacy_prompt_storage.sql lib/__tests__/legacy-prompt-contraction-migration.test.ts lib/__tests__/prompt-transparency.test.ts lib/db/schema/projects.ts lib/db/schema/index.ts lib/db/schema/prompt-library.ts lib/db/schema/meta-prompts.ts lib/db/schema/generation-prompts.ts
rtk git commit -m "refactor: remove legacy prompt storage"
```

---

### Task 8: Final regression and acceptance verification

**Files:**

- Modify only when a failing check reveals a defect in files already owned by Tasks 1-7.

- [ ] **Step 1: Run focused feature suite**

```bash
rtk pnpm test -- lib/prompts/__tests__/repository.test.ts lib/prompts/__tests__/admin-repository.test.ts lib/__tests__/prompt-registry-routes.test.ts components/prompts/__tests__/prompt-registry-ui.test.tsx lib/__tests__/legacy-prompt-cutover.test.ts lib/__tests__/legacy-prompt-contraction-migration.test.ts lib/__tests__/prompt-transparency.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run assembly and content-generation regression suite**

```bash
rtk pnpm test -- lib/prompts/__tests__/chapter-executor.test.ts lib/prompts/__tests__/executor.test.ts lib/assembly/__tests__ trigger/__tests__/generate-template.test.ts
```

Expected: PASS. No planner, assembler, content, critique, corrector, title, placeholder-fill, or editorial-brief execution may resolve a legacy table.

- [ ] **Step 3: Run static legacy audit**

```bash
rtk rg -n 'from\((promptLibrary|metaPrompts|generationSystemPrompts)\)|projects\.(assemblyPromptId|generationSystemPromptId)|SELECT .*assembly_prompt_id|FROM (prompt_library|meta_prompts|generation_system_prompts)' app components lib trigger scripts --glob '!**/__tests__/**' --glob '!**/*.test.*'
```

Expected: no matches.

```bash
rtk rg -n 'href: "/(prompt-library|meta-prompts)"|fetch\("/api/(prompt-library|meta-prompts|generation-prompts)' app components lib trigger scripts --glob '!**/__tests__/**' --glob '!**/*.test.*'
```

Expected: no matches.

- [ ] **Step 4: Run complete quality gate**

```bash
rtk pnpm test
rtk pnpm typecheck
rtk pnpm lint
rtk pnpm build
rtk git diff --check
```

Expected: every command exits `0`.

- [ ] **Step 5: Smoke-test visible acceptance behavior**

Run:

```bash
rtk pnpm dev
```

Verify:

1. `/generation?kind=assembly` shows Core tabs, exact default version, project bindings, and execution attempts.
2. `More -> Título` changes URL to `/generation?kind=title` and survives reload.
3. Creating from an older revision copies that exact revision and previews system/user changes.
4. Setting default changes only exact default badge.
5. Archive with active default/binding reports blocker counts; archive after moving blockers succeeds; restore succeeds.
6. `/prompt-library?tab=critique` redirects to `/generation?kind=critique`.
7. `/meta-prompts` redirects to `/generation?kind=meta-template`.
8. Legacy API request returns `410` and `/generation` replacement.
9. A chapter generation resolves project `generation-system` binding when local prompt has no `userPrompt`.
10. Planner and assembler resolve registry revisions and complete normally.

- [ ] **Step 6: Close any verification failure in its owning task**

If Step 4 or 5 fails, return to the Task 1-7 test that owns that behavior, add the smallest regression assertion, patch only that task's listed files, rerun its focused command, and use its exact `git add` scope. Then rerun Task 8 from Step 1. Do not create a catch-all or empty commit.

---

## Acceptance checklist

- [ ] `/generation` manages all nine global prompt kinds.
- [ ] Core/Utilities grouping matches approved taxonomy.
- [ ] Definition metadata, immutable revisions, defaults, usage, archive, and restore work.
- [ ] Default badge identifies an older exact revision correctly.
- [ ] New revisions never switch defaults implicitly.
- [ ] Archived definitions cannot revise, bind, default, or execute.
- [ ] Template/project chapter prompts remain in their existing contextual surfaces.
- [ ] Legacy pages redirect and legacy APIs return `410` without DB access.
- [ ] `scripts/assemble-chapter.ts` is removed before DB contraction.
- [ ] Late legacy writes are preserved as hash-addressed historical snapshots.
- [ ] Generation-system project bindings pass definition-level parity.
- [ ] Assembly planner/assembler defaults pass executable-active parity.
- [ ] Legacy project columns and tables are physically absent.
- [ ] No runtime/source read references legacy storage.
- [ ] Full tests, typecheck, lint, and production build pass.
