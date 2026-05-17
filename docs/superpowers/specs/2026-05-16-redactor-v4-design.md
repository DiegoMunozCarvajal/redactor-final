# redactor-v4 Design Doc

## Overview

Plataforma para generar libros de no-ficción pequeños en español. Evolución de redactor-v2 con pipeline de prompts específicos por capítulo (no prompts genéricos reutilizados).

## Key differences from v2

| v2 | v4 |
|----|----|
| Mismos prompts para todos los capítulos | Prompts específicos por capítulo |
| Prompts en código (TypeScript) | Prompts en DB con editor admin UI |
| Inglés + fork español | Solo español |
| Corpus de voz por nicho | Estilo definido en los prompts |
| Pipeline con `after()` de Next.js | Pipeline completo en Trigger.dev |
| 4 etapas genéricas | 8 prompts de contenido + 1 ensamblaje por capítulo |

## Architecture

### Stack
- Next.js 15.5 (App Router), React 19, Tailwind CSS v4, shadcn/ui
- Supabase (Postgres + pgvector), Drizzle ORM
- Supabase Auth (SSR)
- Trigger.dev v4 (pipeline completo)
- Anthropic, OpenAI, Google, DeepSeek (via completion router)
- Exa (primario) + Tavily (fallback) para web search
- Cohere rerank para RAG
- Vitest

### Modules copied from v2 (no changes)
`lib/ai/clients/`, `lib/ai/completion.ts`, `lib/ai/providers.ts`, `lib/ai/rag.ts`, `lib/ai/embeddings.ts`, `lib/ai/web-search.ts`, `lib/db/drizzle.ts`, `lib/auth/`, `lib/storage/`, `lib/extraction/`, `lib/chunking/`, `lib/export/`, `lib/api/`, `lib/constants.ts`, `middleware.ts`, `components/ui/`, `trigger/extract-source.ts`

### Data Model

```sql
book_templates (
  id uuid PK,
  name text NOT NULL,
  description text,
  created_at timestamptz DEFAULT now()
)

chapters (
  id uuid PK,
  book_template_id uuid FK -> book_templates,
  position integer NOT NULL,
  title text NOT NULL,
  created_at timestamptz DEFAULT now()
)

prompts (
  id uuid PK,
  chapter_id uuid FK -> chapters,
  position integer NOT NULL,
  type text NOT NULL,  -- 'apertura','modelo','contraste','amplificacion','anecdota','acumulacion','proceso','cierre','ensamblaje'
  title text NOT NULL,
  content text NOT NULL,  -- contiene placeholder [TEMA]
  style_rules text,
  knowledge_areas text,
  suggested_length text,
  created_at timestamptz DEFAULT now()
)

projects (
  id uuid PK,
  user_id uuid FK -> auth.users,
  name text NOT NULL,
  topic text NOT NULL,  -- valor que reemplaza [TEMA]
  book_template_id uuid FK -> book_templates,
  created_at timestamptz DEFAULT now()
)

runs (
  id uuid PK,
  project_id uuid FK -> projects,
  status run_stage NOT NULL DEFAULT 'pending',
  language text DEFAULT 'es',
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
)

chapter_runs (
  id uuid PK,
  run_id uuid FK -> runs,
  chapter_id uuid FK -> chapters,
  position integer NOT NULL,
  status run_stage NOT NULL DEFAULT 'pending',
  assembled_content text,
  created_at timestamptz DEFAULT now()
)

fragments (
  id uuid PK,
  chapter_run_id uuid FK -> chapter_runs,
  prompt_id uuid FK -> prompts,
  position integer NOT NULL,
  content text,
  metadata jsonb,
  model_used text,
  tokens_used integer,
  created_at timestamptz DEFAULT now()
)
```

### API Routes

