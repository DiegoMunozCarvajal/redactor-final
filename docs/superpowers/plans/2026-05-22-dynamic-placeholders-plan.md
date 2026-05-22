# Dynamic Placeholder System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded `[TEMA]`/`[SUBTÍTULO]` placeholders with a dynamic chapter-scoped `{name}` placeholder system with auto-detection, template-level listing, and project-level value definitions.

**Architecture:** New `chapter_placeholders` table stores per-chapter placeholder definitions. A shared `syncChapterPlaceholders(chapterId)` helper scans prompt content for `{name}` tokens and upserts rows. Template views show read-only lists; project views allow editing definitions. `lib/generate.ts` accepts a `placeholders: Record<string, string>` map and applies all replacements before LLM calls.

**Tech Stack:** Next.js 15, Drizzle ORM, PostgreSQL, React, TypeScript

---

### Task 1: Schema + Migration

**Files:**
- Create: `lib/db/schema/chapter-placeholders.ts`
- Modify: `lib/db/schema/index.ts`
- Create: `supabase/migrations/20260522120000_dynamic_placeholders.sql`

- [ ] **Step 1: Create the schema file**

```typescript
// lib/db/schema/chapter-placeholders.ts
import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { chapters } from "./chapters";

export const chapterPlaceholders = pgTable(
  "chapter_placeholders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    definition: text("definition"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("idx_chapter_placeholders_unique").on(table.chapterId, table.name)],
);

export type ChapterPlaceholder = typeof chapterPlaceholders.$inferSelect;
export type NewChapterPlaceholder = typeof chapterPlaceholders.$inferInsert;
```

- [ ] **Step 2: Export from schema index**

Add to `lib/db/schema/index.ts`:
```typescript
export * from "./chapter-placeholders";
```

- [ ] **Step 3: Write the SQL migration**

```sql
-- supabase/migrations/20260522120000_dynamic_placeholders.sql

-- Create chapter_placeholders table
CREATE TABLE IF NOT EXISTS chapter_placeholders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id  uuid NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  name        text NOT NULL,
  definition  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chapter_placeholders_unique
  ON chapter_placeholders (chapter_id, name);

-- Make projects.topic nullable
ALTER TABLE projects ALTER COLUMN topic DROP NOT NULL;

-- Migrate [TEMA]/[TOPIC] → {tema} in template prompts
UPDATE prompts
SET content = REPLACE(REPLACE(content, '[TEMA]', '{tema}'), '[TOPIC]', '{tema}')
WHERE content LIKE '%[TEMA]%' OR content LIKE '%[TOPIC]%';

-- Migrate [SUBTÍTULO]/[SUBTITLE] → {subtitulo} in template prompts
UPDATE prompts
SET content = REPLACE(REPLACE(content, '[SUBTÍTULO]', '{subtitulo}'), '[SUBTITLE]', '{subtitulo}')
WHERE content LIKE '%[SUBTÍTULO]%' OR content LIKE '%[SUBTITLE]%';

-- Migrate [TEMA]/[TOPIC] → {tema} in project prompts
UPDATE project_prompts
SET content = REPLACE(REPLACE(content, '[TEMA]', '{tema}'), '[TOPIC]', '{tema}')
WHERE content LIKE '%[TEMA]%' OR content LIKE '%[TOPIC]%';

-- Migrate [SUBTÍTULO]/[SUBTITLE] → {subtitulo} in project prompts
UPDATE project_prompts
SET content = REPLACE(REPLACE(content, '[SUBTÍTULO]', '{subtitulo}'), '[SUBTITLE]', '{subtitulo}')
WHERE content LIKE '%[SUBTÍTULO]%' OR content LIKE '%[SUBTITLE]%';

-- Backfill chapter_placeholders for template chapters (detect {name} from prompts)
INSERT INTO chapter_placeholders (chapter_id, name, definition)
SELECT DISTINCT p.chapter_id, ph.name, NULL
FROM prompts p
CROSS JOIN LATERAL (
  SELECT unnest(regexp_matches(p.content, '\{([a-zA-Z_][a-zA-Z0-9_]*)\}', 'g')) AS name
) ph
WHERE NOT EXISTS (
  SELECT 1 FROM chapter_placeholders cp
  WHERE cp.chapter_id = p.chapter_id AND cp.name = ph.name
);

-- Backfill chapter_placeholders for project chapters: {tema} from projects.topic, {subtitulo} from projects.subtitle
INSERT INTO chapter_placeholders (chapter_id, name, definition)
SELECT c.id, 'tema', p.topic
FROM chapters c
JOIN projects p ON p.id = c.project_id
WHERE c.project_id IS NOT NULL
  AND p.topic IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM chapter_placeholders cp WHERE cp.chapter_id = c.id AND cp.name = 'tema'
  );

INSERT INTO chapter_placeholders (chapter_id, name, definition)
SELECT c.id, 'subtitulo', p.subtitle
FROM chapters c
JOIN projects p ON p.id = c.project_id
WHERE c.project_id IS NOT NULL
  AND p.subtitle IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM chapter_placeholders cp WHERE cp.chapter_id = c.id AND cp.name = 'subtitulo'
  );

-- Backfill other detected placeholders for project chapters
INSERT INTO chapter_placeholders (chapter_id, name, definition)
SELECT DISTINCT pp.chapter_id, ph.name, NULL
FROM project_prompts pp
CROSS JOIN LATERAL (
  SELECT unnest(regexp_matches(pp.content, '\{([a-zA-Z_][a-zA-Z0-9_]*)\}', 'g')) AS name
) ph
WHERE NOT EXISTS (
  SELECT 1 FROM chapter_placeholders cp
  WHERE cp.chapter_id = pp.chapter_id AND cp.name = ph.name
);
```

