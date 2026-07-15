# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```
pnpm dev              # Next.js dev server
pnpm build            # Production build
pnpm typecheck        # TypeScript check (tsc --noEmit)
pnpm test             # Vitest test suite
pnpm lint             # ESLint

pnpm db:generate      # Generate Drizzle migrations from schema
pnpm db:migrate        # Apply pending migrations to REMOTE DB (.env.local DATABASE_URL)
pnpm db:migrate:local  # Sync + apply pending migrations to local Supabase (127.0.0.1:54322)
pnpm db:push           # Push Drizzle schema directly to DB
pnpm db:studio         # Drizzle Studio (DB browser)
pnpm db:seed           # Seed initial book template + chapters

pnpm trigger:dev      # Trigger.dev local dev server
pnpm trigger:deploy   # Deploy Trigger.dev tasks
```

## Architecture

**Platform for generating small non-fiction books in Spanish.** Users create projects with a topic → select a book template → the system generates chapters via chapter-specific AI prompts stored in DB → assembled into a complete book.

### Core Data Model

```
book_templates ──< chapters ──< prompts (8 content + 1 assembly per chapter)
projects ──< chapter_generations ──< fragments
```

- **book_templates**: A book structure — name + description. Admin creates via UI.
- **chapters**: Belongs to a template or project, ordered by `position`. Has CHECK constraint: `book_template_id IS NOT NULL OR project_id IS NOT NULL`.
- **prompts**: Unified chapter prompts table. `projectId=NULL` = template prompt, `projectId` set = project prompt. Each has `isAssembly`, `isCritique`, `isCorrector` boolean flags (mutually exclusive in practice), `content` with `{tema}` placeholder, `userPrompt` (optional user-visible prompt text), `sourceContext` (original source material for domain context — never copied verbatim), `function` (semantic label for placeholder routing), `notes` (guidance for placeholder fill LLM). Stored in DB — not code. Admin edits via `/admin/books/`.
- **projectPrompts**: REMOVED — merged into `prompts` table. `projectId` column distinguishes project prompts from template prompts.
- **projects**: A user's book instance — has `topic` (replaces `{tema}` placeholder), `lastAccessedAt` (updated on GET, drives dashboard ordering), optional `generationSystemPromptId` FK, and links to a `book_template`.
- **book_templates**: Has `status` field: `"ready"` (available), `"generating"` (AI is creating template structure), `"failed"` (auto-generation failed). Templates with non-ready status are disabled in the create-project dialog.
- **chapterGenerations**: Per-chapter generation execution. Status: pending → generating → assembling → completed/failed. Created per-chapter, not per-book. Distinguished by `generationMetadata.type`: `null` (original assembly), `"critique"` (AI critique output), `"correction"` (corrected chapter text).
- **fragments**: Individual AI responses for each prompt in a chapter generation. Has `projectPromptId` FK → `prompts.id`.
- **chapterPlaceholders**: Dynamic `{name}` tokens extracted from prompts, with optional AI-filled definitions. Unique per (chapterId, name).
- **prompt_library**: Unified admin-editable prompt library. `category` column distinguishes: `"assembly"`, `"critique"`, `"corrector"`. Replaces former `assemblyPrompts`, `critiquePrompts`, and `correctorPrompts` tables. CRUD via `/api/prompt-library` with `?category=` filter.
- **generationSystemPrompts**: Configurable system prompts for content generation. FK on `projects.generationSystemPromptId`.

### Book Generation Pipeline

Per-chapter generation triggered via `trigger/generate-chapter.ts` (Trigger.dev task):

1. API route creates a `chapterGeneration` row with status `pending`, triggers `generateChapter` task
2. Task transitions pending → generating, then generates content fragments for non-assembly prompts sequentially via `generatePromptContent()`
3. After all content fragments: transitions generating → assembling, runs the assembly prompt with all fragments via `generateChapterAssembly()`
4. Marks generation completed; on error, marks failed

No book-level orchestrator — each chapter is triggered individually from the UI or API. The `{tema}` placeholder (and other `{name}` tokens) are resolved from `chapterPlaceholders` definitions, with `project.topic` as fallback when the `tema` definition is NULL.

### Critique & Correction Pipeline

Users can critique assembled chapters and apply corrections via the chapter UI:

1. **Critique** (`app/api/projects/[id]/chapters/[chapterId]/critique/route.ts`): Selects the latest non-critique content (prefers most recent correction, falls back to original assembly). Runs a critique prompt via `generateChapterCritique()`. Output stored as `chapterGeneration` with `generationMetadata.type = "critique"`.
2. **Correction** (`app/api/projects/[id]/chapters/[chapterId]/correct/route.ts`): Takes a critique generation + corrector prompt. Same content selection logic (prefers latest correction). Runs via `generateChapterCorrection()`. Output (corrected chapter text) stored as `chapterGeneration` with `generationMetadata.type = "correction"`. LLM outputs `<capitulo_corregido>` with embedded `<correcciones>` containing `<correccion>` blocks (antes/despues/hallazgo/motivo).
3. **Re-critique**: After correction, the next critique analyzes the corrected version (not the original). Corrections chain — each correction builds on the previous one. Only critique outputs (`type = "critique"`) are excluded as input.
4. **UI**: Corrections appear as versions in the Assembly Results version selector (same card as original assemblies). The `CorrectionDiff` component (exported from `corrector-section.tsx`) renders antes/despues diffs inline below the content when viewing a corrected version. The corrector modal (prompt picker + run button) opens from `CorrectorPromptSection`.

### AI Layer (`lib/ai/`)

- **`completion.ts`**: Single entry point for all LLM calls (`generateCompletion`). Routes to Anthropic, OpenAI, Google, or DeepSeek based on model ID. Handles structured output (Zod schemas), prompt caching (Anthropic ephemeral cache), and provider-specific quirks (Anthropic JSON schema sanitization, OpenAI strict mode, DeepSeek JSON retry).
- **`providers.ts`**: Model catalog with pricing, provider mapping, and stage-to-model defaults.
- **`clients/`**: SDK instances for each provider.
- **`rag.ts`**: Vector retrieval + Cohere rerank.
- **`embeddings.ts`**: Embedding generation via OpenAI.
- **`web-search.ts`**: Web search via Exa (primary) + Tavily (fallback). Used for research but NOT for placeholder fill (placeholder fill uses LLM-only).
- **`placeholder-fill.ts`**: Fills `{name}` placeholders with AI-generated definitions. Research providers: `"rag"` (vector search), `"semantic-scholar"` (academic papers), `"llm"` (LLM knowledge only — no external search), `"direct"` (DB-resolved). Source context from `prompts.sourceContext` is fed to the LLM as domain reference (never copied).

### Auth

Supabase SSR with `@supabase/ssr`. Middleware (`middleware.ts`) protects all routes except auth pages. Has a deduplication mechanism for concurrent `getUser()` calls to prevent refresh-token race conditions. API routes return 401 JSON, page routes redirect to `/login`.

Server components use `createClient()` from `lib/supabase/server.ts`. Client components use `lib/supabase/browser.ts`.

### Rate Limiting (`lib/api/rate-limit.ts`)

Two layers: PostgreSQL advisory lock per project via `withProjectLock()` (serializes critical sections at DB level) + sliding window check via `checkProjectRateLimit()` (max 1 active run per project per 30min stale window). Uses a dedicated `postgres` client connection pool for advisory lock critical sections.

**Critical pattern**: Rate check + insert must be atomic inside `withProjectLock`. Release lock before LLM calls — never hold advisory lock during external API work. See Key Conventions → Rate Limiting Conventions for code pattern.

### UI

- **Admin** (`/admin/books/`): Prompt editor UI. Edit book templates, chapters, and individual prompts with `{tema}` placeholder insertion.
- **Generation** (`/generation/`): Admin UI for managing generation system prompts. CRUD operations on system prompts that configure LLM behavior during content generation.
- **Projects** (`/projects/`): User dashboard. Create projects, start generation, view chapter generation progress with polling (3s interval while running). Templates with `status: "generating"` or `"failed"` are disabled in the create dialog.
- **Chapter** (`/projects/[id]/chapters/[chapterId]/`): Per-chapter page. Assembly Results card shows chapter content with version selector (includes original assemblies and corrections). Critique Results card shows critique output with "Correct" action. `CorrectorPromptSection` manages project-level corrector prompt assignment.
- **Auth** (`/login`, `/signup`, etc.): Copied from redactor-v2.
- **Components**: shadcn/ui + Radix primitives in `components/ui/`. Custom components in `components/prompts/` and `components/projects/`.

## Key Conventions

- **DB access**: Use `db` from `lib/db/drizzle.ts`. Schema re-exports from `lib/db/schema/`. Queries in `lib/db/queries/`.
- **API routes**: Next.js 15 `params: Promise<{ id: string }>` async pattern. All routes auth-gate with `createClient()` + `getUser()`.
- **API verb convention**: POST = create, PUT = full replace, PATCH = partial update. Book/chapter templates use PUT for idempotent create-or-replace semantics (backward compat — not strictly RESTful). Project-scoped routes use POST for creation, PATCH for partial updates where applicable.
- **Error responses**: All routes return `NextResponse.json({ error: string }, { status: N })`. Validation errors: 400. Auth errors: 401 (no user) or 403 (admin-only). Not found: 404. Conflict (e.g. lock busy): 409. Rate limit: 429. Internal: 500. Success responses: `NextResponse.json(data)` (default 200) or `NextResponse.json(data, { status: 201 })` for resource creation.
- **No v2 prompt files**: v4 stores prompts in DB. The `lib/prompts/` directory from v2 does NOT exist here. Old imports like `@/lib/prompts/unit-brief-small-book` are dead code.
- **No v2 voice corpus**: v4 defines style via prompt content and assembly/critique/correction pipeline, not external corpus files.
- **No `after()` fragility**: Pipeline runs fully in Trigger.dev, not in Next.js `after()` callbacks.

### Security Conventions [hard]

- **Auth gates by route type**:
  - Global prompt CRUD (prompt_library, meta-prompts, generation-prompts) → `requireAdmin()` from `lib/auth/admin.ts`. Returns `{ authorized: true, user }` or `{ authorized: false, response }`.
  - Project-scoped routes → `createClient()` + `getUser()`, then verify `project.userId === user.id`.
  - Admin-only + project-scoped in same route (e.g. version restore) → resolve resource type first, gate accordingly.
- **CSRF**: All mutation routes (POST, PUT, PATCH, DELETE) must call `csrfCheck(req)` as the FIRST check, before auth. Return its error response if non-null.
- **Secrets**: Never hardcode API keys, tokens, or credentials. Use `process.env` / `os.environ.get()`. Python scripts in `dspy_optimizer/` use `load_dotenv(Path(__file__).resolve().parents[3] / ".env")` + `os.environ.get()`.
- **Storage ownership**: `lib/storage/sources.ts` `verifyProjectOwnership()` must compare `project.userId !== userId`. Callers (`downloadSourceFile`, `deleteSourceFile`, `getSignedDownloadUrl`) pass userId — function must use it.

### Rate Limiting Conventions [hard]

- **TOCTOU protection**: Rate check + generation insert must be atomic. Wrap in `withProjectLock(projectId, async () => { ... })`. Release lock before LLM call — never hold advisory lock during external API work.
- **Pattern**:
  ```ts
  const lockResult = await withProjectLock(projectId, async () => {
    const rateLimit = await checkProjectRateLimit(projectId);
    if (!rateLimit.allowed) return { rateLimited: true, retryAfter: rateLimit.retryAfter };
    const [gen] = await db.insert(chapterGenerations).values({...}).returning();
    return { rateLimited: false, gen };
  });
  if (!lockResult.locked) return 409;
  if (lockResult.result.rateLimited) return 429;
  // LLM call outside lock
  ```
- **Sliding window**: `checkProjectRateLimit` checks max 1 active generation (pending/generating/assembling) per project per 30min window. Used by prompt generation and placeholder fill routes.
- **Stale cleanup**: Before inserting a new generation row, clean up stale rows (status stuck in "generating" for >30min). Do this inside the lock.

### Data Integrity Conventions [hard]

- **Multi-table inserts**: Use `db.transaction(async (tx) => { ... })`. Don't insert source then chunks separately — chunk failure leaves orphaned `processed=true` source.
- **Template prompt copy**: Use `copyTemplatePromptsToChapter()` from `lib/db/queries/copy-template-prompts.ts`. This shared function handles prompt + placeholder copying so API routes don't need to stay in sync. For batch placeholder copies across multiple chapters, use `copyTemplatePlaceholdersBatch()`.
- **Template rebuild**: When regenerating template prompts on retry, delete existing prompts + insert new ones + upsert placeholders atomically in one `db.transaction`. `onConflictDoNothing` keeps stale prompts from prior partial attempts.
- **Placeholder hash**: Must include both `content` and `userPrompt` for stale detection. Select `{ content, userPrompt }`, hash `[p.content, p.userPrompt].filter(Boolean).join("")`.

### Prompt Type Conventions [hard]

- **Three exclusion flags**: `isAssembly`, `isCritique`, `isCorrector`. Content generation must filter ALL three: `(p) => !p.isAssembly && !p.isCritique && !p.isCorrector`.
- **Assembly prompt**: `isAssembly = true`. One per chapter. Runs after all content fragments complete.
- **Critique prompt**: `isCritique = true`. Used by critique pipeline. NOT content.
- **Corrector prompt**: `isCorrector = true`. Used by correction pipeline. NOT content.
- **`promptVersions.promptId`**: References `prompts.id` (both template and project prompts). Template prompts (`projectId=NULL`) → require admin. Project prompts (`projectId` set) → verify project owner.

### State Machine Conventions [hard]

- **Generation status flow**: `pending` → `generating` → `assembling` → `completed` | `failed`.
- **UI polling**: Must poll on ALL active states: `status === "pending" || status === "generating" || status === "assembling"`. Polling only on `"generating"` misses pending (not yet picked up by Trigger) and assembling (after content, before completion).
- **Template status**: `ready` | `generating` | `failed`. Non-ready templates disabled in project creation dialog.

## Database Migrations

Migrations live in `supabase/migrations/` and run via `scripts/apply-supabase-migrations.ts`. Custom `_migrations` table tracks applied files (not Supabase's native `schema_migrations`).

### Local vs Remote

| Command                 | Target              | DB Source                                      |
| ----------------------- | ------------------- | ---------------------------------------------- |
| `pnpm db:migrate`       | Remote (production) | `.env.local` → `DATABASE_URL`                  |
| `pnpm db:migrate:local` | Local Supabase      | `127.0.0.1:54322`                              |
| `supabase db reset`     | Local (full reset)  | Applies all migrations natively, then restarts |

`db:migrate:local` runs `sync-local-migrations.ts` first — seeds the `_migrations` table from files on disk since `supabase db reset` applies migrations through Supabase's own mechanism.

### Migration Runner (`scripts/migration-runner.ts`)

- `getPendingMigrationFiles(files, tracked)` — filters disk files against `_migrations` table
- `unwrapOuterTransaction(content)` — strips `BEGIN;/COMMIT;` wrapper (handles leading SQL comments)
- `applyMigrationAtomically(sql, filename, content)` — runs unwrapped SQL in transaction + tracks filename

Migration files may optionally wrap content in `BEGIN;/COMMIT;`. The runner unwraps them because it manages its own transaction (needed for atomic `_migrations` insert). SQL comments before `BEGIN;` are supported.

### Local Supabase Setup

Docker via Colima. Workarounds applied:

- **Docker socket**: symlinked `/tmp/docker.sock` → `~/.colima/default/docker.sock`; `DOCKER_HOST=unix:///tmp/docker.sock` in `~/.zshrc`
- **Disabled services** in `supabase/config.toml`: `analytics`, `edge_runtime` (require Docker socket mount — incompatible with Colima's VM filesystem)
- **Mount type**: `sshfs` (virtiofs also works; neither supports Unix socket sharing across VM boundary)

## Environment Variables

### Resolution Order (Next.js)

```
.env.local > .env.development/.env.production > .env
```

`.env.local` siempre gana. No se commitea. `.env` es fallback con defaults seguros (sin secrets reales).

### File Purposes

| Archivo        | Git           | Contenido                                                |
| -------------- | ------------- | -------------------------------------------------------- |
| `.env.example` | ✅ commiteado | Template con placeholders, secciones local/remoto        |
| `.env`         | ❌ gitignored | Defaults no-sensibles (localhost, keys vacías)           |
| `.env.local`   | ❌ gitignored | **Activo** — secrets reales. Creado desde `.env.example` |

### Local vs Remote

Para desarrollo local, `.env.local` debe apuntar a `127.0.0.1`:

```
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321"
NEXT_PUBLIC_SUPABASE_ANON_KEY="<valor de supabase status>"
SUPABASE_SERVICE_ROLE_KEY="<valor de supabase status>"
```

Para producción (Vercel), `.env.local` apunta a Supabase remoto:

```
DATABASE_URL="postgresql://postgres.<ref>:<pwd>@aws-1-us-west-1.pooler.supabase.com:6543/postgres"
NEXT_PUBLIC_SUPABASE_URL="https://<ref>.supabase.co"
```

**Migration scripts** cargan `.env.local` → `.env` (mismo orden que Next.js). `db:migrate:local` ignora ambos — hardcodea `127.0.0.1:54322`.

Required vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `DEEPSEEK_API_KEY`, `EXA_API_KEY`, `TAVILY_API_KEY`, `COHERE_API_KEY`, `TRIGGER_SECRET_KEY`.

## Removed from v2

- `lib/prompts/` — prompts now in DB
- `lib/voice/` — style now in prompt fields
- `lib/db/schema/voice.ts`, `sources.ts`, `run-logs.ts` — not in v4 schema
- `lib/db/queries/runs.ts`, `projects.ts`, `sources.ts` — replaced by inline queries or `queries/books.ts`
- `lib/config/models.ts` — model config folded into `providers.ts`
- `lib/sources/source-kind.ts` — not used
- Spanish fork (`-es` routes/prompts) — only Spanish, no duplication

<!-- TRIGGER.DEV SKILLS START -->

## Trigger.dev agent skills

This project has Trigger.dev agent skills installed in `.claude/skills/`. Before writing or changing Trigger.dev code (background tasks, scheduled tasks, realtime, or chat.agent AI agents), load the most relevant skill: `trigger-authoring-tasks`, `trigger-chat-agent-advanced`, `trigger-cost-savings`, `trigger-getting-started`, `trigger-realtime-and-frontend`.

<!-- TRIGGER.DEV SKILLS END -->
