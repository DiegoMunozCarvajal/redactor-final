# Redactor Audit Report — 2026-07-01

**Scope:** 11 dimensions, ~80 source files, 6 parallel audit agents.
**Method:** Read-only analysis of every API route, AI pipeline component, DB schema, trigger task, frontend page/component, and test file.

---

## Executive Summary

**1 CRITICAL · 17 HIGH · 28 MEDIUM · 15 LOW · 0 FALSE POSITIVE (already filtered)**

### Top 5 Must-Fix

| #   | Priority | Finding                                                                                   | Impact                                                                                 |
| --- | -------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | CRITICAL | Anthropic cache token cost double-counted in `getCompletionCostUsd`                       | Overcharges 2-3x for all cached Anthropic calls. Affects all cost tracking.            |
| 2   | HIGH     | Stale cleanup after rate check in generate-title + prompt generate routes                 | Permanent deadlock — crashed generation blocks all future generations for that project |
| 3   | HIGH     | Google provider has no content-filter or truncation handling                              | Safety-filtered responses produce opaque `JSON.parse("")` failures                     |
| 4   | HIGH     | Zero test coverage on `completion.ts`, `placeholder-fill.ts`, `generate.ts` (~2300 lines) | Central AI pipeline has no regression protection                                       |
| 5   | HIGH     | Polling clobbers in-progress edits on chapter page                                        | Editing topic/prompts while 3s polling runs overwrites user input                      |

---

## Full Findings

### CRITICAL

#### [CRITICAL] [8-AI/LLM] Anthropic cache token cost double-counted

**File:** `lib/ai/completion.ts:168-171`
**Issue:** `getCompletionCostUsd` charges `input_tokens * base_price` (includes cache tokens at full rate) then adds `cache_creation * 1.25` and `cache_read * 0.1` on top. Anthropic's `input_tokens` already includes cache tokens in the total.
**Impact:** Overcharges cost tracking by 2-3x on every cached Anthropic call. All fragment cost metadata is inflated for cache-eligible requests.
**Fix:**

```ts
const regularInput =
  usage.promptTokens - usage.cacheCreationTokens - usage.cacheReadTokens;
const inputCost = Math.max(0, regularInput) * pricing.input;
const cacheCreationCost = usage.cacheCreationTokens * pricing.input * 1.25;
const cacheReadCost = usage.cacheReadTokens * pricing.input * 0.1;
return inputCost + outputCost + cacheCreationCost + cacheReadCost;
```

---

### HIGH

#### [HIGH] [2-Rate Limiting] Stale cleanup after rate check — permanent deadlock for title generation

**File:** `app/api/projects/[id]/generate-title/route.ts:61-73`
**Issue:** `checkProjectRateLimit` at line 62 runs BEFORE `cleanupStaleGenerations` at line 71. If a previous title generation crashed, the stale row counts against the limit, returns 429, and cleanup never runs. All other generation routes (assemble, critique, correct, fill) correctly run cleanup first.
**Impact:** A single crashed title generation permanently blocks all title generation for that project. No API recovery path — requires manual DB fix.
**Fix:** Move `cleanupStaleGenerations` call to before `checkProjectRateLimit`.

#### [HIGH] [2-Rate Limiting] Stale cleanup after rate check — permanent deadlock for prompt generation

**File:** `app/api/projects/[id]/prompts/[promptId]/generate/route.ts:73-104`
**Issue:** Same inverted order as title route. Rate check at line 74 precedes stale cleanup logic at lines 82-102.
**Impact:** Crashed prompt generation permanently blocks all prompt generation for that project.
**Fix:** Move stale cleanup before rate check. The inline SQL at lines 83-97 has an additional `promptId` filter not supported by `cleanupStaleGenerations` — keep inline but reorder.

#### [HIGH] [8-AI/LLM] Google provider has no content-filter or truncation handling