- [ ] **Step 4: Run migration**

```bash
pnpm db:migrate
```

- [ ] **Step 5: Run TypeScript check**

```bash
pnpm typecheck
```

Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add lib/db/schema/chapter-placeholders.ts lib/db/schema/index.ts supabase/migrations/20260522120000_dynamic_placeholders.sql
git commit -m "feat: add chapter_placeholders table and migration"
```

---

### Task 2: Placeholder Sync Logic

**Files:**
- Create: `lib/placeholders.ts`

- [ ] **Step 1: Write the sync helper**

```typescript
// lib/placeholders.ts
import { db } from "@/lib/db";
import { chapterPlaceholders } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";

const PLACEHOLDER_RE = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

/** Extract unique placeholder names from prompt content strings */
export function extractPlaceholders(contents: string[]): string[] {
  const names = new Set<string>();
  for (const content of contents) {
    for (const match of content.matchAll(PLACEHOLDER_RE)) {
      names.add(match[1]);
    }
  }
  return [...names];
}

/**
 * Sync chapter_placeholders rows for a chapter.
 * Call after any prompt create/update/delete.
 * Pass `promptContents` — all current prompt content strings for the chapter.
 */
export async function syncChapterPlaceholders(
  chapterId: string,
  promptContents: string[],
) {
  const detected = extractPlaceholders(promptContents);

  if (detected.length === 0) {
    // No placeholders found — remove all for this chapter
    await db
      .delete(chapterPlaceholders)
      .where(eq(chapterPlaceholders.chapterId, chapterId));
    return;
  }

  // Delete rows no longer referenced
  await db
    .delete(chapterPlaceholders)
    .where(
      and(
        eq(chapterPlaceholders.chapterId, chapterId),
        ...(detected.length > 0 ? [notInArray(chapterPlaceholders.name, detected)] : []),
      ),
    );

  // Upsert detected names (keep existing definitions)
  for (const name of detected) {
    await db
      .insert(chapterPlaceholders)
      .values({ chapterId, name })
      .onConflictDoNothing();
  }
}
```

Wait — Drizzle doesn't have `notInArray` directly. Fix:

```typescript
// lib/placeholders.ts
import { db } from "@/lib/db";
import { chapterPlaceholders } from "@/lib/db/schema";
import { eq, notInArray, and } from "drizzle-orm";

const PLACEHOLDER_RE = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

export function extractPlaceholders(contents: string[]): string[] {
  const names = new Set<string>();
  for (const content of contents) {
    for (const match of content.matchAll(PLACEHOLDER_RE)) {
      names.add(match[1]);
    }
  }
  return [...names];
}

export async function syncChapterPlaceholders(
  chapterId: string,
  promptContents: string[],
) {
  const detected = extractPlaceholders(promptContents);

  // Delete rows no longer referenced
  if (detected.length > 0) {
    await db
      .delete(chapterPlaceholders)
      .where(
        and(
          eq(chapterPlaceholders.chapterId, chapterId),
          notInArray(chapterPlaceholders.name, detected),
        ),
      );
  } else {
    await db
      .delete(chapterPlaceholders)
      .where(eq(chapterPlaceholders.chapterId, chapterId));
    return;
  }

  // Upsert detected names (keep existing definitions)
  for (const name of detected) {
    await db
      .insert(chapterPlaceholders)
      .values({ chapterId, name })
      .onConflictDoNothing();
  }
}

