# Source Contamination Stage D: Legacy Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inventory legacy contamination safely, regenerate templates under v2 with new IDs, clone affected projects onto clean templates without generated content, and preserve complete audit history.

**Architecture:** Read-only audit classifies every template from immutable lineage and hash-only detector reports. Mutating CLI workflows use an operation ledger with caller-supplied UUIDs and immutable input hashes, making retries idempotent. Remediation creates new template/project graphs in transactions; old graphs remain read-only and linked through replacement metadata.

**Tech Stack:** TypeScript/tsx CLI, Next.js 15, Drizzle/PostgreSQL, Trigger.dev 4, Zod, Vitest, existing EditorialBrief/source repositories.

---

## Dependencies and delivery boundary

- Run after Stage C: `docs/superpowers/plans/2026-07-22-source-contamination-stage-c-downstream-enforcement.md`
- Approved design: `docs/superpowers/specs/2026-07-22-generic-source-contamination-prevention-design.md`
- No workflow deletes, edits, or rebases a legacy template/project.
- Template source recovery from historical execution messages requires explicit `--allow-execution-source`; normal regeneration requires source files.
- Project clone copies user input sources, not template source profiles, execution messages, definitions, fragments, assemblies, critiques, or corrections.

## File map

- Create `supabase/migrations/20260722000003_add_remediation_lineage.sql`: operation ledger and replacement project FK.
- Create `lib/db/schema/pipeline-maintenance.ts`; modify projects/schema index.
- Create `lib/remediation/contracts.ts`: classification, operation, report, and CLI input schemas.
- Create `lib/remediation/operations.ts`: immutable operation-ID acquisition/completion/failure.
- Rewrite `scripts/audit-contamination.ts`: generic dry-run inventory without snippets.
- Create `lib/remediation/audit.ts`: data collection and classification.
- Create `scripts/regenerate-template.ts` and `lib/remediation/regenerate-template.ts`.
- Create `scripts/clone-project-to-clean-template.ts` and `lib/remediation/clone-project.ts`.
- Modify `trigger/generate-template.ts`: complete regeneration operation when run finalizes.
- Modify project/template APIs and UI: read-only notices and replacement links.
- Modify `package.json`: exact audit/regenerate/clone commands.
- Add migration, audit, idempotency, regeneration, clone, incident, and UI tests.

### Task 1: Add remediation operation ledger and replacement lineage

**Files:**

- Create: `lib/__tests__/remediation-migration.test.ts`
- Create: `supabase/migrations/20260722000003_add_remediation_lineage.sql`
- Create: `lib/db/schema/pipeline-maintenance.ts`
- Modify: `lib/db/schema/projects.ts:9`
- Modify: `lib/db/schema/index.ts:1`

- [ ] **Step 1: Write failing migration tests**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../../supabase/migrations/20260722000003_add_remediation_lineage.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("remediation lineage migration", () => {
  it("creates immutable idempotency ledger", () => {
    expect(sql).toContain("CREATE TABLE pipeline_maintenance_operations");
    expect(sql).toContain("input_hash text NOT NULL");
    expect(sql).toContain("kind IN ('template_regeneration', 'project_clone')");
    expect(sql).toContain("status IN ('running', 'completed', 'failed')");
  });

  it("links a replacement project without cascading deletion", () => {
    expect(sql).toContain("projects ADD COLUMN supersedes_project_id");
    expect(sql).toContain("REFERENCES projects(id) ON DELETE RESTRICT");
    expect(sql).toContain("UNIQUE INDEX uq_projects_supersedes_project");
  });
});
```

- [ ] **Step 2: Run and verify missing migration**

Run: `rtk pnpm test -- lib/__tests__/remediation-migration.test.ts`

Expected: FAIL with `ENOENT`.

- [ ] **Step 3: Create migration**

```sql
CREATE TABLE pipeline_maintenance_operations (
  id uuid PRIMARY KEY,
  kind text NOT NULL,
  input_hash text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  result_template_id uuid REFERENCES book_templates(id) ON DELETE RESTRICT,
  result_project_id uuid REFERENCES projects(id) ON DELETE RESTRICT,
  report jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT chk_pipeline_maintenance_kind
    CHECK (kind IN ('template_regeneration', 'project_clone')),
  CONSTRAINT chk_pipeline_maintenance_status
    CHECK (status IN ('running', 'completed', 'failed')),
  CONSTRAINT chk_pipeline_maintenance_result CHECK (
    (kind = 'template_regeneration' AND result_project_id IS NULL)
    OR (kind = 'project_clone' AND result_template_id IS NULL)
  )
);

