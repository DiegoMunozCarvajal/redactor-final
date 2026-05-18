# Chapter-Based Generation — Design Spec

## Summary

Eliminate runs. Project page becomes control center: view chapters, generate individually, edit prompts per project.

## Data Model

### Removed
- `runs` table
- `chapter_runs` table

### New Tables

**`project_prompts`** — copy of template prompts at project creation:
```sql
project_prompts (
  id uuid PK DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_id uuid NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  position int NOT NULL,
  type prompt_type NOT NULL,           -- apertura, modelo, contraste, amplificacion, anecdota, acumulacion, proceso, cierre, ensamblaje
  title text NOT NULL,
  content text NOT NULL,               -- contains [TEMA] placeholder
  style_rules text,
  knowledge_areas text,
  suggested_length text,
  created_at timestamp NOT NULL DEFAULT now()
)
```

**`chapter_generations`** — one per chapter generation attempt:
```sql
chapter_generations (
  id uuid PK DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_id uuid NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  status generation_status NOT NULL DEFAULT 'generating',  -- generating, completed, failed
  assembled_content text,
  error text,
  created_at timestamp NOT NULL DEFAULT now(),
  completed_at timestamp
)
```

### Modified Tables

**`fragments`** — now points to `chapter_generations` and `project_prompts`:
```sql
-- old: chapter_run_id, prompt_id
-- new: chapter_generation_id, project_prompt_id
chapter_generation_id uuid NOT NULL REFERENCES chapter_generations(id) ON DELETE CASCADE,
project_prompt_id uuid NOT NULL REFERENCES project_prompts(id) ON DELETE RESTRICT,
```

**`projects`** — add title/subtitle:
```sql
title text,
subtitle text,
```

### Unchanged
- `projects` (core fields remain: id, name, topic, book_template_id, user_id)
- `book_templates`, `chapters`, `prompts` (admin-owned, template-defining)

## Pipeline

### Chapter Generation (`trigger/generate-chapter.ts`)

New Trigger.dev task:
```
generateChapter({ generationId, projectId })
  1. Load chapter_generation + project + project_prompts (for this chapter)
  2. Filter: content prompts (type != ensamblaje), assembly prompt (type = ensamblaje)
  3. For each content prompt (sequentially):
     - Replace [TEMA] with project.topic
     - Build systemPrompt (styleRules + knowledgeAreas + suggestedLength)
     - LLM call via generatePromptContent()
     - Insert fragment into DB
  4. Assembly:
     - Paste all 8 fragments into assembly prompt
     - Replace [PEGAR AQUÍ TODOS LOS FRAGMENTOS DEL CAPÍTULO] + [TEMA]
     - LLM call via generateChapterAssembly()
     - Save assembledContent to chapter_generation
  5. Mark chapter_generation → completed
  6. On error: mark failed, store error message

  After completion: if all chapters completed AND project.title is null → auto-generate title.
  Use UPDATE projects SET title = $gen WHERE id = $pid AND title IS NULL to avoid races
  between concurrent chapter completions.
```

### Title Generation

- Manual: user edits `projects.title` / `projects.subtitle` inline on project page
- Auto-fallback: when last chapter completes and `projects.title` is null, generate via prompt
- Separate API: `POST /api/projects/[id]/generate-title` (also usable standalone)

### Prompt Copy at Project Creation

`POST /api/projects`:
1. Create project row
2. Load all chapters for the book_template (ordered by position)
3. For each chapter, load all prompts (ordered by position)
4. Bulk insert into `project_prompts` with the new projectId

## API Routes

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/projects` | Create project + copy template prompts |
| GET | `/api/projects/[id]` | Project with chapters + latest generation per chapter |
| PATCH | `/api/projects/[id]` | Edit title, subtitle, topic |
| GET | `/api/projects/[id]/prompts` | List project_prompts (filterable by chapter_id) |
| PUT | `/api/projects/[id]/prompts/[promptId]` | Edit a project_prompt |
| POST | `/api/projects/[id]/prompts` | Add new prompt to a chapter |
| DELETE | `/api/projects/[id]/prompts/[promptId]` | Delete a project_prompt |
| POST | `/api/projects/[id]/chapters/[chapterId]/generate` | Trigger chapter generation |
| GET | `/api/chapter-generations/[id]` | Get generation status + fragments |

## UI

### Project Page (`app/projects/[id]/page.tsx`)

- Title/subtitle: inline editable (click to edit, Enter to save)
- Chapter list: each shows title, status badge, last generation date
- Actions per chapter:
  - `[Generar]` if never generated
  - `[Regenerar]` if completed/failed
  - `[✎]` → navigate to prompts editor
- Spinner while generating, fragment count progress
- Polling (3s) while any chapter is generating

### Prompt Editor (`app/projects/[id]/chapters/[chapterId]/prompts/page.tsx`)

- List all `project_prompts` for that chapter, ordered by position
- Each prompt: editable fields (content, styleRules, knowledgeAreas, suggestedLength)
- Inline save per prompt
- Reset to template original: fetch from `prompts` table (template) by matching chapter_id + position
- Add new prompt button → modal/inline form with type selector
- Delete custom prompts (not the original 9 from template — soft check)

### Reusable: `generatePromptContent()` and `generateChapterAssembly()`

Both functions stay in `lib/generate.ts`. They now accept `ProjectPrompt` type instead of `Prompt` — or a common interface `{ content, styleRules, knowledgeAreas, suggestedLength }`.

## Enums

- New: `generation_status` = `('generating', 'completed', 'failed')`
- Keep: `prompt_type`, `run_status` (unused but harmless until dropped)

## Migration Plan

1. Create enum `generation_status`
2. Create new tables: `project_prompts`, `chapter_generations`
3. Modify `fragments`: add `chapter_generation_id`, `project_prompt_id` (nullable initially), drop old FKs + columns later
4. Add `title`, `subtitle` to `projects`
4. Backfill: for existing projects with runs, create project_prompts from template
5. Drop `runs`, `chapter_runs`
6. Deploy new API routes + UI
7. Deploy new Trigger.dev task `generate-chapter`
