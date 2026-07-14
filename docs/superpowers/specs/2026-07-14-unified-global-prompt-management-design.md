# Unified Global Prompt Management Design

**Date:** 2026-07-14

## Goal

Make `/generation` the only management surface for every global, versioned prompt. Preserve chapter content prompts as contextual instances managed from book templates and projects. Remove legacy prompt CRUD, legacy runtime dependencies, and legacy database storage after a verified cutover.

## Decision

Use the prompt registry as the sole source of truth for global prompts:

- `prompt_definitions` owns stable identity, `kind`, name, description, and archive state.
- `prompt_revisions` owns immutable prompt text and execution contract.
- `prompt_defaults` selects one global revision per `kind`.
- `project_prompt_bindings` optionally overrides a global default for one project and `kind`.
- `llm_prompt_executions` records use of an exact revision.

`/generation` manages these records. It does not absorb chapter content prompts.

| Prompt class                                   | Management surface | Lifecycle                                                  |
| ---------------------------------------------- | ------------------ | ---------------------------------------------------------- |
| Global prompt definitions, revisions, defaults | `/generation`      | Versioned, immutable revisions, resolved by `kind`         |
| Template chapter prompts                       | `/admin/books/`    | Concrete prompt instances owned by a book template         |
| Project chapter prompts                        | `/projects/[id]/`  | Concrete prompt instances copied to and owned by a project |

Template and project chapter prompts remain outside the global registry because they have contextual identity, no global `kind`, and no default resolution.

## Prompt taxonomy and navigation

All nine registry kinds appear on `/generation`.

Primary tabs contain Core kinds:

1. `assembly-planner`
2. `assembly`
3. `critique`
4. `corrector`
5. `generation-system`
6. `meta-template`

A `More` control in the same page contains Utilities:

1. `title`
2. `placeholder-fill`
3. `editorial-brief-extractor`

The selected kind lives in the URL as `/generation?kind=<kind>`. Reloads, links, browser navigation, and legacy redirects therefore preserve selection. Invalid or missing kinds fall back to `generation-system`. When a Utility is selected, `More` shows the selected label and the page renders the same list and actions used by Core kinds.

Sidebar exposes one `Prompts` entry targeting `/generation`. `Prompt Library` and `Meta-Prompts` entries disappear.

## Domain invariants

### Definitions

- `kind` is immutable after creation.
- Name and description are editable.
- Delete is logical only: archive and restore through `archivedAt`.
- Active definitions appear in normal lists and pickers. Archived definitions appear only when the user enables the archived view or opens a direct historical link.
- An archived definition remains readable so revisions and execution history keep valid references.
- Archived definitions cannot receive new revisions, become defaults, receive new project bindings, or execute through an explicit revision ID.

### Revisions

- Revisions are append-only and immutable.
- Server assigns the next `revisionNumber` under the existing definition lock.
- `versionLabel` remains unique within a definition.
- Required markers, output contract, and configuration are part of the immutable snapshot.
- Creating a revision never changes the current default or project bindings.
- A historical revision with `configuration.legacyNonExecutable = true` remains visible but cannot become default, bind, or execute.

### Defaults and bindings

- A default points to an exact revision, not merely a definition.
- A project binding points to an exact revision and wins over the global default.
- Both operations require matching `kind`, an active definition, and an executable revision.
- Archiving is rejected while any revision of the definition is a current default or project binding.
- Past `llm_prompt_executions` never block archive because they are historical references, not active configuration.
- Resolver order remains `runRevisionId -> project binding -> global default`.

## `/generation` list experience

Each definition card shows:

- name and description;
- latest revision label and revision number;
- `Default: <version>` badge when any revision in that definition is current default, even when the default is not latest;
- distinct project-binding count across all its revisions;
- execution-attempt count across all its revisions;
- archived badge in archived view.

`N executions` counts every `llm_prompt_executions` row referencing a revision in the definition, regardless of final status. This measures attempts and keeps the metric auditable. Project usage counts rows in `project_prompt_bindings`; its `(project_id, kind)` primary key makes that equivalent to distinct projects for one definition and kind.

Active definitions are default view. A visible filter switches to archived definitions; archived rows do not mix silently into active pickers.

Creating a definition requires kind, name, and optional description. A definition may exist without revisions but cannot become executable until its first valid revision exists.

## Definition detail experience

The detail page provides four bounded actions:

1. **Edit metadata:** update name or description; kind stays read-only.
2. **Create revision from revision:** every revision can be selected as base. Dialog copies `systemTemplate`, `userTemplate`, `outputContract`, and editable configuration, then shows a live text diff between base and draft for both templates before save. The base revision remains unchanged.
3. **Set default:** action lives on each executable revision and shows which exact revision is current default. It requires explicit confirmation and does not alter project bindings.
4. **Archive or restore:** archive explains active blockers and returns their counts. Restore clears `archivedAt` without changing revisions, defaults, or bindings.