```
POST   /api/books                    # Create book template (admin)
GET    /api/books                    # List book templates (admin)
PUT    /api/books/[id]               # Update book template (admin)
DELETE /api/books/[id]               # Delete book template (admin)

POST   /api/books/[id]/chapters      # Add chapter (admin)
PUT    /api/chapters/[id]            # Update chapter (admin)
DELETE /api/chapters/[id]            # Delete chapter (admin)

POST   /api/chapters/[id]/prompts    # Add prompt (admin)
PUT    /api/prompts/[id]             # Update prompt (admin)
DELETE /api/prompts/[id]             # Delete prompt (admin)

POST   /api/projects                 # Create project
GET    /api/projects                 # List user projects
GET    /api/projects/[id]            # Get project detail
POST   /api/projects/[id]/generate   # Start generation (Trigger.dev job)
GET    /api/runs/[id]                # Run status
GET    /api/runs/[id]/events         # SSE progress stream
```

### Pipeline (Trigger.dev Job: generateBook)

1. Receive `runId`
2. Set run status to `running`
3. For each chapter (ordered by position):
   a. Create `chapter_run`
   b. For each prompt type 1-8 (ordered by position):
      - Replace `[TEMA]` with `project.topic`
      - Call `generateText()` via completion router
      - Save `fragment`
      - Emit progress event
   c. Execute prompt type `ensamblaje` with all 8 fragments
   d. Save assembled content to `chapter_run`
   e. Emit chapter completed event
4. Generate book title
5. Set run status to `completed`

### UI Pages

```
/admin/books/                          # List book templates
/admin/books/[id]/                     # Edit chapters (drag & drop order)
/admin/books/[id]/chapters/[chapterId]/ # Edit prompts for chapter
/projects/                             # Dashboard (reused from v2)
/projects/[id]/                        # Project detail + start generation
/projects/[id]/runs/[runId]/           # Run progress (SSE)
/login, /signup, /auth/callback        # Auth (reused from v2)
```

### Prompt Editor Features
- Textarea with markdown support
- Insert `[TEMA]` placeholder button
- Preview with sample topic
- Fields: type (select), title, content, style_rules, knowledge_areas, suggested_length
- Reorder prompts within chapter
- Reorder chapters within book template

## File Structure

```
redactor-v4/
  app/
    api/
      books/                  # Book template CRUD
      projects/               # Project CRUD + generate trigger
      runs/                   # Run status + SSE
    admin/
      books/                  # Prompt editor UI
    projects/                 # Dashboard (from v2)
    (auth)/                   # Auth pages (from v2)
  components/
    ui/                       # shadcn primitives (from v2)
    prompts/                  # Prompt editor components (new)
  lib/
    ai/
      clients/                # FROM v2
      completion.ts           # FROM v2
      providers.ts            # FROM v2 (update model list)
      rag.ts                  # FROM v2
      embeddings.ts           # FROM v2
      web-search.ts           # FROM v2
    db/
      schema/                 # NEW schema
        book-templates.ts
        chapters.ts
        prompts.ts
        projects.ts
        runs.ts
        chapter-runs.ts
        fragments.ts
      queries/                # NEW queries
      drizzle.ts              # FROM v2
    auth/                     # FROM v2
    storage/                  # FROM v2
    extraction/               # FROM v2
    chunking/                 # FROM v2
    export/                   # FROM v2
    api/                      # FROM v2 (rate limiting)
    generate.ts               # REFACTORED
    constants.ts              # FROM v2
  trigger/
    generate-book.ts          # NEW main job
    extract-source.ts         # FROM v2
  supabase/
    migrations/               # NEW clean migrations
  middleware.ts               # FROM v2
```

## Spec Self-Review
- No TBDs or placeholders in spec
- Data model covers all user stories (template CRUD, generation, progress tracking)
- API routes cover admin (books/chapters/prompts) and user (projects/runs) flows
- Pipeline handles errors: failed fragments don't crash the run, status updated to failed
- Auth: middleware from v2 protects all routes, admin routes additionally check user role
- Scope: focused on single book type per template, no template branching or conditional prompts
