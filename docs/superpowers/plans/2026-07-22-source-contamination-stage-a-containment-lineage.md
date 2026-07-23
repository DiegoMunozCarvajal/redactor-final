# Source Contamination Stage A: Containment and Lineage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop unsafe template/project generation immediately, introduce immutable pipeline lineage, and keep source-free projects usable.

**Architecture:** Add pipeline-run persistence and one fail-closed authorization boundary shared by every generation entry point. Existing LLM template generation remains temporarily archived behind exhaustive field scanning, but its legacy pipeline version is never eligible for project creation. Manual projects use an explicit `source-free` scope; templated projects require a supported clean run and non-empty source-profile lineage.

**Tech Stack:** Next.js 15, TypeScript, Drizzle ORM, PostgreSQL/Supabase migrations, Trigger.dev 4, Zod, Vitest.

---

## Dependencies and delivery boundary

- Approved design: `docs/superpowers/specs/2026-07-22-generic-source-contamination-prevention-design.md`
- This stage deliberately does not implement Trace IR, source profiling, deterministic compilation, or downstream semantic detection.
- Until Stage B activates a clean supported run, legacy templates remain readable but cannot create projects or generate new content.
- Existing dirty worktree changes must be preserved. Before every commit, verify staged paths with `rtk git diff --cached --name-only`.

## File map

- Create `supabase/migrations/20260722000000_add_template_pipeline_lineage.sql`: core run/profile/artifact tables and nullable legacy lineage columns.
- Create `lib/db/schema/template-pipeline.ts`: Drizzle schema for pipeline persistence.
- Modify `lib/db/schema/book-templates.ts`, `prompts.ts`, `prompt-versions.ts`, `chapter-placeholders.ts`, and `index.ts`: expose lineage columns/types.
- Create `lib/template-pipeline/contracts.ts`: supported versions, statuses, hashes, authorization types, typed errors.
- Create `lib/template-pipeline/hash.ts`: canonical JSON and SHA-256 helpers.
- Create `lib/template-pipeline/repository.ts`: run/profile reads and state transitions.
- Create `lib/template-pipeline/authorization.ts`: sole project generation authorization guard.
- Create `lib/template-pipeline/http.ts`: stable HTTP mapping for blocked generation.
- Create `lib/template-pipeline/template-field-scan.ts`: exhaustive flattening and fail-closed template scan.
- Modify `lib/ai/originality-check.ts`: close the confirmed melting-ice regex gap.
- Modify `app/api/books/auto/route.ts` and `trigger/generate-template.ts`: create legacy containment runs and quarantine contaminated output.
- Modify every project generation route and worker: authorize before mutation/provider invocation and re-authorize at worker execution.
- Modify project/template listing and creation UI: expose only eligible templates for project creation.
- Modify `lib/db/queries/copy-template-prompts.ts`: preserve structural lineage exactly.
- Add focused migration, authorization, scan, route-coverage, and copy-lineage tests.

### Task 1: Add pipeline lineage persistence

**Files:**

- Create: `lib/__tests__/template-pipeline-migration.test.ts`
- Create: `supabase/migrations/20260722000000_add_template_pipeline_lineage.sql`
- Create: `lib/db/schema/template-pipeline.ts`
- Modify: `lib/db/schema/book-templates.ts:1`
- Modify: `lib/db/schema/prompts.ts:1`
- Modify: `lib/db/schema/prompt-versions.ts:15`
- Modify: `lib/db/schema/chapter-placeholders.ts:5`
- Modify: `lib/db/schema/index.ts:1`