export { chapterPlaceholders };
```

- [ ] **Step 2: TypeScript check**

```bash
pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add lib/placeholders.ts
git commit -m "feat: add placeholder detection and sync logic"
```

---

### Task 3: Update `lib/generate.ts`

**Files:**
- Modify: `lib/generate.ts`

- [ ] **Step 1: Replace hardcoded substitution with dynamic**

Replace the entire file content:

```typescript
import { generateCompletion } from "@/lib/ai/completion";
import { DEFAULT_GENERATION_MODEL, getProviderForModel } from "@/lib/ai/providers";

function sanitizeValue(value: string): string {
  return value
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/<</g, "‹‹")
    .replace(/>>/g, "››")
    .trim();
}

export interface PromptLike {
  content: string;
}

export interface GeneratePromptParams {
  prompt: PromptLike;
  placeholders: Record<string, string>;
  model?: string;
  temperature?: number;
}

export interface GenerateResult {
  text: string;
  model: string;
  provider: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

function applyPlaceholders(content: string, placeholders: Record<string, string>): string {
  for (const [name, value] of Object.entries(placeholders)) {
    const token = `{${name}}`;
    if (!content.includes(token)) continue;
    const sanitized = sanitizeValue(value);
    content = content.replaceAll(
      token,
      `<<${name.toUpperCase()}>>${sanitized}<</${name.toUpperCase()}>>`,
    );
  }
  return content;
}

export async function generatePromptContent(
  params: GeneratePromptParams,
): Promise<GenerateResult> {
  const { prompt, placeholders, model = DEFAULT_GENERATION_MODEL, temperature } = params;
  const content = applyPlaceholders(prompt.content, placeholders);

  const result = await generateCompletion({
    model,
    systemPrompt: "",
    userPrompt: content,
    ...(temperature !== undefined ? { temperature } : {}),
    effort: "max",
  });

  return {
    text: result.data as string,
    model,
    provider: getProviderForModel(model),
    usage: {
      inputTokens: result.usage.promptTokens,
      outputTokens: result.usage.completionTokens,
    },
  };
}

export async function generateChapterAssembly(
  assemblyPrompt: PromptLike,
  fragments: { content: string }[],
  placeholders: Record<string, string>,
  model = DEFAULT_GENERATION_MODEL,
  temperature?: number,
): Promise<GenerateResult> {
  const fragmentsText = fragments
    .map((f, i) => `### Fragment ${i + 1}\n\n${f.content}`)
    .join("\n\n---\n\n");

  let content = applyPlaceholders(assemblyPrompt.content, placeholders);
  content = content.replace(
    /\[PEGAR AQUÍ TODOS LOS FRAGMENTOS DEL CAPÍTULO\]|\[PASTE ALL CHAPTER FRAGMENTS HERE\]/g,
    fragmentsText,
  );

  const result = await generateCompletion({
    model,
    systemPrompt: "",
    userPrompt: content,
    ...(temperature !== undefined ? { temperature } : {}),
    effort: "max",
  });

  return {
    text: result.data as string,
    model,
    provider: getProviderForModel(model),
    usage: {
      inputTokens: result.usage.promptTokens,
      outputTokens: result.usage.completionTokens,
    },
  };
}
```

- [ ] **Step 2: TypeScript check**

```bash
pnpm typecheck
```

Expected: errors in files that still call old signature (`topic`, `subtitle`). Those get fixed in Tasks 4-8.

- [ ] **Step 3: Commit**

```bash
git add lib/generate.ts
git commit -m "feat: replace hardcoded placeholder substitution with dynamic applyPlaceholders"
```

---

### Task 4: Update Template Prompt API Routes (Sync Placeholders)

**Files:**
- Modify: `app/api/chapters/[id]/prompts/route.ts` (POST — after insert)
- Modify: `app/api/prompts/[id]/route.ts` (PUT — after update, DELETE — after delete)

- [ ] **Step 1: Add sync to POST `/api/chapters/[id]/prompts`**

After the `db.insert(prompts)` call and before the `return`, add:

```typescript
// Sync placeholders for this chapter
const allPrompts = await db
  .select({ content: prompts.content })
  .from(prompts)
  .where(eq(prompts.chapterId, id));
await syncChapterPlaceholders(id, allPrompts.map((p) => p.content));
```

Also add the import at top:
```typescript
import { syncChapterPlaceholders } from "@/lib/placeholders";
```

- [ ] **Step 2: Add sync to PUT `/api/prompts/[id]`**

After the `db.update(prompts)` call and `logAudit`, add:

```typescript
// Sync placeholders for the prompt's chapter
if (prompt) {
  const allPrompts = await db
    .select({ content: prompts.content })
    .from(prompts)
    .where(eq(prompts.chapterId, prompt.chapterId));
  await syncChapterPlaceholders(prompt.chapterId, allPrompts.map((p) => p.content));
}
```

- [ ] **Step 3: Add sync to DELETE `/api/prompts/[id]`**

Before deleting, capture the chapterId. After delete, sync:

```typescript
// In DELETE handler, before delete:
const [existing] = await db
  .select({ chapterId: prompts.chapterId })
  .from(prompts)
  .where(eq(prompts.id, id))
  .limit(1);

await db.delete(prompts).where(eq(prompts.id, id));

// Sync placeholders
if (existing) {
  const allPrompts = await db
    .select({ content: prompts.content })
    .from(prompts)
    .where(eq(prompts.chapterId, existing.chapterId));
  await syncChapterPlaceholders(existing.chapterId, allPrompts.map((p) => p.content));
}
```

- [ ] **Step 4: TypeScript check**

```bash
pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add app/api/chapters/[id]/prompts/route.ts app/api/prompts/[id]/route.ts
git commit -m "feat: sync placeholders on prompt create/update/delete"
```

---

### Task 5: Add Placeholder API Routes

**Files:**
- Create: `app/api/chapters/[id]/placeholders/route.ts`
- Create: `app/api/projects/[id]/chapters/[chapterId]/placeholders/route.ts`

- [ ] **Step 1: Create GET route for chapter placeholders (template + project)**

```typescript
// app/api/chapters/[id]/placeholders/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chapterPlaceholders } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, asc } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const rows = await db
    .select()
    .from(chapterPlaceholders)
    .where(eq(chapterPlaceholders.chapterId, id))
    .orderBy(asc(chapterPlaceholders.name));