**File:** `lib/ai/completion.ts:492-581`
**Issue:** `completeWithGoogle` never checks `response.candidates[0]?.finishReason`. Safety-filtered responses return empty text, causing `JSON.parse("")` to throw with misldeading "invalid structured JSON" error. Token-limit truncation also goes undetected.
**Impact:** Google model responses blocked by safety filters produce opaque errors. Users cannot distinguish safety blocks from actual parse failures.
**Fix:** Check `finishReason` after each Google call. If `SAFETY`, throw descriptive error. If `MAX_TOKENS`, emit warning. Detect empty text before `JSON.parse`.

#### [HIGH] [8-AI/LLM] DeepSeek structured output uses unsafe type cast

**File:** `lib/ai/completion.ts:657`
**Issue:** `as unknown as Parameters<typeof ...>` cast defeats TypeScript coverage on the DeepSeek structured output path. A runtime type guard then checks `Symbol.asyncIterator in response` — if this guard ever fires, the real cause (wrong API response shape) is hidden.
**Fix:** Remove the cast. Use properly typed response handling.

#### [HIGH] [8-AI/LLM] `generateTemplate` trigger has no idempotency guard

**File:** `trigger/generate-template.ts:55-58`
**Issue:** Resets `status` to `"generating"` on EVERY retry without checking terminal states. Unlike the other 4 trigger tasks, there's no stale recovery or atomic status transition. Retries re-process all chapters even if some already succeeded.
**Impact:** Task retries after partial success re-process already-completed chapters. Wasteful LLM API spend. No data corruption (transaction + delete makes it safe).
**Fix:** Add idempotency guard: if `book_templates.status` is `"ready"` or `"failed"`, return early.

#### [HIGH] [9-Frontend] Polling clobbers in-progress edits on project page

**File:** `app/projects/[id]/page.tsx:132-137`
**Issue:** 3s polling `useEffect` resets `editTopic` from `project.topic` on every response. If user is typing a new topic when poll fires, their edit is overwritten.
**Impact:** User loses typed input during topic editing. Unrecoverable without re-typing.
**Fix:** Guard with `if (!editingTopic)` inside the effect before calling `setEditTopic`.

#### [HIGH] [9-Frontend] Polling creates unnecessary re-renders on chapter page

**File:** `app/projects/[id]/chapters/[chapterId]/page.tsx:563-575`
**Issue:** `promptFormData` effect creates new object reference every poll cycle via `{ ...prev }` spread, causing re-render of all prompt cards every 3s even when no data changed.
**Impact:** Jank during active editing. Performance degradation on pages with many prompts.
**Fix:** Use local editing state. Only sync from props when `!editingPrompts.has(promptId)`.

#### [HIGH] [9-Frontend] `navigator.clipboard.writeText()` without error handling

**File:** `app/projects/[id]/chapters/[chapterId]/page.tsx:1131,1389,1508`
**Issue:** Clipboard writes without `.catch()` throw in insecure contexts (HTTP), mobile browsers, or when permission denied.
**Impact:** Unhandled promise rejection in production. No user feedback that copy failed.
**Fix:** Wrap in try/catch or chain `.catch(() => toast.error("Clipboard access denied"))`.

#### [HIGH] [9-Frontend] Sidebar fetches not cancelled on unmount

**File:** `components/patterns/sidebar.tsx:189-255`
**Issue:** Uses `cancelled` boolean to prevent state updates but HTTP requests themselves complete. Multiple concurrent label-resolution fetches waste bandwidth.
**Impact:** Slower navigation, wasted server resources. Accumulates on rapid sidebar expansion.
**Fix:** Use `AbortController` passed to each `fetch()` call instead of boolean flag.

#### [HIGH] [9-Frontend] Missing AbortController in fetch hooks across 5 pages

**Files:** `app/generation/page.tsx:38`, `app/generation/[id]/page.tsx:35`, `app/meta-prompts/page.tsx:38`, `app/templates/page.tsx:26`, `app/prompt-library/page.tsx:53`
**Issue:** `useEffect` fetches without AbortController. Navigating away mid-fetch calls `setState` on unmounted component.
**Impact:** React warning "Can't perform a React state update on an unmounted component." Potential memory leaks on rapid navigation.
**Fix:** Add `const controller = new AbortController()` in each effect, pass `controller.signal` to fetch, call `controller.abort()` in cleanup.