- [ ] **Step 1: Write failing migration contract tests**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../../supabase/migrations/20260722000000_add_template_pipeline_lineage.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("template pipeline lineage migration", () => {
  it("creates immutable run, profile, chunk, and artifact storage", () => {
    for (const table of [
      "template_pipeline_runs",
      "template_source_profiles",
      "template_source_profile_chunks",
      "template_run_artifacts",
    ]) {
      expect(sql).toContain(`CREATE TABLE ${table}`);
      expect(sql).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    }
    expect(sql).toContain("UNIQUE (pipeline_run_id, chapter_id)");
    expect(sql).toContain("vector(1536)");
  });

  it("adds nullable lineage for legacy rows", () => {
    expect(sql).toContain("book_templates ADD COLUMN active_pipeline_run_id");
    expect(sql).toContain("prompts ADD COLUMN template_pipeline_run_id");
    expect(sql).toContain("prompts ADD COLUMN template_artifact_hash");
    expect(sql).toContain("chapter_placeholders ADD COLUMN template_pipeline_run_id");
    expect(sql).toContain("chapter_placeholders ADD COLUMN template_artifact_hash");
  });

  it("restricts deletion of active lineage", () => {
    expect(sql).toContain("ON DELETE RESTRICT");
    expect(sql).toContain("chk_template_pipeline_run_status");
    expect(sql).toContain("chk_template_operational_status");
  });
});
```

- [ ] **Step 2: Run test and verify missing migration failure**

Run: `rtk pnpm test -- lib/__tests__/template-pipeline-migration.test.ts`

Expected: FAIL with `ENOENT` for the migration.

- [ ] **Step 3: Create migration**

Use this schema:

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE template_pipeline_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_template_id uuid NOT NULL REFERENCES book_templates(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'running',
  pipeline_version text NOT NULL,
  compiler_version text,
  compiler_hash text,
  recipe_catalog_hash text,
  rhetoric_trace_revision_id uuid REFERENCES prompt_revisions(id) ON DELETE RESTRICT,
  source_profile_version text,
  originality_policy_version text NOT NULL,
  failure_stage text,
  report jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT chk_template_pipeline_run_status
    CHECK (status IN ('running', 'clean', 'quarantined', 'failed')),
  CONSTRAINT chk_template_pipeline_failure_stage CHECK (
    failure_stage IS NULL OR failure_stage IN (
      'source_profile', 'trace_classification', 'trace_validation',
      'template_compilation', 'template_validation', 'finalization'
    )
  )
);

CREATE TABLE template_source_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_run_id uuid NOT NULL REFERENCES template_pipeline_runs(id) ON DELETE RESTRICT,
  chapter_id uuid NOT NULL REFERENCES chapters(id) ON DELETE RESTRICT,
  source_hash text NOT NULL,
  source_language text NOT NULL,
  profile_version text NOT NULL,
  distinctive_elements jsonb NOT NULL DEFAULT '[]'::jsonb,
  profile_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pipeline_run_id, chapter_id)
);

CREATE TABLE template_source_profile_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_profile_id uuid NOT NULL REFERENCES template_source_profiles(id) ON DELETE RESTRICT,
  chunk_index integer NOT NULL,
  content_hash text NOT NULL,
  lexical_fingerprint jsonb NOT NULL,
  embedding vector(1536) NOT NULL,
  token_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_profile_id, chunk_index)
);

CREATE TABLE template_run_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_run_id uuid NOT NULL REFERENCES template_pipeline_runs(id) ON DELETE RESTRICT,
  chapter_id uuid NOT NULL REFERENCES chapters(id) ON DELETE RESTRICT,
  trace_ir jsonb NOT NULL,
  compiled_template jsonb NOT NULL,
  artifact_hash text NOT NULL,
  validation_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pipeline_run_id, chapter_id)
);

ALTER TABLE book_templates
  ADD COLUMN active_pipeline_run_id uuid
  REFERENCES template_pipeline_runs(id) ON DELETE RESTRICT;
ALTER TABLE book_templates
  ADD CONSTRAINT chk_template_operational_status
  CHECK (status IN ('generating', 'ready', 'quarantined', 'failed'));

ALTER TABLE prompts
  ADD COLUMN template_pipeline_run_id uuid
    REFERENCES template_pipeline_runs(id) ON DELETE RESTRICT,
  ADD COLUMN template_artifact_hash text;

ALTER TABLE chapter_placeholders
  ADD COLUMN template_pipeline_run_id uuid
    REFERENCES template_pipeline_runs(id) ON DELETE RESTRICT,
  ADD COLUMN template_artifact_hash text,
  ADD COLUMN dependency_names text[] NOT NULL DEFAULT ARRAY[]::text[];

CREATE INDEX idx_template_pipeline_runs_template
  ON template_pipeline_runs(book_template_id, created_at DESC);
CREATE INDEX idx_template_profiles_run
  ON template_source_profiles(pipeline_run_id);
CREATE INDEX idx_template_profile_chunks_profile
  ON template_source_profile_chunks(source_profile_id, chunk_index);

ALTER TABLE template_pipeline_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_source_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_source_profile_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_run_artifacts ENABLE ROW LEVEL SECURITY;
```