  return NextResponse.json(rows);
}
```

- [ ] **Step 2: Create PATCH route for project chapter placeholders**

```typescript
// app/api/projects/[id]/chapters/[chapterId]/placeholders/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, chapterPlaceholders } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, and } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; chapterId: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id, chapterId } = await params;

  // Verify ownership
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const rows = await db
    .select()
    .from(chapterPlaceholders)
    .where(eq(chapterPlaceholders.chapterId, chapterId))
    .orderBy(eq(chapterPlaceholders.name));

  return NextResponse.json(rows);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; chapterId: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id, chapterId } = await params;

  // Verify ownership
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  // body: { placeholders: { name: definition, ... } }
  const definitions: Record<string, string | null> = body.placeholders ?? {};

  for (const [name, definition] of Object.entries(definitions)) {
    await db
      .update(chapterPlaceholders)
      .set({ definition })
      .where(
        and(
          eq(chapterPlaceholders.chapterId, chapterId),
          eq(chapterPlaceholders.name, name),
        ),
      );
  }

  // Return updated list
  const rows = await db
    .select()
    .from(chapterPlaceholders)
    .where(eq(chapterPlaceholders.chapterId, chapterId))
    .orderBy(eq(chapterPlaceholders.name));

  return NextResponse.json(rows);
}
```

- [ ] **Step 3: TypeScript check**

```bash
pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add app/api/chapters/[id]/placeholders/route.ts app/api/projects/[id]/chapters/[chapterId]/placeholders/route.ts
git commit -m "feat: add placeholder GET/PATCH API routes"
```

---

### Task 6: Update Generation API Routes (Pass Placeholders)

**Files:**
- Modify: `app/api/projects/[id]/prompts/[promptId]/generate/route.ts`
- Modify: `app/api/projects/[id]/chapters/[chapterId]/assemble/route.ts`

- [ ] **Step 1: Add placeholder loading helper**

Both routes need the same helper. Add this function in each route (or extract to a shared util — keeping it inline for now):

```typescript
import { chapterPlaceholders } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