Revision rows show version, revision number, creation date, executable/historical status, exact default state, project-binding count, and execution count. Existing arbitrary revision comparison remains available separately from the base-to-draft preview.

## Canonical API and data flow

Existing registry endpoints remain canonical:

- `GET/POST /api/prompt-definitions`
- `GET/PATCH /api/prompt-definitions/[id]`
- `GET/POST /api/prompt-definitions/[id]/revisions`
- `GET/PUT /api/prompt-defaults/[kind]`
- `GET/PUT/DELETE /api/projects/[id]/prompt-bindings`

Required changes:

- Definition list accepts `kind` and archived-view filters.
- Definition list returns `latestRevision`, `defaultRevisionId`, `bindingCount`, and `executionCount` using aggregated queries. It must not issue one revision/default/count query per definition.
- Definition detail returns usage fields per revision plus definition-level totals.
- Definition `PATCH` treats `archived: true` as archive and `archived: false` as restore. Restore explicitly writes `archivedAt = null`.
- Revision creation rejects archived definitions before assigning a number.
- Default and binding validation rejects archived definitions in addition to kind mismatches and legacy non-executable revisions.
- Runtime resolution rejects archived definitions for direct revision IDs as well as defaults and bindings.
- Duplicate version labels return `409 Conflict`, not a generic `500`.

Mutations retain CSRF checks and admin authorization for global configuration. Project binding mutation retains project ownership checks. No authorization broadening belongs to this change.

## Archive behavior

Archive is a safe state transition, not deletion.

1. Load all revisions belonging to the definition.
2. Count current default and project-binding references.
3. If either count is non-zero, return `409 Conflict` with structured blocker counts.
4. Otherwise set `archivedAt` once.
5. Repeated archive of an archived definition is idempotent.
6. Restore sets `archivedAt` to `null`; repeated restore is idempotent.

The UI presents blocker counts and directs the administrator to move defaults or bindings first. It never rewrites those references automatically.

## Legacy cutover

Legacy surfaces are:

- `/prompt-library` and `/prompt-library/[id]`;
- `/meta-prompts` and `/meta-prompts/[id]`;
- `/api/prompt-library` and `/api/prompt-library/[id]`;
- `/api/meta-prompts` and `/api/meta-prompts/[id]`;
- `/api/generation-prompts` and `/api/generation-prompts/[id]`;
- `prompt_library`, `meta_prompts`, and `generation_system_prompts`;
- `projects.assembly_prompt_id` and `projects.generation_system_prompt_id`.

Cutover order is mandatory:

1. Complete canonical `/generation` CRUD, defaults, archive/restore, usage, and revision workflows.
2. Remove legacy sidebar links. Replace legacy pages with server redirects to `/generation`; map prompt-library categories to their matching `kind` and map Meta-Prompts to `meta-template`.
3. Freeze legacy APIs. Mutation methods return `410 Gone` with `{ error, replacement: "/generation" }`. No legacy write remains possible after this release point.
4. Run a final idempotent catch-up snapshot from all three legacy tables. This captures rows created or changed after migration `20260714000002_add_prompt_registry.sql`. Each snapshot is keyed by a hash of the complete frozen legacy row, including name and description; existing canonical definition metadata is not overwritten. New catch-up snapshots are historical and `legacyNonExecutable`; canonical defaults and bindings are not overwritten.
5. Retire `scripts/assemble-chapter.ts` before schema contraction. It is a hard-coded, intentionally disabled one-off that reads `projects.assembly_prompt_id` and `prompt_library` through raw SQL. The official planner plus assembler pipeline is the only supported assembly path.
6. Remove every production schema import and read of legacy fields/tables.
7. Execute parity gates and only then drop legacy columns and tables.
8. Keep small legacy API handlers returning `410 Gone`, including reads, after physical drop. They must not query removed tables. A later compatibility cleanup may remove these handlers and accept `404`, but that is outside this change.

Historical migration files remain unchanged. New contraction migration performs the final snapshot, assertions, and drops.

## Parity gates before destructive migration

The contraction migration aborts before any `DROP` when one gate fails.

### Generation-system project parity

Migration `20260714000002_add_prompt_registry.sql:168` initially backfilled project selections. Migration `20260714000004_seed_transparent_runtime_prompts.sql:386` then moved those bindings from non-executable imported revisions to executable transparent revisions.

Therefore parity is definition-level, not old-revision-ID equality. For every project with non-null `generation_system_prompt_id`:

- a `project_prompt_bindings` row exists for `generation-system`;
- bound revision exists and is executable;
- bound revision belongs to the deterministic registry definition imported from that legacy prompt ID;
- bound definition is active.

A missing binding or binding to a different definition aborts migration. A newer executable revision within the same definition is valid.

### Assembly cutover parity

Legacy per-project assembly selections are intentionally not migrated because the approved pipeline replaced them with `assembly-planner` plus `assembly` resolution. Before dropping `assembly_prompt_id`:

