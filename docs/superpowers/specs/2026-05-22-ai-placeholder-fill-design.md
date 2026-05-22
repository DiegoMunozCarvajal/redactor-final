# AI-Powered Placeholder Filling — Design Spec

**Date:** 2026-05-22
**Status:** approved

## Overview

Auto-fill chapter placeholder definitions using an LLM with web search. The user provides a project description and per-chapter briefs; the system researches the topic, then streams placeholder definitions in real time. Each placeholder can also be generated or regenerated individually.

## Motivation

- Placeholders like `{LECTOR_OBJETIVO}`, `{FUENTE_O_PAPER_BASE}`, `{TEMA_DEL_LIBRO}` require research and domain knowledge to fill well
- Manual filling of 10+ placeholders per chapter is tedious
- LLM with web search can produce higher-quality, research-backed definitions

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Two-phase: research → streaming | Better quality (LLM sees all search results first), cleaner UX (no pauses during stream) |
| Per-chapter trigger | Each chapter has independent placeholders and brief |
| Individual regenerate | Max quality — fix one bad definition without re-running all |
| Model selectable by user | User controls cost/quality tradeoff per fill operation |
| LLM decides which to search | Smarter than static rules; adapts to any placeholder names |
| Sources visible + linkable | Transparency; user can verify research quality |
| Brief manual + LLM option | User keeps control; LLM assists when needed |
| Configurable prompts per chapter | Template authors can customize fill logic per book template |

## Architecture

### New Tables

**`chapter_briefs`**
```sql
CREATE TABLE chapter_briefs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id uuid NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  content    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chapter_id)
);
```

**`chapter_config_prompts`**
```sql
CREATE TABLE chapter_config_prompts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id uuid NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  type       text NOT NULL,  -- 'fill_placeholders', 'generate_brief'
  content    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chapter_id, type)
);
```

### New Column on `projects`

```sql
ALTER TABLE projects ADD COLUMN IF NOT EXISTS description text;
```

### Two-Phase Fill Flow

```
User clicks "Fill All"
  │
  ▼
Phase 1: RESEARCH (silent, ~1-3s)
  │
  ├─ Load: chapter brief, project description, prompt contents, placeholder names
  ├─ LLM (cheap model): decides which placeholders need web search
  ├─ Execute searches: Exa/Tavily (web) + Semantic Scholar (papers)
  └─ Collect search results
  │
  ▼
Phase 2: GENERATE (streaming, visible)
  │
  ├─ LLM (user-selected model): generates definitions one by one
  ├─ Each placeholder populated in real time in the UI
  ├─ Sources shown as collapsible accordion below each placeholder
  └─ Links clickable (open in new tab)
```

### API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/projects/[id]/chapters/[chapterId]/placeholders/fill` | POST | Fill all placeholders (triggers two-phase flow) |
| `/api/projects/[id]/chapters/[chapterId]/placeholders/[name]/fill` | POST | Fill/regenerate single placeholder |
| `/api/projects/[id]/chapters/[chapterId]/brief` | GET/PATCH | Get/update chapter brief |
| `/api/projects/[id]/chapters/[chapterId]/brief/generate` | POST | Generate brief with LLM |
| `/api/projects/[id]` | PATCH | Update project description |
| `/api/projects/[id]/description/generate` | POST | Generate project description with LLM |

### Streaming Protocol

Phase 2 uses Server-Sent Events (SSE):

```
event: placeholder
data: {"name":"TEMA_DEL_LIBRO","definition":"Atomic Habits and behavior change","sources":[{"title":"...","url":"...","provider":"exa"}]}

event: placeholder
data: {"name":"LECTOR_OBJETIVO","definition":"Young professionals...","sources":[]}

event: done
data: {}
```

The frontend reads the SSE stream and updates each placeholder card in real time.

### UI: Placeholder Section (Project Chapter Page)

```
┌─ Placeholders ───────────────────────────────────────┐
│                              [Model: DS Pro ▾] [Fill All]│
│                                                        │
│  {TEMA_DEL_LIBRO}      [Atomic Habits and behavior...]  │
│                         ▸ Sources (2)                    │
│                          ↳ Exa: "James Clear..." [link]  │
│                          ↳ Semantic Scholar: [paper link]│
│                                    [🔄 Regenerate]       │
│                                                        │
│  {LECTOR_OBJETIVO}     [Young professionals ages 25-35]  │
│                         ▸ Sources (0)                    │
│                                    [🔄 Regenerate]       │
│                                                        │
│  {TONO_DEL_LIBRO}      ░░░░░░░░░░░ generating...        │
│                                                        │
│  {FUENTE_O_PAPER_BASE} [                             ]  │
│                                    [✨ Generate]         │
└────────────────────────────────────────────────────────┘
```

During streaming: placeholders fill one by one, each showing a brief animation/transition when its definition arrives.

### UI: Brief Section (Project Chapter Page)