ALTER TABLE projects
  ADD COLUMN supersedes_project_id uuid
  REFERENCES projects(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX uq_projects_supersedes_project
  ON projects(supersedes_project_id)
  WHERE supersedes_project_id IS NOT NULL;

ALTER TABLE pipeline_maintenance_operations ENABLE ROW LEVEL SECURITY;
```

Restrict operation rows to service/admin access. Ordinary users learn replacement IDs through project/template APIs, not ledger access.

- [ ] **Step 4: Add matching Drizzle schema**

Use literal `kind`/`status` types, typed report JSON, nullable result IDs, and `projects.supersedesProjectId`.

- [ ] **Step 5: Run and commit**

Run: `rtk pnpm test -- lib/__tests__/remediation-migration.test.ts`

Expected: PASS.

```bash
rtk git add supabase/migrations/20260722000003_add_remediation_lineage.sql lib/db/schema lib/__tests__/remediation-migration.test.ts
rtk git commit -m "feat: add remediation lineage"
```

### Task 2: Implement immutable operation idempotency

**Files:**

- Create: `lib/remediation/contracts.ts`
- Create: `lib/remediation/operations.ts`
- Create: `lib/remediation/__tests__/operations.test.ts`

- [ ] **Step 1: Write failing operation tests**

```ts
it("returns completed result for same operation ID and input hash", async () => {
  repository.find.mockResolvedValue(completedOperation);
  await expect(beginMaintenanceOperation(sameInput))
    .resolves.toEqual({ state: "completed", operation: completedOperation });
});

it("rejects operation ID reuse with different inputs", async () => {
  repository.find.mockResolvedValue(completedOperation);
  await expect(beginMaintenanceOperation(changedInput))
    .rejects.toMatchObject({ name: "OperationInputConflictError" });
});
```

Cover new insert, concurrent unique conflict reread, running resume, completed
return, same-input failed-to-running retry, wrong kind, complete-once, and safe
report content.

- [ ] **Step 2: Run and verify missing service**

Run: `rtk pnpm test -- lib/remediation/__tests__/operations.test.ts`

Expected: FAIL because operation modules are absent.

- [ ] **Step 3: Define canonical operation inputs**

```ts
export const regenerationInputSchema = z.object({
  operationId: z.string().uuid(),
  legacyTemplateId: z.string().uuid(),
  sourceHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1),
  rhetoricTraceRevisionId: z.string().uuid(),
  sourceProfilerRevisionId: z.string().uuid(),
  compilerHash: z.string().regex(/^[a-f0-9]{64}$/),
  policyVersion: z.string().min(1),
}).strict();