Do not grant broad `authenticated` access to these private tables. Service-role
server code accesses them; admin/project APIs return explicit safe projections.
Never expose `distinctive_elements`, fingerprints, or embeddings through public
queries.

- [ ] **Step 4: Add matching Drizzle models**

`lib/db/schema/template-pipeline.ts` must export all four tables and these literal types:

```ts
export const templatePipelineRunStatuses = [
  "running",
  "clean",
  "quarantined",
  "failed",
] as const;

export type TemplatePipelineRunStatus =
  (typeof templatePipelineRunStatuses)[number];

export interface DistinctiveElement {
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

Mirror every SQL column, FK, unique index, JSON type, and the 1536-dimension
vector. Add `activePipelineRunId`, `templatePipelineRunId`,
`templateArtifactHash`, and `dependencyNames` to the existing Drizzle tables.
Extend `ChapterPromptSnapshot` with nullable `templatePipelineRunId` and
`templateArtifactHash`.

Avoid runtime import cycles: declare
`bookTemplates.activePipelineRunId` and
`templatePipelineRuns.rhetoricTraceRevisionId` as raw nullable UUID columns in
Drizzle, with comments that SQL migration enforces their FKs. All non-cyclic FKs
remain expressed through `.references()`.

- [ ] **Step 5: Run migration and schema tests**

Run: `rtk pnpm test -- lib/__tests__/template-pipeline-migration.test.ts`

Expected: PASS.

Run: `rtk pnpm typecheck`

Expected: PASS.

- [ ] **Step 6: Commit persistence**

```bash
rtk git add supabase/migrations/20260722000000_add_template_pipeline_lineage.sql lib/db/schema lib/__tests__/template-pipeline-migration.test.ts
rtk git diff --cached --name-only
rtk git commit -m "feat: add template pipeline lineage"
```

### Task 2: Define canonical pipeline contracts and hashes

**Files:**

- Create: `lib/template-pipeline/contracts.ts`
- Create: `lib/template-pipeline/hash.ts`
- Create: `lib/template-pipeline/__tests__/hash.test.ts`

- [ ] **Step 1: Write failing canonical-hash tests**

```ts
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  EMPTY_SOURCE_PROFILE_SET_HASH,
  canonicalJson,
  sha256Canonical,
} from "../hash";

describe("pipeline hashes", () => {
  it("sorts object keys recursively but preserves array order", () => {
    expect(canonicalJson({ z: 1, a: { y: 2, x: 3 }, list: [2, 1] }))
      .toBe('{"a":{"x":3,"y":2},"list":[2,1],"z":1}');
  });

  it("uses one stable empty-profile hash", () => {
    expect(EMPTY_SOURCE_PROFILE_SET_HASH)
      .toBe(createHash("sha256").update("[]").digest("hex"));
    expect(sha256Canonical([])).toBe(EMPTY_SOURCE_PROFILE_SET_HASH);
  });
});
```

- [ ] **Step 2: Run and verify missing module failure**

Run: `rtk pnpm test -- lib/template-pipeline/__tests__/hash.test.ts`

Expected: FAIL because `../hash` does not exist.

- [ ] **Step 3: Implement contracts and canonical hashing**

`contracts.ts`:

```ts
export const LEGACY_CONTAINMENT_PIPELINE_VERSION = "legacy-containment-v1";
export const SAFE_PIPELINE_VERSION = "template-pipeline-v2";
export const ORIGINALITY_POLICY_VERSION = "originality-policy-v2";
export const SOURCE_PROFILE_VERSION = "source-profile-v1";

export const SUPPORTED_GENERATION_PIPELINES = new Set([
  SAFE_PIPELINE_VERSION,
]);

export type GenerationBlockedReason =
  | "template_unverified"
  | "template_quarantined"
  | "template_failed"
  | "missing_source_profile"
  | "unsupported_pipeline"
  | "unsupported_policy";

export type GenerationAuthorization =
  | {
      scope: "template";
      pipelineRunId: string;
      sourceProfileSetHash: string;
      originalityPolicyVersion: string;
    }
  | {
      scope: "source-free";
      pipelineRunId: null;
      sourceProfileSetHash: string;
      originalityPolicyVersion: string;
    };

