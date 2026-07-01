# Project Audit Prompt

Copy everything below and paste into an LLM with access to the full codebase
(Claude Code, Codex, etc.). The LLM should read key files and produce a ranked
list of findings.

---

## Context

You are auditing a production Next.js application. Below is the project's
CLAUDE.md with architecture, data model, and conventions. Read it fully before
starting the audit.

```markdown
[PASTE FULL CONTENTS OF CLAUDE.md HERE]
```

## Audit Instructions

Audit the entire codebase systematically across 8 dimensions. For each finding,
cite the exact file and line, describe the concrete failure scenario (inputs →
wrong output/crash), and rank severity (critical/high/medium/low).

### Dimension 1 — Race Conditions

The project uses PostgreSQL advisory locks + sliding window checks for rate
limiting. Trigger.dev runs generation tasks asynchronously. Key files:

- `lib/api/rate-limit.ts`
- `trigger/generate-chapter.ts`
- `trigger/generate-template.ts`
- `app/api/projects/[id]/chapters/route.ts`
- `app/api/projects/[id]/chapters/[chapterId]/critique/route.ts`
- `app/api/projects/[id]/chapters/[chapterId]/correct/route.ts`

Check for:

- Concurrent generation runs on the same chapter (advisory lock gaps)
- Trigger.dev task idempotency (duplicate task enqueue)
- Polling race: UI polling while generation completes
- Status transitions without atomic compare-and-swap
- `lastAccessedAt` concurrent writes
- Supabase auth token refresh races (middleware dedup mechanism)

### Dimension 2 — State Machine Correctness

The generation state machine is: `pending → generating → assembling → completed/failed`.
Critique and correction create additional generation rows with `generationMetadata.type`.

Key files:

- `lib/generate.ts`
- `lib/__tests__/generation-status.test.ts`
- `trigger/generate-chapter.ts`
- All API routes that create `chapterGenerations`

Check for:

- Invalid state transitions (e.g., completed → generating)
- Orphaned rows stuck in `generating`/`assembling` without recovery
- Missing error handling that leaves DB state inconsistent
- Fragment status synced with parent generation status
- `book_templates.status` transitions (ready → generating → ready/failed)
- Critique/correction rows created but left incomplete on error

### Dimension 3 — Data Integrity

Key files:

- `lib/db/schema/` (all files)
- `supabase/migrations/`
- `lib/db/queries/`

Check for:

- Missing FK constraints or CASCADE rules
- ON DELETE behavior mismatches (what happens when a project is deleted?)
- JSONB fields without validation (`generationMetadata`, `assemblyMetadata`)
- `chapterPlaceholders` orphaned when prompts change
- `projectPrompts` stale after template update (no sync mechanism?)
- Duplicate critique/correction row risk (no unique constraint on type+chapter?)
- Transaction boundaries: multi-table writes without transaction wrapping

### Dimension 4 — Error Handling & Resilience

Key files:

- `lib/ai/completion.ts`
- `lib/ai/placeholder-fill.ts`
- `lib/generate.ts`
- All Trigger.dev tasks
- All API routes

Check for:

- Swallowed errors in catch blocks (empty catch, `.catch(() => {})`)
- Missing `.catch()` on promises
- AI provider errors not propagated correctly through Trigger.dev
- Placeholder fill errors abort entire batch vs skip-and-continue
- Best-effort cleanup on failure (e.g., marking rows as failed)
- Timeout handling for LLM calls (Anthropic streaming timeout)
- Retry logic gaps or infinite retry risks

### Dimension 5 — Auth & Authorization

Key files:

- `middleware.ts`
- `lib/supabase/server.ts`
- `lib/supabase/browser.ts`
- `lib/api/csrf.ts`

Check for:

- API routes missing auth check
- Project ownership verification gaps (user A accessing user B's project)
- CSRF protection gaps
- Service role key leaked to client
- Supabase RLS policies aligned with application auth checks
- Admin routes (`/admin/`, `/generation/`) accessible by non-admins

### Dimension 6 — UI State & Data Flow

Key files:

- `app/projects/[id]/chapters/[chapterId]/page.tsx`
- `app/projects/page.tsx`
- `components/projects/`
- `components/prompts/`

Check for:

- Stale UI state after mutation (optimistic updates without refetch)
- Polling intervals not cleared on unmount (memory/network leak)
- Multiple simultaneous polling intervals stacking
- Selected version state (assembly/critique/correction) not reset when data changes
- `useEffect` dependency arrays causing infinite loops or stale closures
- Correction diff shown for wrong generation (version mismatch)

### Dimension 7 — Performance & Resource Leaks

Key files:

- `lib/ai/completion.ts` (prompt caching)
- `lib/api/rate-limit.ts` (connection pools)
- `trigger/` (Trigger.dev task concurrency)

Check for:

- DB connection pool exhaustion (dedicated pool for advisory locks)
- Trigger.dev task payload size (full prompt content in task payload?)
- Prompt caching misses (Anthropic cache break points)
- Unbounded JSONB growth in `generationMetadata`/`assemblyMetadata`
- Large `assembledContent` stored multiple times (original + each correction)
- Memory leaks in streaming responses (SSE for placeholder fill)
- Missing `AbortSignal` cleanup on client disconnect

### Dimension 8 — Edge Cases & Input Validation

Key files:

- All API routes (req.body parsing)
- `lib/placeholder-research.ts`
- `lib/ai/placeholder-fill.ts`

Check for:

- Empty/null/undefined inputs not handled
- Chapter with no prompts (empty content generation)
- Project with no topic (placeholder fill fallback)
- Template with 0 chapters
- Very long topic/content exceeding DB column limits
- Unicode/special chars in placeholder names
- `generationMetadata` with unexpected `type` values
- Correction without prior critique (input validation)
- Concurrent critique+correction on same chapter (rate limit adequacy)
- Book template auto-generation failure leaving partial chapters

## Output Format

Return findings as a markdown table ranked by severity:

| #   | Severity | File:Line          | Summary           | Failure Scenario               |
| --- | -------- | ------------------ | ----------------- | ------------------------------ |
| 1   | critical | path/to/file.ts:42 | Short description | Concrete inputs → wrong output |

After the table, group findings by dimension with brief analysis. End with a
summary of the top 3 risks to address first.
