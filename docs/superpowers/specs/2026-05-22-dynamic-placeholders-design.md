# Dynamic Placeholder System — Design Spec

**Date:** 2026-05-22
**Status:** approved

## Overview

Replace hardcoded `[TEMA]`/`[SUBTÍTULO]`/`[TOPIC]`/`[SUBTITLE]` placeholder substitution with a dynamic, chapter-scoped `{name}` placeholder system. Placeholders are auto-detected from prompt content, listed read-only in the template admin, and defined with values at the project chapter level.

## Motivation

- Current system only supports two hardcoded placeholders (`[TEMA]`, `[SUBTÍTULO]`)
- Users want arbitrary custom placeholders (e.g., `{audiencia}`, `{tono}`, `{contexto}`)
- Topic currently required at project creation — should be a placeholder like any other
- Subtitle removed entirely

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| `{name}` syntax | Clean, distinguishable from system markers like `[...]` |
| Per-chapter definitions | Chapter 1 can define `{audiencia}` differently from chapter 2 |
| Auto-detect on save | Server rescans prompt content, upserts `chapter_placeholders` |
| `{tema}` not special | Just a regular placeholder, no auto-sync from project |
| Remove subtitle | Gone. No `{subtitulo}`. Old `[SUBTÍTULO]` references removed. |
| `projects.topic` → nullable | Topic now defined per-chapter via `{tema}`, not at project level |
| Assembly marker unchanged | `[PEGAR AQUÍ TODOS LOS FRAGMENTOS DEL CAPÍTULO]` stays as system marker |

## Architecture

### New Table: `chapter_placeholders`

```sql
CREATE TABLE chapter_placeholders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id  uuid NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  name        text NOT NULL,
  definition  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chapter_id, name)
);
```

### Detection

Regex: `/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g`

Runs server-side on every prompt save (create/update/delete). Algorithm:
1. Collect all `prompt.content` for the chapter
2. Extract all `{name}` tokens across all prompts
3. UPSERT into `chapter_placeholders` (insert new, keep existing)
4. DELETE rows where name no longer appears in any prompt

### Sync on Prompt Changes

All prompt mutations (create, update, delete) trigger re-scan:
- `POST /api/chapters/:id/prompts` → after insert, sync placeholders
- `PUT /api/prompts/:id` → after update, sync placeholders for the prompt's chapter
- `DELETE /api/prompts/:id` → after delete, sync placeholders for the prompt's chapter

Same for `project_prompts` API routes.

### Generation Changes (`lib/generate.ts`)

**Before:**
```typescript
content = content.replace(/\[TEMA\]|\[TOPIC\]/g, `<<TEMA>>${topic}<</TEMA>>`);
content = content.replace(/\[SUBTÍTULO\]|\[SUBTITLE\]/g, `<<SUBTÍTULO>>${subtitle}<</SUBTÍTULO>>`);
```

**After:**
```typescript
function applyPlaceholders(content: string, placeholders: Record<string, string>): string {
  for (const [name, value] of Object.entries(placeholders)) {
    const placeholder = `{${name}}`;
    if (!content.includes(placeholder)) continue;
    const sanitized = sanitizeValue(value);
    content = content.replaceAll(placeholder, `<<${name.toUpperCase()}>>${sanitized}<</${name.toUpperCase()}>>`);
  }
  return content;
}
```

`generatePromptContent` and `generateChapterAssembly` accept `placeholders: Record<string, string>` instead of `topic`/`subtitle`.

Undefined placeholders (no definition saved):
- Skip replacement — leave `{name}` as-is in prompt text
- Log warning with placeholder name and chapter ID
- Don't block generation

### Template Admin View (`/templates/[id]/chapters/[chapterId]`)

New section below prompts list. Read-only list of detected placeholders.

```
┌─ Placeholders ──────────────────────────────┐
│                                              │
│  {tema}          2 prompts use this          │
│  {audiencia}     1 prompt uses this          │
│  {tono}          4 prompts use this          │
│                                              │
│  Values are defined at the project level.    │
└──────────────────────────────────────────────┘
```