#### [HIGH] [10-Testing] Zero test coverage on AI pipeline (~2300 lines)

**Files:** `lib/ai/completion.ts` (844 lines), `lib/ai/placeholder-fill.ts` (685 lines), `lib/generate.ts` (767 lines — 2/15 exports tested)
**Issue:** Central LLM dispatch, provider routing, placeholder resolution, generation pipeline, and assembly algorithms have zero regression protection.
**Impact:** Any bug in provider dispatch, schema sanitization, token accounting, or error handling silently corrupts output across the entire platform.
**Fix:** Add tests for each provider handler, `mapEffort`, `getCompletionCostUsd`, `extractJson`, `validateDefinition`, `generatePromptContent`, assembly functions. Use existing (but unused) mocks in `lib/__tests__/helpers/ai-mocks.ts`.

#### [HIGH] [10-Testing] Zero test coverage on rate limiting behavior

**File:** `lib/api/rate-limit.ts` (112 lines)
**Issue:** Existing `rate-limit.test.ts` only tests `projectIdToLockKey` algorithm (reimplemented inline). `withProjectLock`, `checkProjectRateLimit`, `cleanupStaleGenerations` have zero behavioral tests.
**Impact:** CLAUDE.md marks rate limiting as "[hard]" convention. Bugs in lock acquisition, stale cleanup, or rate window calculation would go undetected.
**Fix:** Add tests: lock acquired/released/busy; rate check allowed/denied/retryAfter; stale cleanup marks rows correctly.

#### [HIGH] [10-Testing] RAG and web search pipelines untested

**Files:** `lib/ai/rag.ts` (118 lines), `lib/ai/web-search.ts` (226 lines), `lib/ai/embeddings.ts` (53 lines), `lib/ai/rerank.ts` (78 lines)
**Issue:** pgvector queries, embedding generation, Cohere reranking, Exa/Tavily/Semantic Scholar fallback chains — all untested.
**Impact:** DB query typos in `rag.ts` inline SQL, web search fallback logic bugs, and SS rate-limiter behavior have no detection mechanism.
**Fix:** Mock `db.execute` and `fetch`. Test fallback chains, cache behavior, retry exhaustion.

#### [HIGH] [10-Testing] `requireAdmin()` auth gate untested

**File:** `lib/auth/admin.ts` (25 lines)
**Issue:** No tests for role-check logic. Returns 401 for no-session, 403 for non-admin, authorized for admin.
**Impact:** Bug in admin role check could expose write endpoints or lock out legitimate admins.
**Fix:** Test all three branches of `requireAdmin()`.

#### [HIGH] [10-Testing] `sanitizeError` and `logAudit` untested

**Files:** `lib/sanitize-error.ts` (18 lines), `lib/audit.ts` (35 lines)
**Issue:** Secret redaction regexes, truncation behavior, and audit metrics counting have no tests.
**Impact:** Regex bug could leak `sk-*` keys into logs. Audit log failures increment counter but produce no visible signal — undetectable without tests.
**Fix:** Test each redaction pattern, truncation edge cases, `logAudit` insert + metrics increment + failure swallowing.

---

### MEDIUM

#### [MEDIUM] [1-Security] Missing input validation on 4 routes

**Files:**

- `app/api/meta-prompts/[id]/route.ts:34` — PUT handler accepts body with no type/length validation (POST handler does validate)
- `app/api/books/[id]/chapters/route.ts:44` — POST body `title` not type-checked (`typeof title !== "string"`)
- `app/api/chapters/[id]/prompts/route.ts:32` — POST body `title` not type-validated
- `app/api/projects/[id]/chapters/[chapterId]/placeholders/route.ts:88` — PATCH definitions not length-capped

**Impact:** Malformed requests produce DB errors (500) instead of clean 400 validation errors. Admin-only or project-owner scoped.
**Fix:** Add consistent `typeof` + length checks matching existing validation patterns in sibling POST handlers.

