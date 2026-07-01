# Redactor Project — Comprehensive Audit Prompt

## Project Context

Next.js 15 App Router + TypeScript + Drizzle ORM + PostgreSQL + Supabase SSR + Trigger.dev. Platform for generating small non-fiction books in Spanish. Users create projects with a topic → select/book template → system generates chapters via AI prompts stored in DB → assembled into complete book.

**Key directories:**
- `app/api/` — API routes (Next.js 15 `params: Promise<{ id }>` async pattern)
- `lib/db/schema/` — Drizzle ORM table definitions
- `lib/db/queries/` — reusable DB query functions
- `lib/ai/` — LLM completion, providers, RAG, embeddings, placeholder-fill, web-search, schema-sanitizers
- `components/` — React components (shadcn/ui + Radix)
- `trigger/` — Trigger.dev background tasks (chapter generation, critique, correction, template generation)
- `scripts/` — one-off scripts (assemble-chapter.ts)

**Auth:** Supabase SSR. Admin routes use `requireAdmin()`, user routes use `createClient()` + `getUser()` + project ownership check.

**Rate limiting:** PostgreSQL advisory locks via dedicated connection pool (`lib/db/lock-pool.ts`) + sliding window check (`lib/api/rate-limit.ts`). Critical: rate check + generation insert must be atomic inside `withProjectLock()`. Never hold advisory lock during external API calls.

## Data Model

```
book_templates ──< chapters ──< prompts (template: projectId=NULL, project: projectId set)
projects ──< chapter_generations ──< fragments
prompt_library (category: assembly|critique|corrector)
chapter_placeholders — dynamic {name} tokens with AI-filled definitions
prompt_versions — version history, FK → prompts.id
```

**Key conventions:**
- `prompts.isAssembly`, `isCritique`, `isCorrector` — mutually exclusive boolean flags
- Content generation filters: `!isAssembly && !isCritique && !isCorrector`
- `chapterGenerations.status`: pending → generating → assembling → completed | failed
- `chapterGenerations.generationMetadata.type`: null (assembly), "critique", "correction", "fill", "title", "prompt"
- `fragments.projectPromptId` → `prompts.id` (column name preserved from old `project_prompts` FK)
- `projects.assemblyPromptId` → `prompt_library.id`
- `promptVersions.promptId` → `prompts.id` (both template and project)
- Template prompts: `prompts.projectId IS NULL`
- Project prompts: `prompts.projectId IS NOT NULL`

## Audit Dimensions

### 1. Security (CRITICAL)

Check every API route for:
- [ ] CSRF check (`csrfCheck(req)`) as FIRST check on ALL mutation routes (POST/PUT/PATCH/DELETE)
- [ ] Auth gate present and correct: admin routes use `requireAdmin()`, user routes use `getUser()` + ownership check
- [ ] IDOR prevention: project-scoped routes verify `project.userId === user.id`
- [ ] No secrets hardcoded — only `process.env`
- [ ] Input validation on all request bodies (type checks, length limits)
- [ ] SQL injection via raw SQL or unsanitized inputs
- [ ] Error messages don't leak internal state (DB errors, stack traces)
- [ ] `isNotNull(prompts.projectId)` guard on project-scoped prompt DELETE to prevent template prompt deletion
- [ ] `isNull(prompts.projectId)` filter when reading template prompts
- [ ] `eq(promptLibrary.category, '...')` filter on ALL library prompt lookups

### 2. Rate Limiting & Race Conditions

Check every generation-triggering route (assemble, critique, correct, fill, generate, generate-title):
- [ ] Rate check + generation insert atomic inside `withProjectLock()`
- [ ] Lock released before LLM calls (never hold advisory lock during external API work)
- [ ] Stale cleanup: before inserting new generation, clean up rows stuck in "pending"/"generating" for >30min
- [ ] Stale cleanup filters by correct `generationMetadata.type`
- [ ] Stale cleanup inside or immediately before the lock
- [ ] Rate limit error returns 429 with `retryAfter`

### 3. Data Integrity

Check all multi-table operations:
- [ ] Multi-table inserts wrapped in `db.transaction()`
- [ ] No orphaned rows from partial failures
- [ ] FK constraints match schema definitions
- [ ] Cascade delete behavior correct (especially chapter → prompts → fragments chain)
- [ ] `copyTemplatePromptsToChapter()` handles all fields
- [ ] Placeholder sync consistent (both `{tema}` variants and other placeholders)
- [ ] Template prompt vs project prompt distinction never confused

### 4. Performance