async function loadPlaceholders(chapterId: string): Promise<Record<string, string>> {
  const rows = await db
    .select()
    .from(chapterPlaceholders)
    .where(eq(chapterPlaceholders.chapterId, chapterId));

  const map: Record<string, string> = {};
  let warned = false;
  for (const row of rows) {
    if (row.definition) {
      map[row.name] = row.definition;
    } else if (!warned) {
      console.warn(`[placeholders] Chapter ${chapterId}: "{${row.name}}" has no definition, leaving unreplaced`);
      warned = true;
    }
  }
  return map;
}
```

- [ ] **Step 2: Update generate route**

Replace:
```typescript
const result = await generatePromptContent({
  prompt,
  topic: project.topic,
  subtitle: project.subtitle,
  ...(model ? { model } : {}),
  ...(temperature !== undefined ? { temperature } : {}),
});
```

With:
```typescript
const placeholders = await loadPlaceholders(prompt.chapterId);

const result = await generatePromptContent({
  prompt,
  placeholders,
  ...(model ? { model } : {}),
  ...(temperature !== undefined ? { temperature } : {}),
});
```

Also remove the `projects` import if no longer used (it may still be used for ownership check).

- [ ] **Step 3: Update assemble route**

Replace:
```typescript
const assembled = await generateChapterAssembly(
  assemblyPrompt,
  fragmentContents,
  project.topic,
  project.subtitle,
  model,
  temperature,
);
```

With:
```typescript
const placeholders = await loadPlaceholders(chapterId);

const assembled = await generateChapterAssembly(
  assemblyPrompt,
  fragmentContents,
  placeholders,
  model,
  temperature,
);
```

- [ ] **Step 4: TypeScript check**

```bash
pnpm typecheck
```

Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add app/api/projects/[id]/prompts/[promptId]/generate/route.ts app/api/projects/[id]/chapters/[chapterId]/assemble/route.ts
git commit -m "feat: pass chapter placeholders to generation API routes"
```

---

### Task 7: Update Trigger.dev Tasks

**Files:**
- Modify: `trigger/generate-chapter.ts`
- Modify: `trigger/generate-fragment.ts`

- [ ] **Step 1: Add `loadPlaceholders` function to `trigger/generate-chapter.ts`**

Add import:
```typescript
import { chapterPlaceholders } from "@/lib/db/schema";
```

Add helper at module level:
```typescript
async function loadPlaceholders(chapterId: string): Promise<Record<string, string>> {
  const rows = await db
    .select()
    .from(chapterPlaceholders)
    .where(eq(chapterPlaceholders.chapterId, chapterId));

  const map: Record<string, string> = {};
  for (const row of rows) {
    if (row.definition) {
      map[row.name] = row.definition;
    }
  }
  return map;
}
```

- [ ] **Step 2: Update `generateChapter` task**

Replace `generatePromptContent({ prompt, topic: project.topic, subtitle: project.subtitle, ... })` with:

```typescript
const placeholders = await loadPlaceholders(gen.chapterId);

const result = await generatePromptContent({
  prompt,
  placeholders,
  ...(model ? { model } : {}),
  ...(temperature !== undefined ? { temperature } : {}),
});
```

Replace `generateChapterAssembly(assemblyPrompt, fragmentContents, project.topic, project.subtitle, ...)` with:

```typescript
const assembled = await generateChapterAssembly(
  assemblyPrompt,
  fragmentContents,
  placeholders,
  model,
  temperature,
);
```

Replace the title generation block (hardcoded `[TEMA]`) — update the inline prompt:
```typescript
const titlePromptContent = 'Genera un título y subtítulo atractivo para un libro sobre {tema}. Responde en formato JSON: { "title": "...", "subtitle": "..." }';

const titleResult = await generatePromptContent({
  prompt: { content: titlePromptContent },
  placeholders,
  ...(model ? { model } : {}),
});
```

- [ ] **Step 3: Update `generateFragment` task**

Replace `generatePromptContent({ prompt, topic: project.topic, subtitle: project.subtitle, ... })` with:

```typescript
const placeholders = await loadPlaceholders(gen.chapterId);

const result = await generatePromptContent({
  prompt,
  placeholders,
  ...(model ? { model } : {}),
  ...(temperature !== undefined ? { temperature } : {}),
});
```

Add the `loadPlaceholders` function and `chapterPlaceholders` import (same as step 1).

- [ ] **Step 4: TypeScript check**

```bash
pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add trigger/generate-chapter.ts trigger/generate-fragment.ts
git commit -m "feat: pass chapter placeholders to trigger.dev tasks"
```

---

### Task 8: Update Project Creation (Remove Topic, Copy Placeholders)

**Files:**
- Modify: `app/api/projects/route.ts`
- Modify: `components/projects/create-project-dialog.tsx`

- [ ] **Step 1: Update `app/api/projects/route.ts`**