#### [MEDIUM] [1-Security] CSRF origin fallback may block proxied requests

**File:** `lib/api/csrf.ts:43-48`
**Issue:** When `NEXT_PUBLIC_SITE_URL` is unset, `hostname === host` comparison fails if Host header includes port (`example.com:443`). Deploy-time warning is easily missed.
**Impact:** Silent 403 rejection of legitimate mutation requests in production if env var misconfigured.
**Fix:** Normalize host by stripping port: `host.split(":")[0]`.

#### [MEDIUM] [1-Security] Model/effort params not validated against known values

**File:** `app/api/projects/[id]/chapters/[chapterId]/generate/route.ts:48-56`
**Issue:** `model` and `effort` cast with `as` but not validated at runtime. Garbage model IDs fail at LLM call level after consuming rate-limit slot.
**Impact:** Generation stays in "pending" until 30min stale timeout, blocking all other generation for that project.
**Fix:** Validate against known model IDs from `providers.ts`. Validate effort against `["off", "max", "xhigh"]`. Return 400.

#### [MEDIUM] [1-Security] Inline corrector prompt not persisted for audit

**File:** `app/api/projects/[id]/chapters/[chapterId]/correct/route.ts:208`
**Issue:** When inline `correctorPrompt` object used instead of `correctorPromptId`, `generationMetadata.promptId` is `"inline"`. Actual prompt content only in Trigger.dev payload, never stored.
**Impact:** Cannot audit which correction instructions were sent to LLM. Audit trail gap.
**Fix:** Store inline prompt content in `generationMetadata.promptContent`.

#### [MEDIUM] [1-Security] Boolean prompt flags not type-validated at API boundary

**Files:** `app/api/projects/[id]/prompts/route.ts:131-139`, `app/api/chapters/[id]/prompts/route.ts:49-59`
**Issue:** `isAssembly ?? false` allows non-boolean values (string `"yes"`, number `5`). Postgres type coercion may accept some, reject others with 500.
**Fix:** Add `typeof isAssembly === "boolean"` validation before insert.

#### [MEDIUM] [1-Security] Missing pagination on list endpoints

**Files:** `projects/route.ts:20-34`, `projects/[id]/prompts/route.ts:43-53`, `projects/[id]/sources/route.ts:44-57`, `books/[id]/chapters/route.ts:22-32`
**Issue:** No `.limit()` on GET queries. Contrast with prompt-library (limit 100) and meta-prompts (limit 100).
**Impact:** Unbounded responses if project accumulates many records. Minor DoS vector.
**Fix:** Add `.limit(100)` on all list endpoints.

#### [MEDIUM] [3-Data Integrity] Fragment insert and generation status update not atomic

**File:** `app/api/projects/[id]/prompts/[promptId]/generate/route.ts:149-178`
**Issue:** Fragment insert (line 149) and generation status update (line 164) are two separate calls with no transaction. If insert succeeds but update fails, fragment is orphaned.
**Impact:** Orphan fragment row. Generation stuck in "generating" until stale cleanup (30min window). Fragment persists indefinitely.
**Fix:** Wrap both in `db.transaction()`.

#### [MEDIUM] [3-Data Integrity] Prompt DELETE cascades destroy all fragments and version history

**File:** `lib/db/schema/fragments.ts:12-14`, `app/api/prompts/[id]/route.ts`
**Issue:** `fragments.projectPromptId` has `ON DELETE CASCADE`. Deleting a prompt destroys all historical fragment content for that prompt across all generations. No confirmation or warning.
**Impact:** Irreversible data loss of all fragment content and version history for the deleted prompt.
**Fix:** Add confirmation query returning affected counts. Consider `ON DELETE SET NULL` for fragments.

#### [MEDIUM] [4-Performance] N+1 queries in POST /projects

**File:** `app/api/projects/route.ts:132-211`
**Issue:** Three sequential `for...of` loops inside transaction: prompt sync per chapter (132-145), `{tema}` backfill per chapter (149-187), assembly prompt sync per chapter (189-211).
**Impact:** O(n) queries per chapter count. Minor for typical 8-12 chapters but grows linearly.
**Fix:** Batch with `inArray` or values-based insert.