- Counts how many prompts reference each placeholder
- No edit fields
- Auto-updates when prompts are saved

### Project Chapter View (`/projects/[id]/chapters/[chapterId]`)

New "Placeholders" section with editable definition fields.

```
┌─ Placeholders ──────────────────────────────────┐
│                                                  │
│  {tema}      [La historia del café_____]         │
│  {audiencia} [jóvenes universitarios____]        │
│  {tono}      [informal y conversacional__]       │
│                                                  │
│  [Save]                                          │
└──────────────────────────────────────────────────┘
```

- All placeholders editable (including `{tema}`)
- Save writes to `chapter_placeholders.definition`
- API: `PATCH /api/projects/:id/chapters/:chapterId/placeholders`

### Project Creation

- Remove `topic` field from create project dialog and API
- `projects.topic` column becomes nullable (migration)
- `projects.subtitle` stays in schema but unused (not worth migration churn)
- User creates project with just name + template selection
- **Placeholder copy:** when project is created, template chapter placeholders (names only, no definitions) are copied to the new project-scoped chapters. Users then define values in the project chapter view.

### Migration

Data migration (`supabase/migrations/`):
1. Create `chapter_placeholders` table
2. Make `projects.topic` nullable
3. Replace `[TEMA]` → `{tema}`, `[TOPIC]` → `{tema}`, `[SUBTÍTULO]` → `{subtitulo}`, `[SUBTITLE]` → `{subtitulo}` in `prompts.content` and `project_prompts.content`
4. For each existing project chapter: insert `chapter_placeholders` rows (`{tema}` with `projects.topic` as definition, `{subtitulo}` with `projects.subtitle`)
5. Backfill `chapter_placeholders` for template chapters (name only, no definition)

## API Changes

| Route | Change |
|-------|--------|
| `POST /api/chapters/:id/prompts` | After insert, sync placeholders |
| `PUT /api/prompts/:id` | After update, sync placeholders |
| `DELETE /api/prompts/:id` | After delete, sync placeholders |
| `GET /api/chapters/:id/placeholders` | New — list placeholders for chapter |
| `PATCH /api/projects/:id/chapters/:chapterId/placeholders` | New — update definitions |
| `POST /api/projects` | Remove topic requirement |
| `POST /api/projects/:id/prompts/:promptId/generate` | Send placeholders map |
| `POST /api/projects/:id/chapters/:chapterId/assemble` | Send placeholders map |

## Components Changed

| File | Change |
|------|--------|
| `lib/db/schema/chapter-placeholders.ts` | New — schema |
| `lib/db/queries/chapter-placeholders.ts` | New — queries |
| `lib/generate.ts` | Replace hardcoded substitution with dynamic |
| `app/templates/[id]/chapters/[chapterId]/page.tsx` | Add placeholder section |
| `app/projects/[id]/chapters/[chapterId]/page.tsx` | Add editable placeholder section |
| `components/projects/create-project-dialog.tsx` | Remove topic field |
| `components/prompts/prompt-editor.tsx` | Remove `[TEMA]`/`[SUBTITLE]` insert buttons, change to `{name}` help |
| `app/api/chapters/:id/prompts/route.ts` | Sync placeholders on create |
| `app/api/prompts/:id/route.ts` | Sync placeholders on update/delete |
| `app/api/projects/:id/prompts/:promptId/generate/route.ts` | Pass placeholders map |
| `app/api/projects/:id/chapters/:chapterId/assemble/route.ts` | Pass placeholders map |
| `trigger/generate-chapter.ts` | Pass placeholders map |
| `trigger/generate-fragment.ts` | Pass placeholders map |
| `app/api/chapters/:id/placeholders/route.ts` | New — GET/PATCH |
| `app/api/projects/route.ts` | Remove topic requirement |