export class GenerationBlockedError extends Error {
  constructor(
    public readonly reason: GenerationBlockedReason,
    public readonly projectId: string,
  ) {
    super(`Generation blocked: ${reason}`);
    this.name = "GenerationBlockedError";
  }
}
```

`hash.ts`:

```ts
import { createHash } from "node:crypto";

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, normalize(entry)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256Canonical(value: unknown): string {
  return sha256Text(canonicalJson(value));
}

export const EMPTY_SOURCE_PROFILE_SET_HASH = sha256Canonical([]);
```

- [ ] **Step 4: Run and commit**

Run: `rtk pnpm test -- lib/template-pipeline/__tests__/hash.test.ts`

Expected: PASS.

```bash
rtk git add lib/template-pipeline
rtk git commit -m "feat: define pipeline lineage contracts"
```

### Task 3: Implement fail-closed project authorization

**Files:**

- Create: `lib/template-pipeline/repository.ts`
- Create: `lib/template-pipeline/authorization.ts`
- Create: `lib/template-pipeline/http.ts`
- Create: `lib/template-pipeline/__tests__/authorization.test.ts`

- [ ] **Step 1: Write failing authorization tests**

Mock the repository boundary, not Drizzle internals:

```ts
it("allows a project without template as source-free", async () => {
  repository.loadProjectPipeline.mockResolvedValue({
    projectId: "project-1",
    bookTemplateId: null,
  });
  await expect(assertTemplateGenerationAllowed("project-1")).resolves.toEqual({
    scope: "source-free",
    pipelineRunId: null,
    sourceProfileSetHash: EMPTY_SOURCE_PROFILE_SET_HASH,
    originalityPolicyVersion: ORIGINALITY_POLICY_VERSION,
  });
});

it.each([
  ["quarantined", "template_quarantined"],
  ["failed", "template_failed"],
])("blocks %s templates", async (status, reason) => {
  repository.loadProjectPipeline.mockResolvedValue(
    fixtureTemplatePipeline({ templateStatus: status }),
  );
  await expect(assertTemplateGenerationAllowed("project-1"))
    .rejects.toMatchObject({ name: "GenerationBlockedError", reason });
});