export const cloneInputSchema = z.object({
  operationId: z.string().uuid(),
  legacyProjectId: z.string().uuid(),
  cleanTemplateId: z.string().uuid(),
  legacyProjectStateHash: z.string().regex(/^[a-f0-9]{64}$/),
  cleanTemplateArtifactSetHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
```

Compute `inputHash = sha256Canonical(parsedInputWithoutOperationId)`.

- [ ] **Step 4: Implement acquire/complete/fail operations**

```ts
export type BeginOperationResult =
  | { state: "new"; operation: MaintenanceOperation }
  | { state: "running"; operation: MaintenanceOperation }
  | { state: "completed"; operation: MaintenanceOperation };
```

`beginMaintenanceOperation` inserts once, catches unique violation, rereads, compares kind/hash, and returns stable state. `completeMaintenanceOperation` updates only `status = running`; if zero rows update, reread and accept only the same completed result. Reports contain counts, hashes, IDs, and codes only.

For a same-kind/same-hash failed row, the next explicit CLI invocation atomically
changes `failed` back to `running` and returns `state = running`. Different input
fails before mutation.

- [ ] **Step 5: Run and commit**

Run: `rtk pnpm test -- lib/remediation/__tests__/operations.test.ts`

Expected: PASS.

```bash
rtk git add lib/remediation/contracts.ts lib/remediation/operations.ts lib/remediation/__tests__/operations.test.ts
rtk git commit -m "feat: make remediation idempotent"
```

### Task 3: Replace static audit with generic lineage audit

**Files:**

- Rewrite: `scripts/audit-contamination.ts:1`
- Create: `lib/remediation/audit.ts`
- Create: `lib/remediation/__tests__/audit.test.ts`
- Modify: `package.json:5`

- [ ] **Step 1: Write failing audit classifications**

```ts
it.each([
  [cleanV2Fixture(), "clean_v2"],
  [legacyWithoutSourceFixture(), "legacy_unverified"],
  [legacySemanticSignalFixture(), "suspect"],
  [legacyStrongSignalFixture(), "contaminated"],
])("classifies fixture", async (fixture, expected) => {
  expect((await auditTemplate(fixture.id)).classification).toBe(expected);
});

it("never returns snippets, source labels, or raw regex patterns", async () => {
  const report = await auditTemplate(legacyStrongSignalFixture().id);
  const serialized = JSON.stringify(report);
  expect(serialized).not.toContain("snippet");
  expect(serialized).not.toContain("canonicalLabel");
  expect(serialized).not.toContain("\\\\b");
});
```

Also verify derived project IDs/counts, revision IDs, execution/source recoverability flags, generation counts, and recommended action.

- [ ] **Step 2: Run and verify old audit leakage**

Run: `rtk pnpm test -- lib/remediation/__tests__/audit.test.ts`

Expected: FAIL because current script is James-specific and prints snippets/patterns.

- [ ] **Step 3: Implement classification**

Classification precedence:

```ts
if (hasSupportedCleanActiveRun) return "clean_v2";
if (strongSignals.length > 0) return "contaminated";
if (probabilisticSignals.length > 0) return "suspect";
return "legacy_unverified";
```

Scan all persisted template fields: prompt title/content/userPrompt/function/sourceContext/notes and placeholder name/function. Use existing assessments when present. For legacy rows without source profiles, run baseline deterministic rules only and report whether historical executions appear source-recoverable without reading source content.

- [ ] **Step 4: Implement read-only CLI**

Accepted args:

```text
--dry-run
--template-id UUID
--json
```

`--dry-run` is required even though command is read-only, making intent explicit. Default output columns:

```text
template_id | name | classification | pipeline | source | projects | generations | action
```

JSON output follows the safe report schema. Remove `extractSnippet`.

- [ ] **Step 5: Add package script and run**

```json
"audit:template-contamination": "tsx scripts/audit-contamination.ts"
```

Run: `rtk pnpm audit:template-contamination -- --dry-run --json`

Expected: valid JSON report; no database writes.

- [ ] **Step 6: Commit**

```bash
rtk git add scripts/audit-contamination.ts lib/remediation/audit.ts lib/remediation/__tests__/audit.test.ts package.json
rtk git commit -m "feat: audit template contamination"
```

### Task 4: Implement clean template regeneration

**Files:**

- Create: `scripts/regenerate-template.ts`
- Create: `lib/remediation/regenerate-template.ts`
- Create: `lib/remediation/__tests__/regenerate-template.test.ts`
- Modify: `trigger/generate-template.ts`
- Modify: `package.json:5`

- [ ] **Step 1: Write failing dry-run/idempotency tests**

```ts
it("dry-run validates and plans without writes or enqueue", async () => {
  const result = await planTemplateRegeneration(validInput);
  expect(result).toMatchObject({
    dryRun: true,
    legacyTemplateId,
    chapterCount: 2,
    sourceHashes: expect.arrayContaining([expect.stringMatching(/^[a-f0-9]{64}$/)]),
  });
  expect(db.insert).not.toHaveBeenCalled();
  expect(generateTemplate.trigger).not.toHaveBeenCalled();
});

it("same completed operation returns the original new template ID", async () => {
  await expect(regenerateTemplate(sameOperationInput))
    .resolves.toMatchObject({ templateId: firstResultTemplateId });
  expect(createdTemplateCount()).toBe(1);
});
```

Cover source file count/order, explicit historical recovery flag, changed hash conflict, incompatible revisions, clean compiler/policy versions, queue failure cleanup, and old template immutability.

- [ ] **Step 2: Run and verify missing workflow**

Run: `rtk pnpm test -- lib/remediation/__tests__/regenerate-template.test.ts`

Expected: FAIL because regeneration modules are absent.

- [ ] **Step 3: Parse and validate CLI**

Accepted modes:

```text
rtk pnpm regenerate:template -- \
  --template-id UUID \
  --source-dir ABSOLUTE_PATH \
  --operation-id UUID \
  [--dry-run]
```

or explicit recovery:

```text
rtk pnpm regenerate:template -- \
  --template-id UUID \
  --allow-execution-source \
  --operation-id UUID \
  [--dry-run]
```

Require exactly one source mode. Source directory files sort lexicographically and must equal legacy template chapter count. Historical recovery reads only execution markers linked to the exact legacy template/revisions, validates one source per chapter, hashes immediately, and never writes a new raw copy.

- [ ] **Step 4: Create replacement template/run atomically**

After `beginMaintenanceOperation` returns `new`:

1. insert new template named `${legacy.name} (clean v2)` with `generating`;
2. insert new template chapters preserving positions/titles;
3. insert new v2 pipeline run referencing replacement template;
4. store legacy template ID and operation ID in both run report and operation
   report;
5. commit;
6. enqueue safe Stage B task with explicit source/profile/trace revisions.

Never copy legacy prompts/placeholders.

- [ ] **Step 5: Complete operation from template finalizer**

When Stage B finalization marks the run clean, update the linked maintenance operation:

```ts
await completeMaintenanceOperation({
  operationId,
  resultTemplateId: templateId,
  report: {
    legacyTemplateId,
    pipelineRunId,
    artifactSetHash,
    chapterCount,
  },
});
```

If task reaches terminal failed/quarantined state, mark operation failed with stage/code/hashes. Retrying same operation resumes the same template/run; it never creates another ID.

- [ ] **Step 6: Add package script, run, and commit**

```json
"regenerate:template": "tsx scripts/regenerate-template.ts"
```

Run dry-run against a synthetic fixture:

`rtk pnpm regenerate:template -- --template-id 00000000-0000-4000-8000-000000000001 --source-dir /tmp/redactor-safe-source-fixture --operation-id 00000000-0000-4000-8000-000000000002 --dry-run`

Expected: plan report or `template not found`; zero mutation.

```bash
rtk git add scripts/regenerate-template.ts lib/remediation/regenerate-template.ts lib/remediation/__tests__/regenerate-template.test.ts trigger/generate-template.ts package.json
rtk git commit -m "feat: regenerate clean templates"
```

### Task 5: Clone project inputs onto clean template

**Files:**

- Create: `scripts/clone-project-to-clean-template.ts`
- Create: `lib/remediation/clone-project.ts`
- Create: `lib/remediation/__tests__/clone-project.test.ts`
- Modify: `lib/editorial-brief/hash.ts`
- Modify: `package.json:5`

- [ ] **Step 1: Write failing clone-boundary tests**

```ts
it("copies inputs and configuration but no generated content", async () => {
  const result = await cloneProjectToCleanTemplate(validCloneInput);
  expect(result.newProject.supersedesProjectId).toBe(legacyProject.id);
  expect(result.counts).toMatchObject({
    chapters: cleanTemplate.chapters.length,
    sources: legacyProject.sources.length,
    fragments: 0,
    generations: 0,
    definitions: 0,
  });
});

it("remaps brief chapter and source IDs then recomputes hashes", async () => {
  const bundle = await loadApprovedEditorialBundle(newProject.id);
  expect(bundle.contracts.map(contract => contract.chapterId))
    .toEqual(newProject.chapterIds);
  expect(bundle.evidenceSourceIds).toEqual(newProject.sourceIds);
  expect(bundle.hash).not.toBe(legacyBundle.hash);
});
```

Also test dry-run, same-operation result, target not clean/eligible, owner mismatch, chapter-count mismatch, incompatible prompt binding, source/chunk remapping, and no copy of template profiles/executions.

- [ ] **Step 2: Run and verify missing clone workflow**

Run: `rtk pnpm test -- lib/remediation/__tests__/clone-project.test.ts`

Expected: FAIL because clone service is absent.

- [ ] **Step 3: Compute dry-run compatibility plan**

Accepted CLI:

```text
rtk pnpm clone:project-to-clean-template -- \
  --project-id UUID \
  --template-id UUID \
  --operation-id UUID \
  [--dry-run]
```

Parse UUIDs with Zod. Dry-run performs all reads and compatibility checks below,
but does not acquire an operation row or open a write transaction.

Validate:

- legacy project references a template and is blocked/legacy;
- clean template passes `isTemplateEligible`;
- both templates have equal chapter count and unique positions;
- old/new chapters map by position;
- project prompt bindings resolve to active compatible prompt kinds;
- every approved brief contract maps to one new chapter;
- every evidence source belongs to legacy project.

Return counts, mappings as hashes/counts, warnings, and operation input hash. Do not expose source/profile prose.

- [ ] **Step 4: Clone in one transaction**

Order:

1. lock operation, legacy project, and clean template;
2. insert new project with `${legacy.name} (clean)` and `supersedesProjectId`;
3. copy clean template chapters/prompts/placeholders using existing copy helper;
4. copy project topic and leave manuscript title/subtitle null;
5. copy user `sources` with new IDs;
6. copy `source_chunks` with new source/project IDs and existing embeddings;
7. copy compatible project prompt bindings;
8. remap approved brief contract chapter IDs;
9. remap evidence source IDs and `editorial_brief_sources`;
10. recompute content, contract, and bundle hashes;
11. insert the remapped brief as approved with original semantic content;
12. complete maintenance operation with new project ID;
13. commit.

Explicitly query/assert zero inserts into `fragments`, legacy `chapter_generations`, definitions, critiques, corrections, template profiles, and execution tables.

- [ ] **Step 5: Add package script and commit**

```json
"clone:project-to-clean-template": "tsx scripts/clone-project-to-clean-template.ts"
```

```bash
rtk git add scripts/clone-project-to-clean-template.ts lib/remediation/clone-project.ts lib/remediation/__tests__/clone-project.test.ts lib/editorial-brief/hash.ts package.json
rtk git commit -m "feat: clone projects onto clean templates"
```

### Task 6: Add legacy read-only UI and replacement links

**Files:**

- Modify: `app/api/projects/[id]/route.ts:1`
- Modify: `app/api/books/[id]/route.ts:1`
- Modify: `app/projects/[id]/page.tsx`
- Modify: `app/templates/[id]/page.tsx`
- Modify: `components/projects/generate-chapter-button.tsx`
- Modify: `components/projects/placeholder-fill-section.tsx`
- Create: `components/projects/__tests__/legacy-project-notice.test.tsx`
- Create: `components/templates/__tests__/legacy-template-notice.test.tsx`

- [ ] **Step 1: Write failing notice/control tests**

```ts
it("disables generation for legacy project and links replacement", () => {
  renderProject({
    safety: {
      state: "legacy_read_only",
      replacementProjectId: replacement.id,
    },
  });
  expect(screen.getByText("Proyecto legacy: solo lectura")).toBeVisible();
  expect(screen.getByRole("link", { name: "Abrir proyecto limpio" }))
    .toHaveAttribute("href", `/projects/${replacement.id}`);
  expect(screen.queryByRole("button", { name: /generar/i })).toBeDisabled();
});
```

Template test distinguishes `legacy_unverified`, `suspect`, `contaminated`, and `clean_v2` without source snippets.

- [ ] **Step 2: Run and verify missing notices**

Run: `rtk pnpm test -- components/projects/__tests__/legacy-project-notice.test.tsx components/templates/__tests__/legacy-template-notice.test.tsx`

Expected: FAIL because API/UI do not expose safe classification/replacement metadata.

- [ ] **Step 3: Return minimal safety view models**

Project API:

```ts
safety: {
  state: "source_free" | "clean_v2" | "legacy_read_only";
  reasonCode?: GenerationBlockedReason;
  replacementProjectId?: string;
}
```

Template API:

```ts
safety: {
  classification:
    | "legacy_unverified"
    | "suspect"
    | "contaminated"
    | "clean_v2";
  replacementTemplateId?: string;
}
```

Resolve replacement template ID from completed regeneration operation report/result. Do not send detector signals/profile IDs.

- [ ] **Step 4: Disable all mutation controls client-side**

Keep server guards authoritative. UI hides/disables fill, fragment, chapter, assembly, critique, correction, and title controls for `legacy_read_only`; read/history/export views remain accessible.

- [ ] **Step 5: Run and commit**

Run: `rtk pnpm test -- components/projects/__tests__/legacy-project-notice.test.tsx components/templates/__tests__/legacy-template-notice.test.tsx`

Expected: PASS.

```bash
rtk git add app/api/projects/'[id]'/route.ts app/api/books/'[id]'/route.ts app/projects/'[id]'/page.tsx app/templates/'[id]'/page.tsx components/projects components/templates
rtk git commit -m "feat: mark legacy content read only"
```

### Task 7: Verify the confirmed incident and generic remediation

**Files:**

- Create: `lib/remediation/__tests__/incident-regression.test.ts`
- Create: `lib/remediation/__tests__/end-to-end-remediation.test.ts`

- [ ] **Step 1: Add incident regression by IDs and safe assertions**

Use IDs only; do not add source chapters to fixtures:

```ts
const INCIDENT = {
  templateId: "091ea922-6293-45d6-936b-39c18b330649",
  projectId: "f67abde7-06d6-4222-bd11-ac919ecf06ed",
  chapterId: "7cd9272e-42fb-43b6-a36a-51a63d143e0a",
  placeholder: "analogia_fisica",
};

expect(report.templateId).toBe(INCIDENT.templateId);
expect(report.classification).toBe("contaminated");
expect(report.derivedProjectIds).toContain(INCIDENT.projectId);
expect(report).not.toHaveProperty("snippet");
```

Skip with an explicit “fixture unavailable” reason when local integration database lacks those rows; generic synthetic end-to-end test must always run.

- [ ] **Step 2: Add synthetic full remediation test**

Sequence:

1. seed contaminated legacy template/project with one generated definition;
2. audit → contaminated;
3. regeneration dry-run → no writes;
4. regeneration execution → new clean template/run/artifacts;
5. clone dry-run → no writes;
6. clone execution → new project;
7. assert old graph unchanged/read-only;
8. assert new graph has copied inputs/brief but no generated content;
9. assert duplicate operation calls return same IDs.

- [ ] **Step 3: Run focused remediation suite**

Run:

```bash
rtk pnpm test -- \
  lib/__tests__/remediation-migration.test.ts \
  lib/remediation/__tests__ \
  components/projects/__tests__/legacy-project-notice.test.tsx \
  components/templates/__tests__/legacy-template-notice.test.tsx
```

Expected: PASS, with incident test optionally skipped only when external fixture rows are absent.

- [ ] **Step 4: Run full verification**

Run: `rtk pnpm typecheck`

Expected: PASS.

Run: `rtk pnpm lint`

Expected: PASS.

Run: `rtk pnpm test`

Expected: PASS.

Run: `rtk pnpm db:migrate:local`

Expected: migration applies once; second run has no pending migration.

- [ ] **Step 5: Run audit dry-run**

Run: `rtk pnpm audit:template-contamination -- --dry-run --json`

Expected: safe JSON; confirmed template classified when present; zero writes.

- [ ] **Step 6: Commit regression coverage**

```bash
rtk git add lib/remediation/__tests__/incident-regression.test.ts lib/remediation/__tests__/end-to-end-remediation.test.ts
rtk git diff --cached --name-only
rtk git commit -m "test: cover contamination remediation"
```

## Stage D exit criteria

- Audit classifies all templates without source/generated snippets.
- Mutation workflows require operation UUID and immutable matching input hash.
- Dry-run performs zero writes/enqueues.
- Regeneration creates one new clean template ID; old template unchanged.
- Clone creates one new project ID, copies user inputs/remapped approved brief, and copies zero generated outputs.
- Old project remains readable and generation-disabled.
- Replacement links resolve both directions needed by operators/users.
- Confirmed incident is detected where fixture data exists.
- Full tests, typecheck, lint, and migrations pass.