#### [MEDIUM] [5-Error Handling] Google non-structured path returns empty content without warning

**File:** `lib/ai/completion.ts:571`
**Issue:** `response.text ?? ""` — no validation of content meaningfulness. Safety-filtered or empty responses returned as empty string.
**Fix:** Check `finishReason`, log warning if content empty.

#### [MEDIUM] [5-Error Handling] Missing placeholders check allows empty definitions

**File:** `trigger/generate-chapter.ts:199-213`
**Issue:** Validation only checks key existence, not value emptiness. `{ tema: "" }` passes validation, causing `{tema}` to be replaced with empty string.
**Fix:** After existence check, verify placeholder values are non-empty. Reject with message: `Placeholder "{name}" has empty definition`.

#### [MEDIUM] [5-Error Handling] `sanitizeError` truncates at 500 chars — too aggressive

**File:** `lib/sanitize-error.ts:17`
**Issue:** Modern error chains with nested causes and Postgres detail exceed 500 chars. Tail of truncated message often contains most specific debug info (constraint name, row data).
**Fix:** Increase to 2000 chars.

#### [MEDIUM] [5-Error Handling] `sanitizeError` doesn't redact SQL/PII patterns

**File:** `lib/sanitize-error.ts:5-18`
**Issue:** Only redacts `sk-*`, `Bearer`, `ghp_*`, `gho_*`. Raw SQL, email addresses, URLs, project IDs pass through unredacted. Errors stored in `chapterGenerations.error` (admin-visible).
**Fix:** Add regex for SQL patterns, email, URLs, project UUIDs.

#### [MEDIUM] [5-Error Handling] `load-env.ts` uses custom parser instead of `dotenv`

**File:** `lib/ai/clients/load-env.ts:10-28`
**Issue:** Custom `.env` parser uses `split("=", 1)` — breaks on values containing `=`. No warning for duplicates (last writer wins). No handling of quoted values.
**Fix:** Use `dotenv` library or handle edge cases in custom parser.

#### [MEDIUM] [5-Error Handling] Trigger tasks have no `maxDuration` configured

**Files:** `trigger/generate-chapter.ts`, `generate-critique.ts`, `generate-correction.ts`, `generate-template.ts`
**Issue:** No `maxDuration` set on any trigger task. Plan-default may cut off long-running tasks (especially `generate-chapter` making multiple sequential LLM calls during assembly).
**Fix:** Add `maxDuration: 600` (10 min) to all trigger tasks.

#### [MEDIUM] [6-Code Quality] Audit logging gaps in project-scoped routes

**Files:** Project chapter CRUD routes, project prompt CRUD routes
**Issue:** Several project-scoped mutation routes do not call `logAudit()`. Admin-only and generation-triggering routes consistently do.
**Impact:** No audit trail for chapter/prompt delete operations by project owners.
**Fix:** Add `logAudit()` calls to missing routes.

#### [MEDIUM] [6-Code Quality] CLAUDE.md documents removed schema fields

**File:** `CLAUDE.md`
**Issue:** Documents `styleRules`, `knowledgeAreas`, `suggestedLength` as prompt fields. These were removed during prompt consolidation.
**Impact:** Misleading documentation for future maintenance.
**Fix:** Remove or strike through these fields in CLAUDE.md.

#### [MEDIUM] [6-Code Quality] Generated column `gen_type` claim inaccurate

**File:** `CLAUDE.md` and `lib/db/schema/chapter-generations.ts`
**Issue:** CLAUDE.md states `gen_type` is a generated column. No such column exists. Type is accessed via `generationMetadata->>'type'` in JSONB.
**Impact:** Developer confusion if they try to query a non-existent column.
**Fix:** Update CLAUDE.md to clarify that `generationMetadata->>'type'` is the canonical access pattern.

#### [MEDIUM] [9-Frontend] 1747-line chapter page component