- [ ] N+1 queries in loops (check all `for...of` with `await db...` inside)
- [ ] Missing `.select()` column narrowing (especially `assembledContent` which can be 50-200KB)
- [ ] Missing pagination (`.limit()`) on list endpoints
- [ ] Missing indexes on frequently filtered columns
- [ ] Parallel vs sequential I/O (could independent DB reads be `Promise.all`?)
- [ ] Unnecessary data fetching (loading full rows when only need id/title)
- [ ] `getUser()` deduplication for concurrent calls

### 5. Error Handling

- [ ] All `await` expressions have error handling (try/catch or `.catch()`)
- [ ] `req.json()` uses `.catch(() => ({}))` to handle malformed JSON
- [ ] SSE streams have error handling in both `start` and individual event processing
- [ ] Trigger.dev tasks handle failures gracefully (update generation to "failed")
- [ ] No unhandled promise rejections in async generators
- [ ] LLM calls have timeout/error handling

### 6. Code Quality

- [ ] Dead code: unused imports, unreachable blocks, functions never called
- [ ] Duplicated logic across routes (copy-paste patterns that should be shared)
- [ ] Type safety: no `as` casts that bypass type checking, no `any` types in critical paths
- [ ] Magic strings: hardcoded values that should be constants
- [ ] Consistent error response shapes across routes
- [ ] Audit logging present on all create/update/delete operations
- [ ] Comments match actual code behavior (stale comments)

### 7. API Design

- [ ] Consistent route naming conventions
- [ ] Consistent response shapes (error as `{ error: string }`, success as resource or `{ ok: true }`)
- [ ] Appropriate HTTP status codes (400 for validation, 401 for auth, 403 for forbidden, 404 for not found, 409 for conflict, 429 for rate limit, 500 for internal)
- [ ] Query parameters vs path parameters used correctly
- [ ] Request body validation before any DB queries (fail fast)

### 8. AI/LLM Integration

- [ ] Structured output schemas used where possible (instead of JSON.parse on free text)
- [ ] Provider-specific quirks handled (Anthropic JSON schema sanitization, OpenAI strict mode, DeepSeek JSON retry)
- [ ] Token usage tracked and stored on fragments
- [ ] Prompt caching used for repeated prompts (Anthropic ephemeral cache)
- [ ] Placeholder resolution correct: `{tema}` resolves from `chapterPlaceholders.definition` → `project.topic` fallback
- [ ] Source context fed to LLM as domain reference, never copied verbatim

### 9. Frontend

- [ ] React hooks dependencies correct (exhaustive-deps)
- [ ] Loading, empty, error states covered in all data-fetching components
- [ ] No memory leaks (abort controllers on unmount, event listener cleanup)
- [ ] Accessibility: form labels, button text, keyboard navigation
- [ ] Suspense boundaries for async components using `useSearchParams()`
- [ ] URL state management (search params, not component state, for shareable URLs)

### 10. Testing

- [ ] Critical paths have test coverage (schema sanitizers, placeholders, generation logic)
- [ ] Test helpers reusable across test files
- [ ] Mocks don't mask real bugs (verify mock matches actual interface)
- [ ] Edge cases covered: null/undefined inputs, empty arrays, boundary values
- [ ] Missing test coverage for newly created routes (prompt-library)

### 11. Operations

- [ ] `.env` variables documented and validated at startup
- [ ] Graceful degradation when optional services unavailable (Exa, Tavily, Cohere)
- [ ] Logging: errors include enough context for debugging, successes don't log sensitive data
- [ ] Migrations are reversible and idempotent

## Output Format

For each finding, report:
```
### [PRIORITY] [DIMENSION] Title

**File:** `path/to/file.ts:line`
**Issue:** Description of the problem
**Impact:** What goes wrong
**Fix:** Concrete fix suggestion (code if applicable)
```

**Priority levels:**
- **CRITICAL**: Security vulnerability, data loss, data corruption
- **HIGH**: Functional bug, race condition, incorrect behavior
- **MEDIUM**: Performance issue, missing validation, inconsistent behavior
- **LOW**: Clean code, style, minor optimization, nit
- **FALSE POSITIVE**: Flag if something looks wrong but is actually correct (to avoid wasted investigation)

**Approach:**
1. Read `CLAUDE.md` for full project conventions
2. Scan all API routes first (highest risk surface)
3. Check schema definitions against migration history
4. Review AI pipeline (completion → provider routing → structured output)
5. Audit frontend state management and data fetching
6. Check trigger.dev tasks for error handling gaps
7. Look for duplicate patterns that should be refactored
8. Verify all security conventions are followed

Be exhaustive. Flag everything. No finding too small. Prefer false positives over missed bugs.