```
┌─ Chapter Brief ───────────────────────────────────────┐
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │ A chapter about how small daily habits compound   │  │
│  │ into remarkable results, aimed at professionals   │  │
│  │ who have tried and failed with motivation-based   │  │
│  │ approaches.                                       │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│  [Generate with AI]  [Save]                             │
└────────────────────────────────────────────────────────┘
```

### UI: Project Description (Project Settings)

```
┌─ Project Settings ─────────────────────────────────────┐
│                                                        │
│  Name: [Libro prompts Diego___________________________]│
│                                                        │
│  Description:                                           │
│  ┌──────────────────────────────────────────────────┐  │
│  │ A practical non-fiction book teaching habit       │  │
│  │ formation through systems thinking, aimed at      │  │
│  │ Spanish-speaking young professionals.             │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│  [Generate with AI]  [Save]                             │
└────────────────────────────────────────────────────────┘
```

### Admin: Config Prompts (Template Chapter Editor)

In the template chapter editor, a new section "AI Config" below the Placeholders section:

```
┌─ AI Configuration ────────────────────────────────────┐
│                                                        │
│  Placeholder Fill Prompt:                               │
│  ┌──────────────────────────────────────────────────┐  │
│  │ You are an expert book researcher. Given the      │  │
│  │ chapter brief and placeholder names, research     │  │
│  │ each topic and produce concise definitions.       │  │
│  │ Use web search for factual placeholders.          │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│  Brief Generation Prompt:                               │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Based on the chapter title and content prompts,   │  │
│  │ write a 2-3 sentence brief describing the         │  │
│  │ chapter's scope, target reader, and goal.         │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│  [Save]                                                 │
└────────────────────────────────────────────────────────┘
```

### Generation Logic (`lib/ai/placeholder-fill.ts`)

New module with:

```typescript
// Phase 1: Decide which placeholders need research
async function researchPlaceholders(
  placeholders: string[],
  brief: string,
  projectDescription: string,
  promptContents: string[],
): Promise<Record<string, SearchResult[]>>

// Phase 2: Generate definitions with streaming
async function* fillPlaceholders(
  placeholders: string[],
  brief: string,
  projectDescription: string,
  searchResults: Record<string, SearchResult[]>,
  model: string,
  systemPrompt: string,
): AsyncGenerator<PlaceholderFillEvent>

// Single placeholder fill
async function fillSinglePlaceholder(
  name: string,
  brief: string,
  projectDescription: string,
  existingDefinitions: Record<string, string>,
  model: string,
  systemPrompt: string,
): Promise<{ definition: string; sources: SearchResult[] }>
```

### Default System Prompts

When no `chapter_config_prompts` row exists, use defaults:

**fill_placeholders default:**
```
You are an expert book researcher and ghostwriter. Given the chapter brief, project description, and existing prompt contents, define each placeholder with a concise, research-backed value. Use web search for factual placeholders (papers, studies, historical facts). Produce definitions that are specific, actionable, and aligned with the book's tone and audience. Each definition should be 1-3 sentences max.
```

**generate_brief default:**
```
Based on the chapter title, the content prompts, and the project description, write a 2-3 sentence brief describing the chapter's scope, target reader, and desired outcome. Be specific and concise.
```

### Components Changed

| File | Change |
|------|--------|
| `lib/db/schema/chapter-briefs.ts` | New |
| `lib/db/schema/chapter-config-prompts.ts` | New |
| `lib/db/schema/projects.ts` | Add `description` column |
| `lib/db/schema/index.ts` | Export new schemas |
| `lib/ai/placeholder-fill.ts` | New — two-phase fill logic |
| `app/api/projects/[id]/chapters/[chapterId]/placeholders/fill/route.ts` | New — SSE streaming |
| `app/api/projects/[id]/chapters/[chapterId]/placeholders/[name]/fill/route.ts` | New — single fill |
| `app/api/projects/[id]/chapters/[chapterId]/brief/route.ts` | New — CRUD |
| `app/api/projects/[id]/chapters/[chapterId]/brief/generate/route.ts` | New — LLM brief gen |
| `app/api/projects/[id]/description/route.ts` | New — PATCH project description |
| `app/api/projects/[id]/description/generate/route.ts` | New — LLM desc gen |
| `app/api/chapters/[id]/config-prompts/route.ts` | New — GET/PUT config prompts |
| `app/projects/[id]/chapters/[chapterId]/page.tsx` | Add model selector, Fill All button, streaming UI, per-placeholder regenerate, sources accordion, brief section |
| `app/projects/[id]/page.tsx` | Add description field + generate |
| `app/templates/[id]/chapters/[chapterId]/page.tsx` | Add AI Configuration section |
| `supabase/migrations/` | New migration |

### Migration

```sql
-- Add project description
ALTER TABLE projects ADD COLUMN IF NOT EXISTS description text;

-- Create chapter_briefs
CREATE TABLE IF NOT EXISTS chapter_briefs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id uuid NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  content    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chapter_id)
);

-- Create chapter_config_prompts
CREATE TABLE IF NOT EXISTS chapter_config_prompts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id uuid NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  type       text NOT NULL,
  content    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chapter_id, type)
);
```