**File:** `app/projects/[id]/chapters/[chapterId]/page.tsx:162-1909`
**Issue:** Single component handles assembly, critique, correction, prompt list editing, version history, polling, multiple modals, and clipboard operations. Single responsibility principle violated.
**Impact:** Maintainability. Hard to reason about state interactions (e.g., polling + editing clobber). Hard to test.
**Fix:** Extract: prompt card list, assembly section, critique section, modal components.

#### [MEDIUM] [9-Frontend] Polling interval recreated every response cycle

**Files:** `app/projects/[id]/chapters/[chapterId]/page.tsx:577-591`, `app/projects/[id]/page.tsx:82-99`
**Issue:** Effect deps `[assembling, data, fetchChapter]` cause interval cleanup/recreate every 3s because `data` is a new object each poll.
**Impact:** Not a memory leak but unnecessary interval churn.
**Fix:** Extract polling condition to a ref. Only restart interval when condition transitions.

#### [MEDIUM] [9-Frontend] Native `<select>` vs shadcn `<Select>` inconsistency

**Files:** 4 components — prompt picker dialogs, corrector-section, template create
**Issue:** Native `<select>` used in some dialogs while shadcn `<Select>` used for model pickers. Different keyboard behavior, styling, ARIA support, and visual consistency.
**Fix:** Replace native `<select>` with shadcn `<Select>` in all dialogs.

#### [MEDIUM] [9-Frontend] `alert()` used instead of `toast.error()`

**Files:** `app/projects/page.tsx:86`, `app/templates/page.tsx:47`
**Issue:** `alert()` for API errors breaks UX consistency — all other pages use `toast.error()`.
**Fix:** Replace with `toast.error()`.

#### [MEDIUM] [9-Frontend] Flash of wrong density on SSR

**File:** `lib/hooks/use-density.ts:36-40`
**Issue:** `density-compact` class only added client-side after mount. Brief flash on page load for compact-preference users.
**Fix:** Set class from localStorage synchronously in blocking `<script>` in `<head>`.

#### [MEDIUM] [9-Frontend] Unaborted fetch in modal openers

**File:** `app/projects/[id]/chapters/[chapterId]/page.tsx:774-778,785-792`
**Issue:** `openAssemblyModal()` and `openCritiqueModal()` fetch without abort signal. Double-click triggers race condition.
**Fix:** Wrap in `useCallback` with AbortController.

#### [MEDIUM] [10-Testing] Test helpers exist but are unused

**Files:** `lib/__tests__/helpers/ai-mocks.ts`, `api.ts`, `db.ts`, `fixtures.ts`
**Issue:** Reusable mocks for OpenAI, Anthropic, Supabase auth, CSRF, and test DB connections exist but no test imports them.
**Impact:** Dead code. Mock interfaces may have drifted from actual implementations.
**Fix:** Write tests that use these helpers.

#### [MEDIUM] [10-Testing] Edge cases missing in existing tests

**Files:** `assembly-versions.test.ts`, `generation-errors.test.ts`, `generation-status.test.ts`, `placeholders.test.ts`, `promise-pool.test.ts`
**Issue:** Most tests cover happy paths only. Missing: empty arrays, null assembledContent, boundary concurrency values, mixed case placeholders, null definitions.
**Fix:** Add edge case tests for each module.

#### [MEDIUM] [10-Testing] `vitest.setup.ts` empty

**File:** `vitest.setup.ts`
**Issue:** No global mocks, no custom matchers, no env normalization.
**Impact:** Every test manually configures mocks. No guard against accidental external API calls.
**Fix:** Add global `fetch` mock if tests shouldn't make real HTTP calls.

#### [MEDIUM] [11-Operations] No centralized env validation at startup

**Files:** `lib/db/drizzle.ts`, `lib/db/lock-pool.ts`
**Issue:** Only `DATABASE_URL` checked at startup. All 9 API keys (OpenAI, Anthropic, Google, DeepSeek, Cohere, Exa, Tavily, Semantic Scholar, Supabase) validated only at first use — runtime failures delayed until LLM call.
**Fix:** Add startup validation in a shared `lib/env.ts` that enumerates all required vars by deployment environment.