it("never falls back to source-free for a templated project", async () => {
  repository.loadProjectPipeline.mockResolvedValue(
    fixtureTemplatePipeline({ profiles: [] }),
  );
  await expect(assertTemplateGenerationAllowed("project-1"))
    .rejects.toMatchObject({ reason: "missing_source_profile" });
});
```

Also cover missing active run, non-clean run, unsupported pipeline/policy, mismatched run/template IDs, and stable profile-set hashing sorted by chapter ID.

- [ ] **Step 2: Run and verify missing guard failure**

Run: `rtk pnpm test -- lib/template-pipeline/__tests__/authorization.test.ts`

Expected: FAIL because authorization modules are absent.

- [ ] **Step 3: Implement one repository query and one throwing guard**

`repository.ts` returns a projection with project, template, active run, and profiles. It must join the active run by both `book_templates.active_pipeline_run_id` and matching `book_template_id`; never fetch “latest run”.

`authorization.ts` order:

```ts
export async function assertTemplateGenerationAllowed(
  projectId: string,
): Promise<GenerationAuthorization> {
  const state = await loadProjectPipeline(projectId);
  if (!state) throw new Error(`Project not found: ${projectId}`);
  if (!state.bookTemplateId) {
    return {
      scope: "source-free",
      pipelineRunId: null,
      sourceProfileSetHash: EMPTY_SOURCE_PROFILE_SET_HASH,
      originalityPolicyVersion: ORIGINALITY_POLICY_VERSION,
    };
  }
  if (state.templateStatus === "quarantined")
    throw new GenerationBlockedError("template_quarantined", projectId);
  if (state.templateStatus === "failed")
    throw new GenerationBlockedError("template_failed", projectId);
  if (!state.run || state.templateStatus !== "ready")
    throw new GenerationBlockedError("template_unverified", projectId);
  if (state.run.status !== "clean")
    throw new GenerationBlockedError("template_unverified", projectId);
  if (!SUPPORTED_GENERATION_PIPELINES.has(state.run.pipelineVersion))
    throw new GenerationBlockedError("unsupported_pipeline", projectId);
  if (state.run.originalityPolicyVersion !== ORIGINALITY_POLICY_VERSION)
    throw new GenerationBlockedError("unsupported_policy", projectId);
  if (state.profiles.length === 0)
    throw new GenerationBlockedError("missing_source_profile", projectId);

  return {
    scope: "template",
    pipelineRunId: state.run.id,
    sourceProfileSetHash: hashSourceProfileSet(state.profiles),
    originalityPolicyVersion: state.run.originalityPolicyVersion,
  };
}
```

`http.ts` maps `GenerationBlockedError` to status `409` and body:

```ts
{
  error: "generation blocked",
  code: error.reason,
}
```

Do not expose profile contents or internal reports.

- [ ] **Step 4: Run and commit**

Run: `rtk pnpm test -- lib/template-pipeline/__tests__/authorization.test.ts`

Expected: PASS.

```bash
rtk git add lib/template-pipeline
rtk git commit -m "feat: guard project generation lineage"
```

### Task 4: Enforce authorization at every generation boundary

**Files:**

- Create: `lib/__tests__/generation-authorization-coverage.test.ts`
- Modify: `app/api/projects/[id]/chapters/[chapterId]/placeholders/fill/route.ts:45`
- Modify: `app/api/projects/[id]/chapters/[chapterId]/placeholders/[name]/fill/route.ts:35`
- Modify: `app/api/projects/[id]/prompts/[promptId]/generate/route.ts:20`
- Modify: `app/api/projects/[id]/chapters/[chapterId]/generate/route.ts:16`
- Modify: `app/api/projects/[id]/chapters/[chapterId]/assemble/route.ts:18`
- Modify: `app/api/projects/[id]/chapters/[chapterId]/critique/route.ts:18`
- Modify: `app/api/projects/[id]/chapters/[chapterId]/correct/route.ts:18`
- Modify: `app/api/projects/[id]/generate-title/route.ts:12`
- Modify: `trigger/generate-chapter.ts:1`
- Modify: `trigger/generate-critique.ts:1`
- Modify: `trigger/generate-correction.ts:1`

- [ ] **Step 1: Write failing static coverage test**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const guardedFiles = [
  "app/api/projects/[id]/chapters/[chapterId]/placeholders/fill/route.ts",
  "app/api/projects/[id]/chapters/[chapterId]/placeholders/[name]/fill/route.ts",
  "app/api/projects/[id]/prompts/[promptId]/generate/route.ts",
  "app/api/projects/[id]/chapters/[chapterId]/generate/route.ts",
  "app/api/projects/[id]/chapters/[chapterId]/assemble/route.ts",
  "app/api/projects/[id]/chapters/[chapterId]/critique/route.ts",
  "app/api/projects/[id]/chapters/[chapterId]/correct/route.ts",
  "app/api/projects/[id]/generate-title/route.ts",
  "trigger/generate-chapter.ts",
  "trigger/generate-critique.ts",
  "trigger/generate-correction.ts",
] as const;

describe("generation authorization coverage", () => {
  it.each(guardedFiles)("%s calls the central guard", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).toContain("assertTemplateGenerationAllowed(");
  });
});
```

- [ ] **Step 2: Run and verify coverage failure**

Run: `rtk pnpm test -- lib/__tests__/generation-authorization-coverage.test.ts`

Expected: FAIL listing every unguarded route/task.

- [ ] **Step 3: Add route preflight before generation-row creation**

After ownership validation and before rate-limit locks, generation rows, or provider calls:

```ts
let authorization: GenerationAuthorization;
try {
  authorization = await assertTemplateGenerationAllowed(projectId);
} catch (error) {
  const blocked = generationBlockedResponse(error);
  if (blocked) return blocked;
  throw error;
}
```

Include `authorization` in queued task payloads and generation metadata. Do not trust it as authorization inside workers; it is queue-time lineage only.

- [ ] **Step 4: Re-authorize inside each Trigger.dev worker**

Before its first prompt/provider call:

```ts
const currentAuthorization = await assertTemplateGenerationAllowed(
  payload.projectId,
);
if (
  currentAuthorization.scope !== payload.authorization.scope ||
  currentAuthorization.pipelineRunId !== payload.authorization.pipelineRunId ||
  currentAuthorization.sourceProfileSetHash !==
    payload.authorization.sourceProfileSetHash
) {
  throw new GenerationBlockedError("template_unverified", payload.projectId);
}
```

This closes the queue-delay race where a template becomes quarantined after the API enqueues work.

