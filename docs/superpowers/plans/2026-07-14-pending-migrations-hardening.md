# Pending Migrations Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make migration execution fail safely, harden EditorialBrief/source data access, reconcile schema names, then apply and verify the genuinely pending local migrations.

**Architecture:** Separate pure migration planning/transaction helpers from the executable script so critical bootstrap and atomicity behavior can be unit-tested. Because the three EditorialBrief migrations are not yet applied in the target database, make their initial install fail-closed, reconcile legacy constraint names, and restrict public-role grants before first application. Keep the already-applied generation-prompt migration under its original filename.

**Tech Stack:** TypeScript 5.9, Vitest 3, postgres.js 3.4, PostgreSQL/Supabase RLS, Supabase CLI 2.109

---

## File map

- Create: `scripts/migration-runner.ts` — pure pending-file planning, outer-transaction normalization, and atomic single-file application.
- Create: `scripts/__tests__/migration-runner.test.ts` — runner regression contract.
- Modify: `scripts/apply-supabase-migrations.ts` — remove implicit backfill and use atomic runner.
- Create: `lib/__tests__/pending-migrations-hardening.test.ts` — SQL security/schema contract.
- Modify: `supabase/migrations/20260713000000_add_editorial_briefs.sql` — canonical constraint names and immediate deny-by-default RLS.
- Modify: `supabase/migrations/20260713000001_fix_editorial_briefs_fks.sql` — reconcile legacy automatic constraint names.
- Modify: `supabase/migrations/20260714000000_secure_editorial_briefs.sql` — optimized policies, least-privilege grants, and source/source-chunk RLS.
- Preserve: `supabase/migrations/20260623170735_add_generation_prompt_unique_default.sql` — original applied filename.
- Remove from dirty main only: `supabase/migrations/20260623215908_add_generation_prompt_unique_default.sql` — untracked duplicate rename.

### Task 1: Make the migration runner fail safely

**Files:**

- Create: `scripts/__tests__/migration-runner.test.ts`
- Create: `scripts/migration-runner.ts`
- Modify: `scripts/apply-supabase-migrations.ts:1-82`

- [ ] **Step 1: Write failing runner tests**

Create tests that import `getPendingMigrationFiles`, `unwrapOuterTransaction`, and `applyMigrationAtomically` and assert:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  applyMigrationAtomically,
  getPendingMigrationFiles,
  unwrapOuterTransaction,
  type MigrationClient,
} from "../migration-runner";