Remove `topic` validation. Change from:
```typescript
if (typeof topic !== "string" || topic.length < 1 || topic.length > 500) {
  return NextResponse.json({ error: "topic must be 1-500 characters" }, { status: 400 });
}
```
To: remove the block entirely. `topic` is now optional.

Update the `projects.insert` to not include topic:
```typescript
const [p] = await tx
  .insert(projects)
  .values({ userId: user.id, name, bookTemplateId: bookTemplateId ?? null })
  .returning();
```

After copying template prompts (`tx.insert(projectPrompts)` block), add placeholder copy:

```typescript
// Copy template chapter placeholders to project chapters
const templateChapterIds = templateChapters.map((tc) => tc.id);
if (templateChapterIds.length > 0) {
  const templatePlaceholders = await tx
    .select()
    .from(chapterPlaceholders)
    .where(inArray(chapterPlaceholders.chapterId, templateChapterIds));

  // Map template chapter ID → project chapter ID
  const chapterIdMap = new Map<string, string>();
  // (We already have the mapping from the loop above — capture it)
  // Actually we need to restructure: capture the mapping during chapter copy
}
```

Wait — the chapter copy loop already exists but doesn't capture the mapping. Restructure the template copy section:

```typescript
if (bookTemplateId) {
  const templateChapters = await tx
    .select()
    .from(chapters)
    .where(
      and(
        eq(chapters.bookTemplateId, bookTemplateId),
        isNull(chapters.projectId),
      ),
    )
    .orderBy(asc(chapters.position));

  const chapterIdMap = new Map<string, string>(); // template → project

  for (const chapter of templateChapters) {
    const [projectChapter] = await tx
      .insert(chapters)
      .values({
        bookTemplateId,
        projectId: p.id,
        position: chapter.position,
        title: chapter.title,
      })
      .returning();

    chapterIdMap.set(chapter.id, projectChapter.id);

    const templatePrompts = await tx
      .select()
      .from(prompts)
      .where(eq(prompts.chapterId, chapter.id))
      .orderBy(asc(prompts.position));

    if (templatePrompts.length > 0) {
      await tx.insert(projectPrompts).values(
        templatePrompts.map((prompt) => ({
          projectId: p.id,
          chapterId: projectChapter.id,
          position: prompt.position,
          isAssembly: prompt.isAssembly,
          title: prompt.title,
          content: prompt.content,
        })),
      );
    }
  }

  // Copy template placeholders to project chapters (names only, no definitions)
  const allTemplateChapterIds = templateChapters.map((tc) => tc.id);
  const templatePlaceholders = await tx
    .select()
    .from(chapterPlaceholders)
    .where(inArray(chapterPlaceholders.chapterId, allTemplateChapterIds));

  for (const ph of templatePlaceholders) {
    const projectChapterId = chapterIdMap.get(ph.chapterId);
    if (projectChapterId) {
      await tx
        .insert(chapterPlaceholders)
        .values({ chapterId: projectChapterId, name: ph.name })
        .onConflictDoNothing();
    }
  }
}
```

Add imports:
```typescript
import { chapterPlaceholders } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
```

- [ ] **Step 2: Update `components/projects/create-project-dialog.tsx`**

Remove `topic` from the Zod schema:
```typescript
const schema = z.object({
  name: z.string().min(1, "Required").max(100),
});
```

Remove `topic` from `FormData` type (auto-inferred from schema).

Remove the topic `<Input>` field from the form.

Update the submit handler to not send topic:
```typescript
async function onSubmit(data: FormData) {
  try {
    const body: { name: string; bookTemplateId?: string } = { name: data.name };
    if (bookTemplateId) {
      body.bookTemplateId = bookTemplateId;
    }
    // ... rest unchanged
```

- [ ] **Step 3: TypeScript check**

```bash
pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add app/api/projects/route.ts components/projects/create-project-dialog.tsx
git commit -m "feat: remove topic requirement from project creation, copy placeholders"
```

---

### Task 9: Add Placeholder Section to Template Chapter Editor

**Files:**
- Modify: `app/templates/[id]/chapters/[chapterId]/page.tsx`

- [ ] **Step 1: Add state and fetch for placeholders**

Add imports:
```typescript
import type { ChapterPlaceholder } from "@/lib/db/schema";
```

Add state at top:
```typescript
const [placeholders, setPlaceholders] = useState<ChapterPlaceholder[]>([]);
```

