# Audit Prompt — Redactor v4

You are auditing a production web application for bugs, security vulnerabilities, race conditions, data integrity issues, and unwanted behaviors. Be thorough. Flag everything, including low-severity findings.

## Project Summary

**Redactor** is a platform for generating small non-fiction books in Spanish. Users create projects with a topic → select a book template → AI generates chapters via chapter-specific prompts stored in DB → chapters are assembled into a complete book.

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **DB**: PostgreSQL via Drizzle ORM (`lib/db/drizzle.ts`, schema in `lib/db/schema/`)
- **Auth**: Supabase SSR (`@supabase/ssr`), middleware protects all routes except auth pages
- **Background jobs**: Trigger.dev (`trigger/`)
- **AI**: Multi-provider LLM (`lib/ai/completion.ts`) — Anthropic, OpenAI, Google, DeepSeek
- **RAG**: Vector retrieval + Cohere rerank (`lib/ai/rag.ts`)
- **Rate limiting**: PostgreSQL advisory locks + sliding window (`lib/api/rate-limit.ts`)
- **UI**: shadcn/ui + Radix primitives, Tailwind CSS

## Architecture

### Core Data Flow

```
book_templates ──< chapters ──< prompts (8 content + 1 assembly per chapter)
projects ──< chapter_generations ──< fragments
```

### Book Generation Pipeline (per-chapter)

1. API route creates `chapterGeneration` row (status: `pending`)
2. Triggers `trigger/generate-chapter.ts` (Trigger.dev task)
3. Task: pending → generating → generates content fragments for non-assembly prompts via `generatePromptContent()`
4. Task: generating → assembling → runs assembly prompt with all fragments via `generateChapterAssembly()`
5. Marks completed; on error, marks failed

### Critique & Correction Pipeline

1. **Critique**: AI reviews assembled chapter, output stored as `chapterGeneration` with `type: "critique"`
2. **Correction**: AI applies critique feedback, output as `chapterGeneration` with `type: "correction"`
3. Corrections chain — each correction builds on previous one

### Key Directories

```
app/                          # Next.js App Router
  api/                        # API routes (REST)
    assembly-prompts/         # Global assembly prompt CRUD
    critique-prompts/         # Global critique prompt CRUD
    corrector-prompts/        # Global corrector prompt CRUD
    meta-prompts/             # Global meta prompt CRUD
    generation-prompts/       # Generation system prompts CRUD
    prompt-versions/          # Prompt version restore
    projects/                 # Project CRUD + chapter/source/prompt management
  projects/[id]/              # Dashboard page
  admin/books/                # Admin prompt editor
lib/
  ai/                         # LLM layer (completion, providers, RAG, embeddings, placeholder-fill)
  db/                         # Drizzle ORM, schema, queries
  api/                        # CSRF, rate limiting
  auth/                       # requireAdmin helper
  storage/                    # Supabase Storage helpers
  generate.ts                 # Content + assembly generation
  placeholders.ts             # Placeholder resolution
trigger/                      # Trigger.dev background tasks
  generate-chapter.ts         # Chapter generation orchestrator
  generate-template.ts        # AI-powered template structure generation
dspy_optimizer/               # Python calibration scripts (separate from app)
```

## Audit Scope

### 1. Security

- **Auth gates**: Every API route must authenticate. Admin-only routes must use `requireAdmin()`. Project-scoped routes must verify `project.userId === user.id`.
- **CSRF**: All mutating routes (POST, PUT, PATCH, DELETE) must call `csrfCheck(req)` before auth.
- **Secrets**: No hardcoded API keys, tokens, or credentials anywhere.
- **IDOR**: Resource access must verify ownership — no loading resources by ID without checking they belong to the authenticated user.
- **Injection**: SQL via Drizzle parameterization (check for raw SQL), prompt injection in AI calls.
- **Rate limiting**: Generation/critique/correction endpoints must have rate limiting.

### 2. Data Integrity

- **Transactions**: Multi-table inserts must be atomic (`db.transaction`).
- **Foreign keys**: Verify FK constraints exist where expected.
- **Field preservation**: When copying/duplicating records, all fields must be preserved.
- **Unique constraints**: Check for missing unique constraints that could allow duplicates.
- **Stale state**: Check for state machine transitions that leave rows stuck in intermediate states.

### 3. Race Conditions

- **TOCTOU**: Check → insert patterns must be atomic (advisory lock or unique constraint).
- **Concurrent mutations**: Multiple requests mutating the same resource must not corrupt state.
- **Polling races**: UI polling must not miss valid states.

### 4. Error Handling

- **LLM failures**: AI call failures must update generation status to `failed` with sanitized error message.
- **Transaction rollback**: Failed transactions must not leave partial data.
- **Edge cases**: Empty inputs, null values, missing placeholders, empty chapters, 0-length content.

### 5. State Machines

- **Generation status**: pending → generating → assembling → completed | failed. Verify all transitions.
- **Template status**: ready | generating | failed. Verify transitions and UI gating.
- **Stale recovery**: Long-running generations must be recoverable (stale timeout cleanup).

### 6. AI Pipeline

- **Prompt completeness**: All prompt fields (`content`, `userPrompt`, `isAssembly`, `isCritique`, `isCorrector`, `function`, `notes`, `sourceContext`) must flow through the pipeline correctly.
- **Placeholder resolution**: All `{name}` placeholders must be resolved before LLM call. Missing placeholders should error early.
- **Model routing**: Provider selection must handle missing API keys gracefully.
- **Context limits**: Check for unbounded token accumulation (RAG chunks, concatenated content).

### 7. API Design

- **Error responses**: Consistent JSON error format with appropriate HTTP status codes.
- **Input validation**: Required fields validated, length limits enforced.
- **Idempotency**: Retried operations must not create duplicates.

### 8. UI/UX

- **Loading states**: All async operations must show loading indicators.
- **Error states**: API errors must surface to the user, not silently fail.
- **Empty states**: Lists with 0 items must show appropriate empty state.
- **Polling**: Must stop on terminal states, start on active states.

## Instructions

1. **Read the codebase.** Start with `CLAUDE.md` for architecture overview. Then trace each user-facing flow end-to-end.
2. **For each finding**, provide:
   - **Severity**: critical | high | medium | low
   - **Category**: security | bug | data | race | state | perf | ux
   - **File + line**: exact location
   - **Title**: one-line summary
   - **Description**: what's wrong
   - **Impact**: concrete harm
   - **Fix**: specific code change or approach
3. **Prioritize**: critical findings first. Critical = data loss, security breach, API key leak, unrecoverable state corruption.
4. **Be specific.** Every finding must reference exact code, not general patterns.
5. **Verify before reporting.** If unsure whether something is actually a bug, note the uncertainty.

## What NOT to Flag

- TypeScript strictness preferences
- Code style, naming conventions, formatting
- Missing tests (unless testing a specific untested edge case that has caused bugs)
- Performance micro-optimizations without concrete impact
- "Consider using X library instead of Y" without a bug reason
- Missing documentation