- [ ] **Step 5: Run coverage and affected route/task tests**

Run: `rtk pnpm test -- lib/__tests__/generation-authorization-coverage.test.ts lib/__tests__/generate.test.ts trigger/__tests__`

Expected: PASS.

- [ ] **Step 6: Commit guards**

```bash
rtk git add app/api/projects trigger lib/__tests__/generation-authorization-coverage.test.ts
rtk git diff --cached --name-only
rtk git commit -m "feat: enforce generation authorization"
```

### Task 5: Make transitional template scanning exhaustive and fail-closed

**Files:**

- Create: `lib/template-pipeline/template-field-scan.ts`
- Create: `lib/template-pipeline/__tests__/template-field-scan.test.ts`
- Modify: `lib/ai/originality-check.ts:34`
- Modify: `lib/ai/__tests__/originality-check.test.ts`
- Modify: `trigger/generate-template.ts:167`

- [ ] **Step 1: Write failing regression tests**

```ts
it.each([
  "el hielo se derrite",
  "el hielo lentamente se derrite",
  "cuando el hielo finalmente se derrite",
])("detects melting-ice wording: %s", (text) => {
  expect(checkBlocklist(text)).not.toEqual([]);
});

it("scans every persisted template field", () => {
  const block = cleanBlock();
  block.placeholders[0].function =
    "La analogía del hielo que lentamente se derrite";
  const findings = scanTemplateBlocks([block]);
  expect(findings).toEqual([
    expect.objectContaining({
      path: "templates[0].placeholders[0].function",
    }),
  ]);
});
```

Cover `name`, `function`, `content`, `userPrompt`, `sourceContext`, `notes`, placeholder `name`, and placeholder `function`.

- [ ] **Step 2: Run and verify narrow-regex/partial-scan failures**

Run: `rtk pnpm test -- lib/ai/__tests__/originality-check.test.ts lib/template-pipeline/__tests__/template-field-scan.test.ts`

Expected: FAIL for inflected melting-ice cases and missing scanner.

- [ ] **Step 3: Add generalized confirmed-incident regex**

Replace only the narrow melting-ice expression with:

```ts
/\bhielo(?:\s+\p{L}+){0,4}\s+se\s+derrite\b/iu
```

Keep this as immediate containment, not the generic Stage C solution.

- [ ] **Step 4: Implement exhaustive field flattening**

```ts
export interface TemplateField {
  path: string;
  value: string;
}

export function collectTemplateFields(
  blocks: TemplateBlockLike[],
): TemplateField[] {
  return blocks.flatMap((block, blockIndex) => {
    const prefix = `templates[${blockIndex}]`;
    const fields: TemplateField[] = [
      { path: `${prefix}.name`, value: block.name },
      { path: `${prefix}.content`, value: block.content },
      { path: `${prefix}.userPrompt`, value: block.userPrompt },
    ];
    for (const key of ["function", "sourceContext", "notes"] as const) {
      if (block[key]) fields.push({ path: `${prefix}.${key}`, value: block[key]! });
    }
    block.placeholders.forEach((placeholder, index) => {
      fields.push(
        {
          path: `${prefix}.placeholders[${index}].name`,
          value: placeholder.name,
        },
        {
          path: `${prefix}.placeholders[${index}].function`,
          value: placeholder.function,
        },
      );
    });
    return fields;
  });
}

export function assertTemplateFieldsClean(blocks: TemplateBlockLike[]): void {
  for (const field of collectTemplateFields(blocks)) {
    assertOriginalEnough(field.value, {
      stage: "metaprompt-block",
      throwOnFail: true,
    });
  }
}
```

- [ ] **Step 5: Quarantine instead of persisting flagged output**

Call `assertTemplateFieldsClean(blocks)` before any prompt/placeholder transaction. If it throws `OriginalityError`, update run and template:

```ts
await quarantineTemplateRun({
  runId: payload.pipelineRunId,
  templateId: payload.templateId,
  failureStage: "template_validation",
  report: toSafeOriginalityReport(error),
});
throw error;
```

The safe report contains field path, regex/signal ID, score, and hashes; never candidate/source passages.

- [ ] **Step 6: Run and commit**

Run: `rtk pnpm test -- lib/ai/__tests__/originality-check.test.ts lib/template-pipeline/__tests__/template-field-scan.test.ts trigger/__tests__/generate-template.test.ts`

