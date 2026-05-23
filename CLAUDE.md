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
pnpm db:migrate       # Apply SQL migrations in supabase/migrations/
pnpm db:push          # Push Drizzle schema directly to DB
pnpm db:studio        # Drizzle Studio (DB browser)
pnpm db:seed          # Seed initial book template + chapters

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
- **prompts**: Template-level prompts. Each has `isAssembly` boolean (true = assembly prompt, false = content prompt), `content` with `{tema}` placeholder, `styleRules`, `knowledgeAreas`, `suggestedLength`. Stored in DB — not code. Admin edits via `/admin/books/`.
- **projectPrompts**: Project-scoped copies of template prompts. Created when a template is applied to a project.
- **projects**: A user's book instance — has `topic` (replaces `{tema}` placeholder) and links to a `book_template`.
- **chapterGenerations**: Per-chapter generation execution. Status: pending → generating → assembling → completed/failed. Created per-chapter, not per-book.
- **fragments**: Individual AI responses for each prompt in a chapter generation.
- **chapterPlaceholders**: Dynamic `{name}` tokens extracted from prompts, with optional AI-filled definitions. Unique per (chapterId, name).

### Book Generation Pipeline

Per-chapter generation triggered via `trigger/generate-chapter.ts` (Trigger.dev task):

1. API route creates a `chapterGeneration` row with status `pending`, triggers `generateChapter` task
2. Task transitions pending → generating, then generates content fragments for non-assembly prompts sequentially via `generatePromptContent()`
3. After all content fragments: transitions generating → assembling, runs the assembly prompt with all fragments via `generateChapterAssembly()`
4. Marks generation completed; on error, marks failed

No book-level orchestrator — each chapter is triggered individually from the UI or API. The `{tema}` placeholder (and other `{name}` tokens) are resolved from `chapterPlaceholders` definitions, with `project.topic` as fallback when the `tema` definition is NULL.

### AI Layer (`lib/ai/`)

- **`completion.ts`**: Single entry point for all LLM calls (`generateCompletion`). Routes to Anthropic, OpenAI, Google, or DeepSeek based on model ID. Handles structured output (Zod schemas), prompt caching (Anthropic ephemeral cache), and provider-specific quirks (Anthropic JSON schema sanitization, OpenAI strict mode, DeepSeek JSON retry).
- **`providers.ts`**: Model catalog with pricing, provider mapping, and stage-to-model defaults.
- **`clients/`**: SDK instances for each provider.
- **`rag.ts`**: Vector retrieval + Cohere rerank.
- **`embeddings.ts`**: Embedding generation via OpenAI.
- **`web-search.ts`**: Web search via Exa (primary) + Tavily (fallback).

### Auth

Supabase SSR with `@supabase/ssr`. Middleware (`middleware.ts`) protects all routes except auth pages. Has a deduplication mechanism for concurrent `getUser()` calls to prevent refresh-token race conditions. API routes return 401 JSON, page routes redirect to `/login`.

Server components use `createClient()` from `lib/supabase/server.ts`. Client components use `lib/supabase/browser.ts`.

### Rate Limiting (`lib/api/rate-limit.ts`)

Two layers: PostgreSQL advisory lock per project (serializes same-project runs at DB level) + sliding window check (max 1 running run per project per 60s). Uses a dedicated `postgres` client connection pool for advisory lock critical sections.

### UI

- **Admin** (`/admin/books/`): Prompt editor UI. Edit book templates, chapters, and individual prompts with `{tema}` placeholder insertion.
- **Projects** (`/projects/`): User dashboard. Create projects, start generation, view chapter generation progress with polling (3s interval while running).
- **Auth** (`/login`, `/signup`, etc.): Copied from redactor-v2.
- **Components**: shadcn/ui + Radix primitives in `components/ui/`. Custom components in `components/prompts/` and `components/projects/`.

## Key Conventions

- **DB access**: Use `db` from `lib/db/drizzle.ts`. Schema re-exports from `lib/db/schema/`. Queries in `lib/db/queries/`.
- **API routes**: Next.js 15 `params: Promise<{ id: string }>` async pattern. All routes auth-gate with `createClient()` + `getUser()`.
- **No v2 prompt files**: v4 stores prompts in DB. The `lib/prompts/` directory from v2 does NOT exist here. Old imports like `@/lib/prompts/unit-brief-small-book` are dead code.
- **No v2 voice corpus**: v4 defines style via prompt fields (styleRules, knowledgeAreas), not external corpus files.
- **No `after()` fragility**: Pipeline runs fully in Trigger.dev, not in Next.js `after()` callbacks.

## Environment Variables

Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `DEEPSEEK_API_KEY`, `EXA_API_KEY`, `TAVILY_API_KEY`, `COHERE_API_KEY`, `TRIGGER_SECRET_KEY`.

## Removed from v2

- `lib/prompts/` — prompts now in DB
- `lib/voice/` — style now in prompt fields
- `lib/db/schema/voice.ts`, `sources.ts`, `run-logs.ts` — not in v4 schema
- `lib/db/queries/runs.ts`, `projects.ts`, `sources.ts` — replaced by inline queries or `queries/books.ts`
- `lib/config/models.ts` — model config folded into `providers.ts`
- `lib/sources/source-kind.ts` — not used
- Spanish fork (`-es` routes/prompts) — only Spanish, no duplication
