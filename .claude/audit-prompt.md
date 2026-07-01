# Project Audit — Bugs, Optimization, State Issues

You audit a Next.js 15 + Supabase + Trigger.dev + Drizzle ORM app. Spanish small-book generation platform. Read `CLAUDE.md` for full architecture.

## Audit Targets (check each)

### 1. Bug Hunting

- **Null/undefined access**: every `?.`, `!`, unchecked DB query result, `find()`/`get()` without guard.
- **Race conditions**: concurrent DB writes, Trigger.dev task idempotency, `getUser()` dedup (see auth section in CLAUDE.md), advisory lock correctness in `lib/api/rate-limit.ts`.
- **Error swallowing**: empty `.catch()`, `try {} catch {}` without logging/re-throw, missing `.finally()` cleanup.
- **Async gaps**: `await` missing on promise, async function called without await in loops/maps.
- **SQL injection**: any raw SQL, `db.execute()`, template literals in queries. Check Drizzle usage — `sql` tagged templates OK, plain string interpolation NOT OK.
- **Auth bypass**: unprotected API routes, middleware gaps, server vs client component auth — server components must use `createClient()` from `lib/supabase/server.ts`, not browser client.
- **Placeholder mismatch**: `{tema}` and other `{name}` tokens — check extraction, fill, replacement. Ensure no leftover unreplaced placeholders reach LLM.
- **Edge cases**: empty strings, 0, `false` treated incorrectly in conditionals, array bounds, DB constraint violations (CHECK on chapters table).

### 2. State & Data Flow Problems

- **Stale data**: React state not updating after mutation, missing cache invalidation after DB write.
- **Derived state divergence**: same data in multiple states drifting out of sync.
- **Missing loading/error/empty states**: every async data fetch in UI must handle all 3.
- **DB query consistency**: same query returning different shapes, missing `.select()` columns, joins returning unexpected nulls.
- **Transaction correctness**: multi-table writes without transaction wrapping where needed.
- **Trigger.dev task state**: task transitions — pending→generating→assembling→completed — check no invalid jumps, no stuck states, error path sets `failed`.

### 3. Performance Issues

- **N+1 queries**: loops making DB calls, missing `.leftJoin()` / `.innerJoin()` where eager loading would help.
- **Missing indexes**: frequent `WHERE`/`ORDER BY` columns without DB index.
- **Large payloads**: no pagination on list endpoints, all rows fetched.
- **Unnecessary re-renders**: `useEffect` with missing deps or deps that change identity every render.
- **Bundle bloat**: heavy imports without tree-shaking, non-lazy routes.
- **Memory leaks**: intervals/event listeners not cleaned up, large arrays held in closures.
- **LLM call efficiency**: prompt caching used? (see `lib/ai/completion.ts` Anthropic ephemeral cache). Parallel calls where possible?

### 4. Security Issues

- **Secret exposure**: `NEXT_PUBLIC_*` env vars used server-side, or secret env vars leaked to client.
- **Input validation gaps**: API routes without Zod/validation on body/params.
- **Rate limiting gaps**: routes that should be rate-limited but aren't.
- **CSRF**: mutation endpoints without proper protection.
- **IDOR**: user A can access user B's project/chapter data — check every resource query filters by `user_id`.

### 5. Error Handling & Resilience

- **Missing error boundaries**: React error boundaries on non-trivial components.
- **API error responses**: 500s without detail, 200 with error body (should be proper status code).
- **DB connection errors**: graceful handling, retries.
- **Trigger.dev retry strategy**: tasks configured with reasonable retry, idempotency guaranteed.
- **LLM failures**: timeout handling, provider fallback, rate limit backoff.
- **AbortSignal propagation**: `AbortSignal` passed through to LLM calls (see CLAUDE.md recent commits).

### 6. Code Quality Smells

- **Dead code**: unused exports, unreachable branches, leftover v2/v3 migration code.
- **TypeScript escapes**: `as any`, `@ts-ignore`, `@ts-expect-error` without justification.
- **Magic values**: hardcoded strings/numbers that should be constants/DB config.
- **DRY violations**: prompt handling, auth gating, error formatting duplicated across routes.
- **TODOs/FIXMEs without tracking**: should link to issue or describe condition.

## Output Format

For each finding, output:

```json
{
  "severity": "critical|high|medium|low",
  "category": "bug|state|performance|security|error-handling|quality",
  "file": "path/to/file:line",
  "title": "one-line summary",
  "description": "what's wrong",
  "impact": "what breaks if left unfixed",
  "fix": "concrete fix suggestion"
}
```

## Approach

1. Read `CLAUDE.md` first — architecture overview.
2. Focus on `lib/ai/`, `lib/db/`, `app/api/`, `trigger/`, `components/` — these are core.
3. Trace one pipeline end-to-end (template→generation→assembly→critique→correction) looking for gaps at each handoff.
4. Check recent commits for patterns of past bugs — same class may lurk elsewhere.
5. Report findings sorted by severity. Don't repeat same issue across files — generalize pattern once with affected files listed.