Expected: PASS and no template rows inserted in the contaminated fixture.

```bash
rtk git add lib/ai/originality-check.ts lib/ai/__tests__/originality-check.test.ts lib/template-pipeline trigger/generate-template.ts trigger/__tests__/generate-template.test.ts
rtk git commit -m "fix: quarantine contaminated templates"
```

### Task 6: Create transitional runs and preserve copied lineage

**Files:**

- Modify: `app/api/books/auto/route.ts:45`
- Modify: `trigger/generate-template.ts:72`
- Modify: `lib/db/queries/copy-template-prompts.ts:19`
- Modify: `lib/prompts/chapter-revisions.ts`
- Modify: `lib/__tests__/copy-template-prompts.test.ts`
- Create: `lib/__tests__/template-run-lifecycle.test.ts`

- [ ] **Step 1: Write failing lifecycle/copy tests**

Assert:

```ts
expect(triggerPayload.pipelineRunId).toBe(createdRun.id);
expect(createdRun.pipelineVersion).toBe("legacy-containment-v1");
expect(copiedPrompt).toMatchObject({
  templatePipelineRunId: templatePrompt.templatePipelineRunId,
  templateArtifactHash: templatePrompt.templateArtifactHash,
});
expect(copiedPlaceholder).toMatchObject({
  templatePipelineRunId: templatePlaceholder.templatePipelineRunId,
  templateArtifactHash: templatePlaceholder.templateArtifactHash,
});
```

Also assert `prompt_versions.snapshot` contains the two exact lineage values.

- [ ] **Step 2: Run and verify lineage loss**

Run: `rtk pnpm test -- lib/__tests__/template-run-lifecycle.test.ts lib/__tests__/copy-template-prompts.test.ts`

Expected: FAIL because no run is created and copy drops lineage.

- [ ] **Step 3: Create run in same transaction as template**

In `POST /api/books/auto`, insert:

```ts
const [run] = await tx.insert(templatePipelineRuns).values({
  bookTemplateId: tpl.id,
  status: "running",
  pipelineVersion: LEGACY_CONTAINMENT_PIPELINE_VERSION,
  rhetoricTraceRevisionId,
  originalityPolicyVersion: ORIGINALITY_POLICY_VERSION,
}).returning();
```

Pass `pipelineRunId` to Trigger.dev. On clean transitional completion, set the run `clean` and template `ready`, but do not set `active_pipeline_run_id`; unsupported legacy runs remain ineligible. On detection, set both run/template `quarantined`. On technical failure, set both `failed`.

- [ ] **Step 4: Copy lineage byte-for-byte**

Add the two fields to both prompt-copy mappers and placeholder-copy mappers:

```ts
templatePipelineRunId: row.templatePipelineRunId,
templateArtifactHash: row.templateArtifactHash,
dependencyNames: row.dependencyNames,
```

Update `snapshotChapterPrompt` so immutable revisions preserve the same values.

- [ ] **Step 5: Run and commit**

Run: `rtk pnpm test -- lib/__tests__/template-run-lifecycle.test.ts lib/__tests__/copy-template-prompts.test.ts`

Expected: PASS.

```bash
rtk git add app/api/books/auto/route.ts trigger/generate-template.ts lib/db/queries/copy-template-prompts.ts lib/prompts/chapter-revisions.ts lib/__tests__
rtk git commit -m "feat: track transitional template runs"
```

### Task 7: Hide ineligible templates and reject project creation atomically

**Files:**

- Create: `lib/template-pipeline/eligibility.ts`
- Create: `lib/template-pipeline/__tests__/eligibility.test.ts`
- Create: `components/projects/__tests__/create-project-dialog.test.tsx`
- Modify: `app/api/books/route.ts:10`
- Modify: `app/api/projects/route.ts:76`
- Modify: `app/projects/page.tsx`
- Modify: `components/projects/create-project-dialog.tsx:36`
- Modify: `components/patterns/quick-start-card.tsx:6`

- [ ] **Step 1: Write failing eligibility tests**