---

### LOW

#### [LOW] [1-Security] Inconsistent HTTP methods: PUT for partial updates

**Files:** `prompts/[id]/route.ts`, `books/[id]/route.ts`, `chapters/[id]/route.ts`
**Issue:** PUT used with partial-update semantics. REST convention: PATCH for partial updates.
**Fix:** Migrate admin UI, rename to PATCH.

#### [LOW] [1-Security] Missing 201 Created on POST create endpoints

**Files:** Multiple POST routes
**Issue:** All POST create routes return 200 instead of 201.
**Fix:** Use `NextResponse.json(entity, { status: 201 })`.

#### [LOW] [1-Security] Inconsistent error response shapes

**Files:** Multiple routes
**Issue:** Some return `{ error: string }`, others return `{ entity }`, `{ ok: true }`, or empty array for missing resources.
**Fix:** Standardize: `{ error }` for errors, resource for success, `{ data, meta }` for computed fields.

#### [LOW] [2-Rate Limiting] generate route uses inline stale cleanup instead of shared utility

**File:** `app/api/projects/[id]/chapters/[chapterId]/generate/route.ts:71-83`
**Issue:** Inline SQL for stale cleanup where utility function could work with a `typeIsNull` parameter.
**Fix:** Add optional `typeIsNull` param to `cleanupStaleGenerations` or document the inline pattern.

#### [LOW] [3-Data Integrity] Project topic clear blocks generation silently

**File:** `app/api/projects/[id]/route.ts:162`
**Issue:** Clearing topic sets `{tema}` placeholder definitions to null, blocking all generation. No warning to user.
**Fix:** Add validation or user-facing warning.

#### [LOW] [3-Data Integrity] `projectPromptId` column name misleading

**File:** `lib/db/schema/fragments.ts:12-14`
**Issue:** Named `projectPromptId` but references `prompts.id` (both template and project prompts).
**Fix:** Rename to `promptId`.

#### [LOW] [5-Error Handling] `STALE_TIMEOUT_MS` import coupling

**File:** `trigger/generate-chapter.ts:14`
**Issue:** Imports from `@/lib/api/rate-limit` — business-logic constant in API route module. Refactoring rate-limit breaks trigger tasks.
**Fix:** Move to `lib/constants.ts`.

#### [LOW] [5-Error Handling] `rerank.ts` rethrows network errors for graceful degradation

**File:** `lib/ai/rerank.ts:68-74`
**Issue:** Correctly degrades on Cohere failure. Error message not sanitized before logging.
**Fix:** Sanitize error message in the catch block.

#### [LOW] [6-Code Quality] Dead code: dynamic Tailwind class in sidebar

**File:** `components/patterns/sidebar.tsx:440`
**Issue:** `cn()` with dynamic class `pl-${...}` — Tailwind purge strips these.
**Fix:** Remove from `cn()`. Inline style fallback works fine.

#### [LOW] [9-Frontend] FileReader no size validation on template source upload

**File:** `app/templates/create/page.tsx:54-78`
**Issue:** `FileReader` loads entire file. Files >50MB choke browser.
**Fix:** Add 10MB max check before reading.

#### [LOW] [9-Frontend] Reorder failure doesn't handle revert-fetch error

**File:** `app/templates/[id]/page.tsx:121-125`
**Issue:** Reorder API failure calls `fetchTemplate()` to revert but doesn't catch that error.
**Fix:** Add `.catch(() => toast.error("Failed to revert"))`.

#### [LOW] [9-Frontend] Arbitrary `text-[9px]`, `text-[10px]`, `text-[11px]` values

**Files:** Multiple
**Issue:** Inconsistent with Tailwind design tokens.
**Fix:** Define micro size in Tailwind config.

#### [LOW] [10-Testing] `rate-limit.test.ts` reimplements algorithm inline