- production source has no reads of the field or `prompt_library`;
- executable active defaults exist for both `assembly-planner` and `assembly`;
- planner and assembler integration tests pass through registry resolution.

### Historical preservation parity

Every row in each legacy table must have a deterministic registry definition and at least one historical snapshot representing its final frozen state. Count mismatch or missing snapshot aborts migration.

## Physical contraction

After all gates pass, one transaction:

1. drops `projects.assembly_prompt_id`;
2. drops `projects.generation_system_prompt_id`;
3. drops `prompt_library`;
4. drops `meta_prompts`;
5. drops `generation_system_prompts`.

The application release preceding this transaction already removes legacy table modules, project fields, and barrel exports; that code remains compatible while the database temporarily retains extra legacy objects. Foreign-key order in the contraction transaction is handled by dropping project columns before referenced tables. No registry records or historical executions are deleted.

## Error contract

Canonical endpoints use consistent status semantics:

- `400 Bad Request`: malformed input, missing marker, reserved configuration, kind mismatch, or non-executable revision;
- `401 Unauthorized`: no session;
- `403 Forbidden`: authenticated caller lacks required global-admin permission;
- `404 Not Found`: definition, revision, or owned project is unavailable;
- `409 Conflict`: duplicate version label, archive blockers, or concurrent state conflict;
- `410 Gone`: retired legacy endpoint with canonical replacement;
- `500 Internal Server Error`: unexpected failure only.

UI preserves current data after mutation failure, shows actionable server text, and refreshes canonical data after success. No optimistic default, archive, or restore transition hides a failed write.

## Testing strategy

### Repository and API tests

- all nine kinds validate and list;
- Core and Utilities group membership is exact;
- list filters by kind and archive state;
- usage aggregation returns correct definition and revision counts without N+1 calls;
- metadata edit cannot change kind;
- revision creation copies a selected base in UI but inserts a new immutable row;
- revision creation on archived definition fails;
- default and binding require matching kind, active definition, and executable revision;
- project binding wins over default; absent binding falls back to default;
- direct revision resolution rejects archived and legacy non-executable revisions;
- archive blocks active defaults/bindings and restore clears `archivedAt`;
- duplicate `versionLabel` returns `409`.

### UI tests

- six Core tabs and three Utilities under `More` render consistently;
- kind query parameter survives reload and back/forward navigation;
- default badge identifies the actual default even when an older revision is selected;
- definition and revision usage counts render;
- create-from-revision initializes the chosen revision and previews system/user diffs;
- archived view, blocker message, archive, and restore work;
- legacy page URLs redirect to the correct `/generation?kind=...` destination;
- sidebar contains no legacy prompt links.

### Migration and regression tests

- final catch-up captures legacy rows created or modified after the original backfill;
- contraction migration is idempotent where operations permit and succeeds on a valid upgraded database;
- migration aborts on missing/mismatched generation-system binding;
- migration aborts when an assembly default is absent or non-executable;
- migration aborts when a legacy row lacks a final historical snapshot;
- fresh database migration chain succeeds;
- static audit finds no production reads of legacy tables or project columns, including raw SQL;
- every legacy API method returns `410` without database access after drop;
- focused tests, full tests, typecheck, lint, and production build pass.

## Rollout sequence

1. Ship canonical UI/API enhancements and tests while legacy storage still exists.
2. Ship redirects, sidebar cleanup, legacy API write freeze, and script retirement.
3. Verify no legacy writes or production reads in deployed code.
4. Run final catch-up and parity report.
5. Apply destructive contraction migration.
6. Run smoke tests for `/generation`, fragment generation, planner, assembly, critique, correction, title, placeholder fill, and editorial brief extraction.

Rollback before step 5 re-enables old code but must not re-enable legacy writes without reconciliation. Rollback after step 5 restores application code only if it is registry-only; restoring legacy storage requires database backup and is not the normal rollback path.

## Non-goals

- Moving template or project chapter prompts into the registry.
- Versioning contextual chapter prompt instances differently.
- Reintroducing assembly algorithms or a second manual assembly path.
- Automatically changing project bindings when a new revision becomes default.
- Editing or deleting historical revisions or executions.
- Changing prompt text, output contracts, editorial policy, or model selection.
- Changing current authorization roles.

## Success criteria

- `/generation` is the only visible CRUD surface for all nine global prompt kinds.
- Definitions support metadata update, immutable revisions, exact defaults, usage, archive, and restore.
- No hidden legacy prompt store can accept writes.
- Runtime resolves global prompts only through registry revision, project binding, and default records.
- `projects.generation_system_prompt_id` and `projects.assembly_prompt_id` are absent without losing approved generation-system project selection.
- Legacy tables are absent after final snapshots and parity gates pass.
- Contextual chapter prompts remain managed only in `/admin/books/` and `/projects/[id]/`.