```ts
it("allows only ready templates with one supported clean active run", () => {
  expect(isTemplateEligible(cleanV2Template())).toBe(true);
  expect(isTemplateEligible(cleanV2Template({ activeRunId: null }))).toBe(false);
  expect(isTemplateEligible(cleanV2Template({ runStatus: "quarantined" }))).toBe(false);
  expect(isTemplateEligible(cleanV2Template({ pipelineVersion: "legacy-containment-v1" }))).toBe(false);
});

it("renders only supplied eligible template options", async () => {
  const user = userEvent.setup();
  render(
    <CreateProjectDialog
      templates={[{ id: "clean-1", name: "Clean", status: "ready" }]}
    />,
  );
  await user.click(screen.getByRole("combobox", { name: "Book Template (optional)" }));
  expect(screen.getByRole("option", { name: "Clean" })).toBeEnabled();
  expect(screen.queryByText("Legacy")).toBeNull();
});
```

Add a route test that changes the run after template selection but before insert and expects `400 { error: "template is not available" }`.

- [ ] **Step 2: Run and verify status-only behavior fails**

Run: `rtk pnpm test -- lib/template-pipeline/__tests__/eligibility.test.ts lib/__tests__/copy-template-prompts.test.ts`

Expected: FAIL because existing logic checks only `book_templates.status`.

- [ ] **Step 3: Implement shared eligibility predicate**

```ts
export function isTemplateEligible(input: {
  templateStatus: string;
  activeRunId: string | null;
  runStatus: string | null;
  pipelineVersion: string | null;
  originalityPolicyVersion: string | null;
}): boolean {
  return input.templateStatus === "ready"
    && input.activeRunId !== null
    && input.runStatus === "clean"
    && input.pipelineVersion !== null
    && SUPPORTED_GENERATION_PIPELINES.has(input.pipelineVersion)
    && input.originalityPolicyVersion === ORIGINALITY_POLICY_VERSION;
}
```

- [ ] **Step 4: Apply eligibility in API and transaction**

`GET /api/books` returns operational fields for admin template management plus `eligibleForProjects`. Project-page fetching filters on `eligibleForProjects`.

Inside `POST /api/projects` transaction, join the active run and call the same predicate. Do not rely on client filtering.

- [ ] **Step 5: Simplify project dialog**

The dialog receives only eligible templates. Remove local `generating`/`failed` enablement logic; no ineligible option should be selectable. Preserve the no-template option.

- [ ] **Step 6: Run and commit**

Run: `rtk pnpm test -- lib/template-pipeline/__tests__/eligibility.test.ts lib/__tests__/copy-template-prompts.test.ts components/projects/__tests__/create-project-dialog.test.tsx`

Expected: PASS.

```bash
rtk git add lib/template-pipeline app/api/books/route.ts app/api/projects/route.ts app/projects/page.tsx components/projects/create-project-dialog.tsx components/patterns/quick-start-card.tsx components/projects/__tests__
rtk git commit -m "feat: hide unsafe templates"
```

### Task 8: Verify Stage A end-to-end

**Files:**

- No planned file changes.

- [ ] **Step 1: Run focused safety suite**

Run:

```bash
rtk pnpm test -- \
  lib/__tests__/template-pipeline-migration.test.ts \
  lib/template-pipeline/__tests__ \
  lib/ai/__tests__/originality-check.test.ts \
  lib/__tests__/generation-authorization-coverage.test.ts \
  lib/__tests__/template-run-lifecycle.test.ts \
  lib/__tests__/copy-template-prompts.test.ts \
  trigger/__tests__/generate-template.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full static verification**

Run: `rtk pnpm typecheck`

Expected: PASS.

Run: `rtk pnpm lint`

Expected: PASS.

Run: `rtk pnpm test`

Expected: PASS.

- [ ] **Step 3: Apply migration locally and inspect state**

Run: `rtk pnpm db:migrate:local`

Expected: migration succeeds once; second run reports no pending migration.

Query with existing repository tooling and verify:

- legacy templates have null `active_pipeline_run_id`;
- no existing prompt/placeholder lineage was fabricated;
- source-free project authorization succeeds;
- templated legacy project authorization throws `unsupported_pipeline` or `template_unverified`;
- confirmed contaminated template becomes quarantined when transitional generation is replayed in test fixtures.

## Stage A exit criteria

- Every generation route and background worker calls the same throwing guard.
- Source-free projects remain usable with explicit empty-profile lineage.
- Templated legacy projects cannot generate or create descendants.
- All template output fields fail closed on current blocklist detection.
- Confirmed `el hielo se derrite` variants fail.
- No new execution exposes risk-profile data.
- All tests, typecheck, lint, and local migration pass.