describe("migration runner", () => {
  it("treats every file as pending when tracking is empty", () => {
    expect(getPendingMigrationFiles(["001.sql", "002.sql"], [])).toEqual([
      "001.sql",
      "002.sql",
    ]);
  });

  it("filters only exact tracked filenames", () => {
    expect(
      getPendingMigrationFiles(
        ["20260623170735_unique.sql", "20260623215908_unique.sql"],
        ["20260623170735_unique.sql"],
      ),
    ).toEqual(["20260623215908_unique.sql"]);
  });

  it("unwraps a migration-owned outer transaction", () => {
    expect(unwrapOuterTransaction("BEGIN;\nSELECT 1;\nCOMMIT;\n")).toBe(
      "SELECT 1;",
    );
    expect(unwrapOuterTransaction("DO $$ BEGIN NULL; END $$;")).toBe(
      "DO $$ BEGIN NULL; END $$;",
    );
  });

  it("executes SQL and tracking insert inside one transaction", async () => {
    const events: string[] = [];
    const client = {
      begin: vi.fn(async (callback) => {
        events.push("begin");
        await callback({
          unsafe: vi.fn(async (query: string, params?: unknown[]) => {
            events.push(params ? `track:${String(params[0])}` : `sql:${query}`);
          }),
        });
        events.push("commit");
      }),
    } as unknown as MigrationClient;

    await applyMigrationAtomically(client, "001.sql", "BEGIN;\nSELECT 1;\nCOMMIT;");

    expect(events).toEqual([
      "begin",
      "sql:SELECT 1;",
      "track:001.sql",
      "commit",
    ]);
  });

  it("does not track a migration whose SQL fails", async () => {
    const tracked = vi.fn();
    const client = {
      begin: vi.fn(async (callback) =>
        callback({
          unsafe: vi.fn(async (_query: string, params?: unknown[]) => {
            if (params) tracked();
            else throw new Error("migration failed");
          }),
        }),
      ),
    } as unknown as MigrationClient;

    await expect(
      applyMigrationAtomically(client, "001.sql", "SELECT broken"),
    ).rejects.toThrow("migration failed");
    expect(tracked).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
rtk pnpm exec vitest run scripts/__tests__/migration-runner.test.ts
```

Expected: FAIL because `scripts/migration-runner.ts` does not exist.

- [ ] **Step 3: Implement runner helpers**

Create `scripts/migration-runner.ts`:

```ts
import postgres from "postgres";

export type MigrationClient = ReturnType<typeof postgres>;

export function getPendingMigrationFiles(
  files: readonly string[],
  trackedFiles: readonly string[],
): string[] {
  const tracked = new Set(trackedFiles);
  return files.filter((file) => !tracked.has(file));
}

export function unwrapOuterTransaction(content: string): string {
  const trimmed = content.trim();
  const match = trimmed.match(/^BEGIN;\s*([\s\S]*?)\s*COMMIT;$/i);
  return match?.[1].trim() ?? trimmed;
}

export async function applyMigrationAtomically(
  sql: MigrationClient,
  filename: string,
  content: string,
): Promise<void> {
  const executableSql = unwrapOuterTransaction(content);
  await sql.begin(async (tx) => {
    await tx.unsafe(executableSql);
    await tx.unsafe("INSERT INTO _migrations (filename) VALUES ($1)", [filename]);
  });
}
```

Replace automatic empty-table backfill in `scripts/apply-supabase-migrations.ts` with one read of tracked filenames, `getPendingMigrationFiles`, and `applyMigrationAtomically`. Always close connection in `finally`. Never infer that empty history means applied schema.

- [ ] **Step 4: Verify GREEN and regression**

Run:

```bash
rtk pnpm exec vitest run scripts/__tests__/migration-runner.test.ts
rtk pnpm typecheck
```

Expected: 5 tests PASS; no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
rtk git add scripts/migration-runner.ts scripts/__tests__/migration-runner.test.ts scripts/apply-supabase-migrations.ts
rtk git commit -m "fix: make migrations fail safely"
```

### Task 2: Harden pending EditorialBrief migrations

**Files:**

- Create: `lib/__tests__/pending-migrations-hardening.test.ts`
- Modify: `supabase/migrations/20260713000000_add_editorial_briefs.sql`
- Modify: `supabase/migrations/20260713000001_fix_editorial_briefs_fks.sql`
- Modify: `supabase/migrations/20260714000000_secure_editorial_briefs.sql`

- [ ] **Step 1: Write failing SQL contract tests**

Create a test that reads all three SQL files and asserts:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readMigration = (name: string) =>
  readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");

const base = readMigration("20260713000000_add_editorial_briefs.sql");
const fix = readMigration("20260713000001_fix_editorial_briefs_fks.sql");
const secure = readMigration("20260714000000_secure_editorial_briefs.sql");

describe("pending migration hardening", () => {
  it("enables RLS in the same migration that creates editorial tables", () => {
    for (const table of [
      "editorial_briefs",
      "chapter_editorial_contracts",
      "editorial_brief_sources",
    ]) {
      expect(base).toMatch(new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`, "i"));
    }
  });

  it("uses canonical Drizzle constraint names", () => {
    for (const name of [
      "chk_editorial_briefs_version",
      "chk_editorial_briefs_content_hash",
      "uq_editorial_briefs_project_version",
      "chk_contracts_content_hash",
      "uq_chapter_editorial_contracts_brief_chapter",
      "uq_editorial_brief_sources_brief_source",
    ]) expect(base).toContain(`CONSTRAINT ${name}`);
  });

  it("reconciles legacy automatic constraint names", () => {
    for (const legacy of [
      "editorial_briefs_version_check",
      "editorial_briefs_content_hash_check",
      "chapter_editorial_contracts_content_hash_check",
      "chapter_editorial_contracts_editorial_brief_id_chapter_id_key",
      "editorial_brief_sources_editorial_brief_id_source_id_key",
    ]) expect(fix).toContain(legacy);
  });

  it("protects source documents and chunks with owner-scoped RLS", () => {
    for (const table of ["sources", "source_chunks"]) {
      expect(secure).toMatch(new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`, "i"));
      expect(secure).toMatch(new RegExp(`CREATE POLICY ${table}_owner_select ON ${table}`, "i"));
    }
    expect(secure.match(/project_id\s+IN\s*\(/gi)).toHaveLength(2);
  });

  it("uses least privilege grants for public API roles", () => {
    expect(secure).toMatch(/REVOKE ALL[\s\S]+FROM anon/i);
    expect(secure).toMatch(/REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER[\s\S]+FROM authenticated/i);
    expect(secure).toMatch(/GRANT SELECT[\s\S]+TO authenticated/i);
  });

  it("caches auth.uid once per statement", () => {
    expect(secure).not.toMatch(/=\s*auth\.uid\(\)/i);
    expect(secure.match(/\(select auth\.uid\(\)\)/gi)?.length).toBeGreaterThanOrEqual(5);
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
rtk pnpm exec vitest run lib/__tests__/pending-migrations-hardening.test.ts
```

Expected: FAIL on immediate RLS, canonical names, source protection, grants, and optimized `auth.uid()`.

- [ ] **Step 3: Make initial install fail-closed**

In the base migration, replace inline unnamed constraints with these declarations:

```sql
CONSTRAINT chk_editorial_briefs_version CHECK (version > 0),
CONSTRAINT chk_editorial_briefs_content_hash CHECK (content_hash ~ '^[0-9a-f]{64}$'),
CONSTRAINT uq_editorial_briefs_project_version UNIQUE (project_id, version)

CONSTRAINT chk_contracts_content_hash CHECK (content_hash ~ '^[0-9a-f]{64}$'),
CONSTRAINT uq_chapter_editorial_contracts_brief_chapter
  UNIQUE (editorial_brief_id, chapter_id)

CONSTRAINT uq_editorial_brief_sources_brief_source
  UNIQUE (editorial_brief_id, source_id)
```

Immediately after the three `CREATE TABLE` statements, add:

```sql
ALTER TABLE editorial_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE chapter_editorial_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE editorial_brief_sources ENABLE ROW LEVEL SECURITY;
```

This leaves new tables deny-by-default if a later migration fails.

- [ ] **Step 4: Reconcile legacy constraint names**

Extend the fix migration with this catalog-driven block:

```sql
DO $$
DECLARE
  constraint_mapping record;
BEGIN
  FOR constraint_mapping IN
    SELECT *
    FROM (VALUES
      ('editorial_briefs'::regclass, 'editorial_briefs_version_check', 'chk_editorial_briefs_version'),
      ('editorial_briefs'::regclass, 'editorial_briefs_content_hash_check', 'chk_editorial_briefs_content_hash'),
      ('chapter_editorial_contracts'::regclass, 'chapter_editorial_contracts_content_hash_check', 'chk_contracts_content_hash'),
      ('chapter_editorial_contracts'::regclass, 'chapter_editorial_contracts_editorial_brief_id_chapter_id_key', 'uq_chapter_editorial_contracts_brief_chapter'),
      ('editorial_brief_sources'::regclass, 'editorial_brief_sources_editorial_brief_id_source_id_key', 'uq_editorial_brief_sources_brief_source')
    ) AS mappings(table_oid, legacy_name, canonical_name)
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = constraint_mapping.table_oid
        AND conname = constraint_mapping.legacy_name
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = constraint_mapping.table_oid
        AND conname = constraint_mapping.canonical_name
    ) THEN
      EXECUTE format(
        'ALTER TABLE %s RENAME CONSTRAINT %I TO %I',
        constraint_mapping.table_oid,
        constraint_mapping.legacy_name,
        constraint_mapping.canonical_name
      );
    END IF;
  END LOOP;
END $$;
```

- [ ] **Step 5: Harden policies and grants**

In the security migration:

- replace every `auth.uid()` comparison with `(select auth.uid())`;
- enable RLS on `sources` and `source_chunks`;
- create authenticated owner SELECT policies using direct indexed `project_id`;
- revoke all access from `anon` on all five tables;
- revoke mutation/DDL-related table privileges from `authenticated`;
- grant authenticated SELECT only;
- keep privileged server/service-role behavior unchanged.

Use these exact source policies and privilege changes:

```sql
ALTER TABLE sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sources_owner_select ON sources;
CREATE POLICY sources_owner_select ON sources
  FOR SELECT
  TO authenticated
  USING (
    project_id IN (
      SELECT p.id FROM projects p
      WHERE p.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS source_chunks_owner_select ON source_chunks;
CREATE POLICY source_chunks_owner_select ON source_chunks
  FOR SELECT
  TO authenticated
  USING (
    project_id IN (
      SELECT p.id FROM projects p
      WHERE p.user_id = (select auth.uid())
    )
  );

REVOKE ALL PRIVILEGES ON TABLE
  editorial_briefs,
  chapter_editorial_contracts,
  editorial_brief_sources,
  sources,
  source_chunks
FROM anon;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE
  editorial_briefs,
  chapter_editorial_contracts,
  editorial_brief_sources,
  sources,
  source_chunks
FROM authenticated;

GRANT SELECT ON TABLE
  editorial_briefs,
  chapter_editorial_contracts,
  editorial_brief_sources,
  sources,
  source_chunks
TO authenticated;
```

- [ ] **Step 6: Verify GREEN**

Run:

```bash
rtk pnpm exec vitest run lib/__tests__/pending-migrations-hardening.test.ts lib/__tests__/editorial-brief-security-migration.test.ts
rtk pnpm typecheck
```

Expected: 16 tests PASS; no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
rtk git add lib/__tests__/pending-migrations-hardening.test.ts supabase/migrations/20260713000000_add_editorial_briefs.sql supabase/migrations/20260713000001_fix_editorial_briefs_fks.sql supabase/migrations/20260714000000_secure_editorial_briefs.sql
rtk git commit -m "fix: harden editorial data access"
```

### Task 3: Verify SQL and security

**Files:** inspect only.

- [ ] Run focused tests, full suite, typecheck, lint, and `git diff --check`.
- [ ] Execute the three EditorialBrief migrations inside an explicit live-DB transaction, inspect RLS/constraints/policies/grants, then `ROLLBACK`.
- [ ] Confirm rollback removed all three EditorialBrief tables.
- [ ] Confirm no migration file uses `CREATE INDEX CONCURRENTLY`, so per-file transactions are legal.
- [ ] Confirm only planned files changed and both commits are conventional.

### Task 4: Reconcile local history and apply migrations

**Files/state:** dirty main checkout and local database.

- [ ] Restore `supabase/migrations/20260623170735_add_generation_prompt_unique_default.sql` in dirty main and remove untracked renamed duplicate `20260623215908_add_generation_prompt_unique_default.sql`.
- [ ] Fast-forward `main` to the hardening branch while preserving unrelated staged/untracked work.
- [ ] Run `rtk pnpm db:migrate`; expected pending set is exactly the three EditorialBrief migrations.
- [ ] Verify `_migrations`, RLS, policies, grants, canonical constraint names, single RESTRICT chapter FK, and absence of anon access.
- [ ] Run 605+ tests and typecheck on merged main.
- [ ] Remove worktree and merged branch.