**File:** `lib/__tests__/rate-limit.test.ts`
**Issue:** `projectIdToLockKey` algorithm reimplemented rather than imported. Changes to real function won't break tests.
**Fix:** Export and import the real function.

#### [LOW] [6-Code Quality] Schema documentation drift in migrations

**Files:** Migration snapshots
**Issue:** `audit_logs.metadata` migrated from `text` to `jsonb` but `logAudit()` still calls `JSON.stringify()` before insert. Works but suboptimal.
**Fix:** Pass object directly, let driver serialize.

---

## Fix Roadmap

### Quick Wins (≤1 hour each)

1. Reorder stale cleanup before rate check in generate-title + prompt generate routes
2. Guard polling effects with editing-state refs (project + chapter pages)
3. Add `.catch()` to clipboard writes
4. Replace `alert()` with `toast.error()` in 2 pages
5. Add AbortController to fetch hooks in 5 pages
6. Add input validation to 4 routes lacking it
7. Update CLAUDE.md to remove `styleRules`/`knowledgeAreas`/`suggestedLength`
8. Add 201 Created to POST create routes
9. Fix CSRF hostname fallback (strip port)
10. Normalize hostname comparison in csrf.ts

### Medium-Term (2-4 hours each)

1. Fix Anthropic cache token cost calculation in `getCompletionCostUsd`
2. Add Google content-filter and truncation handling
3. Add `generateTemplate` idempotency guard
4. Add `maxDuration` to all trigger tasks
5. Wrap fragment insert + status update in transaction
6. Store inline corrector prompt content in generation metadata
7. Validate model/effort params against known values
8. Extract chapter page into smaller components
9. Replace native `<select>` with shadcn `<Select>` in 4 dialogs
10. Add pagination to unbounded list endpoints
11. Add centralized env validation at startup

### Architectural (1-2 days each)

1. Write tests for `completion.ts`, `placeholder-fill.ts`, `generate.ts` (AI pipeline test suite)
2. Write tests for `rate-limit.ts` behavioral tests (lock, rate check, stale cleanup)
3. Write tests for `rag.ts`, `web-search.ts`, `rerank.ts`
4. Write integration tests for critical API routes
5. Add prompt DELETE confirmation with affected-count query
6. Fix DeepSeek unsafe type cast in completion.ts
7. Standardize error response shapes across all API routes
8. Migrate PUT partial-update routes to PATCH

---

## Verified Secure (No Issues Found)

- **CSRF**: 100% coverage. All 38 mutation routes check `csrfCheck(req)` as first line.
- **Auth gates**: Correct pattern on every route. Admin-only routes use `requireAdmin()`, user routes verify `project.userId === user.id`.
- **IDOR**: Every project-scoped route verifies ownership. Returns 404 (not 403) to prevent resource enumeration.
- **Secrets**: Zero hardcoded credentials. All 9 API keys loaded from `process.env`. `sanitizeError()` redacts secret patterns before logging.
- **SQL injection**: All queries use Drizzle ORM parameterization. Raw SQL (`sql\`\``, `reserved.unsafe()`) uses `$N` parameterization exclusively.
- **FK cascade chain**: Correct. Project deletion cascades through chapters → prompts → versions, chapterGenerations → fragments, sources → chunks.
- **Multi-table transactions**: All create/update operations use `db.transaction()`. Advisory lock + rate check atomic inside `withProjectLock()`.
- **Placeholder sync**: Deduplicates `{tema}`/`{TEMA}`/`{Tema}` case variants correctly. Hash includes both `content` and `userPrompt`.
- **Prompt role exclusivity**: `chk_prompts_role_exclusive` CHECK constraint at DB level. Content generation filters `!isAssembly && !isCritique && !isCorrector`.
- **Trigger idempotency**: All 4 chapter-generation triggers have terminal-state guards, stale recovery, atomic status transitions, and retry policies.
- **Structured output**: Zod schemas used throughout. Provider quirks handled (Anthropic sanitization, OpenAI strict mode, DeepSeek JSON retry).
- **Abort signals**: Combined client-disconnect + 15min STAGE_TIMEOUT on all LLM calls.