Add fetch in the `useEffect`:
```typescript
fetch(`/api/chapters/${params.chapterId}/placeholders`)
  .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
  .then((data) => { if (!cancelled) setPlaceholders(data) })
  .catch(() => { /* placeholders are supplementary */ })
```

Add a `fetchPlaceholders` function for refetching after prompt mutations:

```typescript
async function fetchPlaceholders() {
  try {
    const res = await fetch(`/api/chapters/${params.chapterId}/placeholders`);
    if (res.ok) setPlaceholders(await res.json());
  } catch { /* ignore */ }
}
```

Call `fetchPlaceholders()` after each `createPrompt`, `savePrompt`, and `deletePrompt` success path.

- [ ] **Step 2: Add the Placeholders section UI**

Add after the prompts list section and before the assembly prompt section:

```tsx
{placeholders.length > 0 && (
  <div className="mb-6">
    <h2 className="text-sm font-medium text-muted-foreground mb-3">
      Placeholders
    </h2>
    <Card>
      <CardContent className="pt-4 space-y-2">
        {placeholders.map((ph) => (
          <div key={ph.id} className="flex items-center justify-between text-sm">
            <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
              {"{"}{ph.name}{"}"}
            </code>
            <span className="text-xs text-muted-foreground">
              {/* count prompts using this placeholder */}
            </span>
          </div>
        ))}
        <p className="text-[10px] text-muted-foreground pt-2">
          Values are defined at the project level.
        </p>
      </CardContent>
    </Card>
  </div>
)}
```

For the count, compute it inline using prompts array:
```tsx
{(() => {
  const count = prompts.filter((p) => p.content.includes(`{${ph.name}}`)).length;
  return `${count} prompt${count !== 1 ? "s" : ""} use this`;
})()}
```

- [ ] **Step 3: TypeScript check**

```bash
pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add app/templates/[id]/chapters/[chapterId]/page.tsx
git commit -m "feat: add read-only placeholder section to template chapter editor"
```

---

### Task 10: Add Editable Placeholder Section to Project Chapter Page

**Files:**
- Modify: `app/projects/[id]/chapters/[chapterId]/page.tsx`

- [ ] **Step 1: Add state and fetch for placeholders**

Add import:
```typescript
import type { ChapterPlaceholder } from "@/lib/db/schema";
```

Add state:
```typescript
const [placeholders, setPlaceholders] = useState<ChapterPlaceholder[]>([]);
const [placeholderForm, setPlaceholderForm] = useState<Record<string, string>>({});
const [savingPlaceholders, setSavingPlaceholders] = useState(false);
```

Add fetch function:
```typescript
const fetchPlaceholders = useCallback(async (signal?: AbortSignal) => {
  try {
    const res = await fetch(
      `/api/projects/${params.id}/chapters/${params.chapterId}/placeholders`,
      { signal },
    );
    if (signal?.aborted) return;
    if (res.ok) {
      const data = await res.json();
      setPlaceholders(data);
      // Initialize form with current definitions
      const form: Record<string, string> = {};
      for (const ph of data) {
        if (ph.definition) form[ph.name] = ph.definition;
      }
      setPlaceholderForm((prev) => ({ ...form, ...prev }));
    }
  } catch { /* supplementary */ }
}, [params.id, params.chapterId]);
```

Add to the useEffect fetch chain:
```typescript
useEffect(() => {
  const controller = new AbortController();
  Promise.all([
    fetchChapter(controller.signal),
    fetchPrompts(controller.signal),
    fetchPlaceholders(controller.signal),
  ]);
  return () => controller.abort();
}, [fetchChapter, fetchPrompts, fetchPlaceholders]);
```

- [ ] **Step 2: Add save function**

```typescript
async function savePlaceholders() {
  setSavingPlaceholders(true);
  try {
    const res = await fetch(
      `/api/projects/${params.id}/chapters/${params.chapterId}/placeholders`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeholders: placeholderForm }),
      },
    );
    if (res.ok) {
      setPlaceholders(await res.json());
      toast.success("Placeholders saved");
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Error saving placeholders");
    }
  } catch {
    toast.error("Network error");
  } finally {
    setSavingPlaceholders(false);
  }
}
```

- [ ] **Step 3: Add Placeholders section UI**

Add after the toolbar and before the content prompts section:

```tsx
{placeholders.length > 0 && (
  <div className="mb-6">
    <h2 className="text-sm font-medium text-muted-foreground mb-3">
      Placeholders
    </h2>
    <Card>
      <CardContent className="pt-4 space-y-3">
        {placeholders.map((ph) => (
          <div key={ph.id} className="space-y-1.5">
            <Label className="text-[10px] text-muted-foreground">
              {"{"}{ph.name}{"}"}
            </Label>
            <Input
              value={placeholderForm[ph.name] ?? ""}
              onChange={(e) =>
                setPlaceholderForm((prev) => ({
                  ...prev,
                  [ph.name]: e.target.value,
                }))
              }
              className="text-xs h-8"
              placeholder={`Define "${ph.name}"...`}
            />
          </div>
        ))}
        <div className="flex justify-end pt-2">
          <Button
            size="sm"
            className="text-xs"
            onClick={savePlaceholders}
            disabled={savingPlaceholders}
          >
            {savingPlaceholders ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <Save className="h-3 w-3 mr-1" />
            )}
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  </div>
)}
```

Need to import `Save` from lucide-react:
```typescript
import { ..., Save, ... } from "lucide-react";
```
(Check if `Save` is already imported — add if not.)

- [ ] **Step 4: TypeScript check**

```bash
pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add app/projects/[id]/chapters/[chapterId]/page.tsx
git commit -m "feat: add editable placeholder section to project chapter page"
```

---

### Task 11: Update Prompt Editor Component (Insert Buttons)

**Files:**
- Modify: `components/prompts/prompt-editor.tsx`

- [ ] **Step 1: Replace `[TEMA]`/`[SUBTITLE]` insert buttons with `{name}` help**

Change the insert buttons from:
```tsx
<button type="button" onClick={() => insertPlaceholder("[TEMA]")} ...>+ [TEMA]</button>
<button type="button" onClick={() => insertPlaceholder("[SUBTITLE]")} ...>+ [SUBTITLE]</button>
```

To a single help text:
```tsx
<span className="text-[10px] text-muted-foreground">
  Use {"{name}"} for placeholders
</span>
```

- [ ] **Step 2: TypeScript check**

```bash
pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add components/prompts/prompt-editor.tsx
git commit -m "feat: replace [TEMA]/[SUBTITLE] insert buttons with {name} help text"
```

---

### Task 12: Update Assembly Prompt Default in Template Editor

**Files:**
- Modify: `app/templates/[id]/chapters/[chapterId]/page.tsx`

- [ ] **Step 1: Fix the default assembly prompt content**

Find the "Add Assembly Prompt" button's `onClick` handler. Change:
```typescript
content: "[TEMA]\n\n[SUBTÍTULO]\n\nAssembles the fragments...",
```

To:
```typescript
content: "{tema}\n\nAssembles the fragments...",
```

- [ ] **Step 2: Commit**

```bash
git add app/templates/[id]/chapters/[chapterId]/page.tsx
git commit -m "fix: update default assembly prompt to use {tema} placeholder"
```

---

### Task 13: Final Verification

- [ ] **Step 1: Run typecheck**

```bash
pnpm typecheck
```

Expected: passes with zero errors.

- [ ] **Step 2: Run existing tests**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 3: Run lint**

```bash
pnpm lint
```

- [ ] **Step 4: Manual verification checklist**

- [ ] Create a template, add a chapter, add a prompt with `{audiencia}` — verify placeholder appears in read-only list
- [ ] Edit prompt to add `{tono}` — verify new placeholder appears
- [ ] Delete prompt with `{tono}` — verify placeholder removed if no other prompt uses it
- [ ] Create project from template — verify placeholders copied (names only)
- [ ] Go to project chapter — verify placeholder section shows with editable fields
- [ ] Define values for all placeholders, save
- [ ] Generate a fragment — verify placeholders replaced in LLM call
- [ ] Assemble chapter — verify placeholders replaced in assembly

- [ ] **Step 5: Final commit (if any fixes applied)**

---

## Self-Review Checklist

- [x] All API route params use `Promise<{ id: string }>` pattern (Next.js 15)
- [x] `onConflictDoNothing()` used for upserts — requires Drizzle's PostgreSQL driver support
- [x] `chapterPlaceholders` imported in all files that use it
- [x] `save` icon import added to project chapter page
- [x] No `topic` field remaining in create project dialog or API validation
- [x] Template editor defaults updated from `[TEMA]` to `{tema}`
- [x] Assembly marker `[PEGAR AQUÍ TODOS LOS FRAGMENTOS DEL CAPÍTULO]` left unchanged
- [x] Trigger.dev tasks updated with `loadPlaceholders`
- [x] Title auto-generation prompt updated from `[TEMA]` to `{tema}`
