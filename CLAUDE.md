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
- **prompts**: Template-level prompts. Each has `isAssembly` boolean (true = assembly prompt, false = content prompt), `content` with `{tema}` placeholder, `styleRules`, `knowledgeAreas`, `suggestedLength`, `sourceContext` (original source material for domain context — never copied verbatim), `function` (semantic label for placeholder routing), `notes` (guidance for placeholder fill LLM). Stored in DB — not code. Admin edits via `/admin/books/`.
- **projectPrompts**: Project-scoped copies of template prompts. Created when a template is applied to a project.
- **projects**: A user's book instance — has `topic` (replaces `{tema}` placeholder), `lastAccessedAt` (updated on GET, drives dashboard ordering), optional `generationSystemPromptId` FK, and links to a `book_template`.
- **book_templates**: Has `status` field: `"ready"` (available), `"generating"` (AI is creating template structure), `"failed"` (auto-generation failed). Templates with non-ready status are disabled in the create-project dialog.
- **chapterGenerations**: Per-chapter generation execution. Status: pending → generating → assembling → completed/failed. Created per-chapter, not per-book. Distinguished by `generationMetadata.type`: `null` (original assembly), `"critique"` (AI critique output), `"correction"` (corrected chapter text).
- **fragments**: Individual AI responses for each prompt in a chapter generation.
- **chapterPlaceholders**: Dynamic `{name}` tokens extracted from prompts, with optional AI-filled definitions. Unique per (chapterId, name).
- **critiquePrompts**: Template-level critique prompts. Stored in DB, admin-editable. Define what aspects to analyze in assembled chapters.
- **correctorPrompts**: Template-level corrector prompts. Define how to apply critique feedback to generate corrected versions.
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

Two layers: PostgreSQL advisory lock per project (serializes same-project runs at DB level) + sliding window check (max 1 running run per project per 60s). Uses a dedicated `postgres` client connection pool for advisory lock critical sections.

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
