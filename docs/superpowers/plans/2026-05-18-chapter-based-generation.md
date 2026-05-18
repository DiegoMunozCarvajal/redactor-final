# Chapter-Based Generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the run-based book generation pipeline with chapter-based generation where users generate individual chapters and edit prompts per project.

**Architecture:** New tables `project_prompts` (per-project prompt copies) and `chapter_generations` (one per chapter attempt) replace `runs` + `chapter_runs`. A new Trigger.dev task `generate-chapter` handles single-chapter generation. The project page becomes the control center: chapter list, per-chapter generate/regenerate, inline prompt editing.

**Tech Stack:** Next.js 15, Drizzle ORM, PostgreSQL, Trigger.dev, React Server Components, shadcn/ui

---

### Task 1: Create new Drizzle schema files

**Files:**
- Create: `lib/db/schema/project-prompts.ts`
- Create: `lib/db/schema/chapter-generations.ts`
- Modify: `lib/db/schema/index.ts`
- Modify: `lib/db/schema/projects.ts`
- Modify: `lib/db/schema/fragments.ts`

- [ ] **Step 1: Create `lib/db/schema/project-prompts.ts`**

```typescript
import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { chapters } from "./chapters";
import { promptTypeEnum } from "./prompts";

export const projectPrompts = pgTable("project_prompts", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  chapterId: uuid("chapter_id")
    .notNull()
    .references(() => chapters.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  type: promptTypeEnum("type").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  styleRules: text("style_rules"),
  knowledgeAreas: text("knowledge_areas"),
  suggestedLength: text("suggested_length"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ProjectPrompt = typeof projectPrompts.$inferSelect;
export type NewProjectPrompt = typeof projectPrompts.$inferInsert;
```

- [ ] **Step 2: Create `lib/db/schema/chapter-generations.ts`**

```typescript
import { index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { chapters } from "./chapters";

export const generationStatusEnum = pgEnum("generation_status", [
  "generating",
  "completed",
  "failed",
]);

export const chapterGenerations = pgTable(
  "chapter_generations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    status: generationStatusEnum("status").notNull().default("generating"),
    assembledContent: text("assembled_content"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [index("idx_chapter_generations_project").on(table.projectId, table.chapterId)],
);

export type ChapterGeneration = typeof chapterGenerations.$inferSelect;
export type NewChapterGeneration = typeof chapterGenerations.$inferInsert;
```

- [ ] **Step 3: Modify `lib/db/schema/projects.ts` — add title/subtitle**

```typescript
import { index, pgSchema, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { bookTemplates } from "./book-templates";

const authSchema = pgSchema("auth");
const authUsers = authSchema.table("users", {
  id: uuid("id").notNull(),
});

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    topic: text("topic").notNull(),
    bookTemplateId: uuid("book_template_id")
      .notNull()
      .references(() => bookTemplates.id, { onDelete: "restrict" }),
    title: text("title"),
    subtitle: text("subtitle"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_projects_user").on(table.userId)],
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
```

- [ ] **Step 4: Modify `lib/db/schema/fragments.ts` — new FK columns, keep old ones for now**

```typescript
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { chapterRuns } from "./chapter-runs";
import { prompts } from "./prompts";
import { chapterGenerations } from "./chapter-generations";
import { projectPrompts } from "./project-prompts";

export const fragments = pgTable(
  "fragments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chapterRunId: uuid("chapter_run_id")
      .references(() => chapterRuns.id, { onDelete: "cascade" }),
    promptId: uuid("prompt_id")
      .references(() => prompts.id, { onDelete: "restrict" }),
    chapterGenerationId: uuid("chapter_generation_id")
      .references(() => chapterGenerations.id, { onDelete: "cascade" }),
    projectPromptId: uuid("project_prompt_id")
      .references(() => projectPrompts.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    content: text("content"),
    metadata: jsonb("metadata"),
    modelUsed: text("model_used"),
    tokensUsed: integer("tokens_used"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_fragments_chapter_run").on(table.chapterRunId),
    index("idx_fragments_chapter_generation").on(table.chapterGenerationId),
  ],
);

export type Fragment = typeof fragments.$inferSelect;
export type NewFragment = typeof fragments.$inferInsert;
```

- [ ] **Step 5: Modify `lib/db/schema/index.ts`**

```typescript
export * from "./book-templates";
export * from "./chapters";
export * from "./prompts";
export * from "./project-prompts";
export * from "./projects";
export * from "./runs";
export * from "./chapter-runs";
export * from "./chapter-generations";
export * from "./fragments";
```

- [ ] **Step 6: Run type check**

```bash
pnpm typecheck
```

Expected: no errors (new tables are additive, old FKs made nullable).

- [ ] **Step 7: Commit**

```bash
git add lib/db/schema/
git commit -m "feat: add project_prompts, chapter_generations schemas; extend projects and fragments"
```

---

### Task 2: Write DB migration

**Files:**
- Create: `supabase/migrations/YYYYMMDDHHMMSS_chapter_based_generation.sql`

- [ ] **Step 1: Generate migration filename**

```bash
echo "supabase/migrations/$(date +%Y%m%d%H%M%S)_chapter_based_generation.sql"
```

- [ ] **Step 2: Write migration SQL**

```sql
-- Create enums
CREATE TYPE generation_status AS ENUM ('generating', 'completed', 'failed');

-- Create project_prompts table
CREATE TABLE project_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_id uuid NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  position integer NOT NULL,
  type prompt_type NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  style_rules text,
  knowledge_areas text,
  suggested_length text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create chapter_generations table
CREATE TABLE chapter_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_id uuid NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  status generation_status NOT NULL DEFAULT 'generating',
  assembled_content text,
  error text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone
);

CREATE INDEX idx_chapter_generations_project ON chapter_generations(project_id, chapter_id);

-- Add title/subtitle to projects
ALTER TABLE projects ADD COLUMN title text;
ALTER TABLE projects ADD COLUMN subtitle text;

-- Add new FK columns to fragments (nullable for transition)
ALTER TABLE fragments ADD COLUMN chapter_generation_id uuid REFERENCES chapter_generations(id) ON DELETE CASCADE;
ALTER TABLE fragments ADD COLUMN project_prompt_id uuid REFERENCES project_prompts(id) ON DELETE RESTRICT;

CREATE INDEX idx_fragments_chapter_generation ON fragments(chapter_generation_id);

-- Backfill project_prompts for existing projects
INSERT INTO project_prompts (project_id, chapter_id, position, type, title, content, style_rules, knowledge_areas, suggested_length)
SELECT
  p.id AS project_id,
  ch.id AS chapter_id,
  pr.position,
  pr.type,
  pr.title,
  pr.content,
  pr.style_rules,
  pr.knowledge_areas,
  pr.suggested_length
FROM projects p
JOIN chapters ch ON ch.book_template_id = p.book_template_id
JOIN prompts pr ON pr.chapter_id = ch.id;

-- Backfill project titles from latest completed run
UPDATE projects p SET
  title = r.title,
  subtitle = r.subtitle
FROM (
  SELECT DISTINCT ON (project_id) project_id, title, subtitle
  FROM runs
  WHERE status = 'completed' AND title IS NOT NULL
  ORDER BY project_id, completed_at DESC
) r
WHERE p.id = r.project_id;
```

- [ ] **Step 3: Apply migration**

```bash
pnpm db:migrate
```

Expected: migration applied successfully.

- [ ] **Step 4: Verify tables exist**

```bash
pnpm db:studio
```

Check: `project_prompts`, `chapter_generations` tables visible with expected columns.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/
git commit -m "feat: add migration for chapter-based generation tables"
```

---

### Task 3: Update rate limiting to use new tables

**Files:**
- Modify: `lib/api/rate-limit.ts`

- [ ] **Step 1: Update `checkProjectRateLimit` to query `chapter_generations` instead of `runs`**

Replace the entire file:

```typescript
import postgres from "postgres";
import { db } from "@/lib/db/drizzle";
import { chapterGenerations } from "@/lib/db/schema";
import { eq, and, gte, sql, inArray } from "drizzle-orm";

const WINDOW_SECONDS = 60;
const MAX_GENERATIONS_PER_WINDOW = 1;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL environment variable is required");

const lockClient = postgres(databaseUrl, {
  prepare: false,
  max: 10,
  idle_timeout: 300,
  connect_timeout: 10,
});

function projectIdToLockKey(projectId: string): [number, number] {
  const hex = projectId.replace(/-/g, "");
  const key1 = parseInt(hex.substring(0, 8), 16) | 0;
  const key2 = parseInt(hex.substring(8, 16), 16) | 0;
  return [key1, key2];
}

export async function withProjectLock<T>(
  projectId: string,
  fn: () => Promise<T>
): Promise<{ locked: false } | { locked: true; result: T }> {
  const [key1, key2] = projectIdToLockKey(projectId);

  return lockClient.begin(async (tx) => {
    const [row] = await tx.unsafe(
      `SELECT pg_try_advisory_lock($1, $2) AS acquired`,
      [key1, key2]
    );

    if (!row.acquired) {
      return { locked: false };
    }

    try {
      const result = await fn();
      return { locked: true, result };
    } finally {
      await tx.unsafe(`SELECT pg_advisory_unlock($1, $2)`, [key1, key2]).catch(() => {});
    }
  }) as Promise<{ locked: false } | { locked: true; result: T }>;
}

export async function checkProjectRateLimit(
  projectId: string
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const windowStart = new Date(Date.now() - WINDOW_SECONDS * 1000);

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(chapterGenerations)
    .where(
      and(
        eq(chapterGenerations.projectId, projectId),
        gte(chapterGenerations.createdAt, windowStart),
        inArray(chapterGenerations.status, ["generating"])
      )
    );

  const recentGenerations = row?.count ?? 0;

  if (recentGenerations >= MAX_GENERATIONS_PER_WINDOW) {
    return { allowed: false, retryAfter: WINDOW_SECONDS };
  }

  return { allowed: true };
}
```

- [ ] **Step 2: Run type check**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/api/rate-limit.ts
git commit -m "feat: update rate limiting to query chapter_generations"
```

---

### Task 4: Update `lib/generate.ts` to use PromptLike interface

**Files:**
- Modify: `lib/generate.ts`

- [ ] **Step 1: Add PromptLike interface and update function signatures**

Replace the file:

```typescript
import { generateCompletion } from "@/lib/ai/completion";
import { getProviderForModel } from "@/lib/ai/providers";

export interface PromptLike {
  content: string;
  styleRules: string | null;
  knowledgeAreas: string | null;
  suggestedLength: string | null;
}

export interface GeneratePromptParams {
  prompt: PromptLike;
  topic: string;
  model?: string;
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

export async function generatePromptContent(
  params: GeneratePromptParams,
): Promise<GenerateResult> {
  const { prompt, topic, model = "claude-sonnet-4-6" } = params;
  const content = prompt.content.replace(/\[TEMA\]/g, topic);

  const systemPrompt = [
    prompt.styleRules ? `## Reglas de estilo\n${prompt.styleRules}` : "",
    prompt.knowledgeAreas
      ? `## Áreas de conocimiento\n${prompt.knowledgeAreas}`
      : "",
    prompt.suggestedLength
      ? `## Extensión sugerida\n${prompt.suggestedLength}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await generateCompletion({
    model,
    systemPrompt,
    userPrompt: content,
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
  fragments: { content: string; type: string }[],
  topic: string,
  model = "claude-sonnet-4-6",
): Promise<GenerateResult> {
  const fragmentsText = fragments
    .map((f, i) => `### Fragmento ${i + 1} (${f.type})\n\n${f.content}`)
    .join("\n\n---\n\n");

  const content = assemblyPrompt.content
    .replace(/\[TEMA\]/g, topic)
    .replace(
      /\[PEGAR AQUÍ TODOS LOS FRAGMENTOS DEL CAPÍTULO\]/g,
      fragmentsText,
    );

  const result = await generateCompletion({
    model,
    systemPrompt: assemblyPrompt.styleRules ?? "",
    userPrompt: content,
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

- [ ] **Step 2: Run type check**

```bash
pnpm typecheck
```

Expected: no errors (generate-book.ts still imports old types, but Prompt → PromptLike is compatible).

- [ ] **Step 3: Commit**

```bash
git add lib/generate.ts
git commit -m "refactor: use PromptLike interface in generate.ts for project prompt compatibility"
```

---

### Task 5: Create `generate-chapter` Trigger.dev task

**Files:**
- Create: `trigger/generate-chapter.ts`

- [ ] **Step 1: Write the task**

```typescript
import { task } from "@trigger.dev/sdk";
import { db } from "@/lib/db";
import {
  chapterGenerations,
  projectPrompts,
  fragments,
  projects,
  chapters,
} from "@/lib/db/schema";
import { eq, asc, and, sql, isNull } from "drizzle-orm";
import {
  generatePromptContent,
  generateChapterAssembly,
} from "@/lib/generate";

export const generateChapter = task({
  id: "generate-chapter",
  run: async (payload: { generationId: string; projectId: string }) => {
    const { generationId, projectId } = payload;

    // Load generation
    const [gen] = await db
      .select()
      .from(chapterGenerations)
      .where(eq(chapterGenerations.id, generationId))
      .limit(1);
    if (!gen) throw new Error(`ChapterGeneration ${generationId} not found`);

    // Load project
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project) throw new Error(`Project ${projectId} not found`);

    // Load chapter for position info
    const [chapter] = await db
      .select()
      .from(chapters)
      .where(eq(chapters.id, gen.chapterId))
      .limit(1);
    if (!chapter) throw new Error(`Chapter ${gen.chapterId} not found`);

    // Load project prompts for this chapter
    const promptList = await db
      .select()
      .from(projectPrompts)
      .where(
        and(
          eq(projectPrompts.projectId, projectId),
          eq(projectPrompts.chapterId, gen.chapterId),
        ),
      )
      .orderBy(asc(projectPrompts.position));

    const contentPrompts = promptList.filter(
      (p) => p.type !== "ensamblaje",
    );
    const assemblyPrompt = promptList.find(
      (p) => p.type === "ensamblaje",
    );

    const fragmentContents: { content: string; type: string }[] = [];

    try {
      // Generate each content fragment
      for (const prompt of contentPrompts) {
        const result = await generatePromptContent({
          prompt,
          topic: project.topic,
        });

        const [fragment] = await db
          .insert(fragments)
          .values({
            chapterGenerationId: generationId,
            projectPromptId: prompt.id,
            position: prompt.position,
            content: result.text,
            modelUsed: result.model,
            tokensUsed:
              (result.usage?.inputTokens ?? 0) +
              (result.usage?.outputTokens ?? 0),
            metadata: result.provider
              ? { provider: result.provider }
              : undefined,
          })
          .returning();

        fragmentContents.push({
          content: result.text,
          type: prompt.type,
        });
      }

      // Assemble chapter
      if (assemblyPrompt && fragmentContents.length > 0) {
        const assembled = await generateChapterAssembly(
          assemblyPrompt,
          fragmentContents,
          project.topic,
        );

        await db
          .update(chapterGenerations)
          .set({
            status: "completed",
            assembledContent: assembled.text,
            completedAt: new Date(),
          })
          .where(eq(chapterGenerations.id, generationId));
      } else {
        await db
          .update(chapterGenerations)
          .set({
            status: "completed",
            completedAt: new Date(),
          })
          .where(eq(chapterGenerations.id, generationId));
      }

      // Auto-generate title if all chapters completed and no title set
      const allChapters = await db
        .select()
        .from(chapters)
        .where(eq(chapters.bookTemplateId, project.bookTemplateId))
        .orderBy(asc(chapters.position));

      const completedGens = await db
        .select()
        .from(chapterGenerations)
        .where(
          and(
            eq(chapterGenerations.projectId, projectId),
            eq(chapterGenerations.status, "completed"),
          ),
        );

      if (
        completedGens.length >= allChapters.length &&
        !project.title
      ) {
        const titleResult = await generatePromptContent({
          prompt: {
            content:
              'Genera un título y subtítulo atractivo para un libro sobre [TEMA]. Responde en formato JSON: { "title": "...", "subtitle": "..." }',
            styleRules:
              "Español claro. Título memorable, subtítulo descriptivo.",
            knowledgeAreas: null,
            suggestedLength: null,
          },
          topic: project.topic,
        });

        let title = "";
        let subtitle = "";
        try {
          const parsed = JSON.parse(titleResult.text);
          title = parsed.title;
          subtitle = parsed.subtitle;
        } catch {
          // If JSON parse fails, don't set title
        }

        if (title) {
          await db
            .update(projects)
            .set({ title, subtitle: subtitle || null })
            .where(
              and(
                eq(projects.id, projectId),
                isNull(projects.title),
              ),
            );
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      await db
        .update(chapterGenerations)
        .set({ status: "failed", error: message })
        .where(eq(chapterGenerations.id, generationId));
      throw err;
    }
  },
});
```

- [ ] **Step 2: Run type check**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add trigger/generate-chapter.ts
git commit -m "feat: add generate-chapter Trigger.dev task"
```

---

### Task 6: Create new API routes

**Files:**
- Create: `app/api/projects/[id]/chapters/[chapterId]/generate/route.ts`
- Create: `app/api/projects/[id]/generate-title/route.ts`
- Create: `app/api/projects/[id]/prompts/route.ts`
- Create: `app/api/projects/[id]/prompts/[promptId]/route.ts`
- Create: `app/api/chapter-generations/[id]/route.ts`

- [ ] **Step 1: Create `app/api/projects/[id]/chapters/[chapterId]/generate/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, chapterGenerations } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq } from "drizzle-orm";
import { checkProjectRateLimit, withProjectLock } from "@/lib/api/rate-limit";
import { generateChapter } from "@/trigger/generate-chapter";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; chapterId: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId, chapterId } = await params;

  // Verify project ownership
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Rate limit check
  const rateCheck = await checkProjectRateLimit(projectId);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "rate limited", retryAfter: rateCheck.retryAfter },
      { status: 429 },
    );
  }

  // Create generation with advisory lock
  const lockResult = await withProjectLock(projectId, async () => {
    const [gen] = await db
      .insert(chapterGenerations)
      .values({ projectId, chapterId, status: "generating" })
      .returning();

    await generateChapter.trigger({
      generationId: gen.id,
      projectId,
    });

    return gen;
  });

  if (!lockResult.locked) {
    return NextResponse.json(
      { error: "project is locked" },
      { status: 409 },
    );
  }

  return NextResponse.json(lockResult.result);
}
```

- [ ] **Step 2: Create `app/api/projects/[id]/generate-title/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq } from "drizzle-orm";
import { generatePromptContent } from "@/lib/generate";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId } = await params;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const result = await generatePromptContent({
    prompt: {
      content:
        'Genera un título y subtítulo atractivo para un libro sobre [TEMA]. Responde en formato JSON: { "title": "...", "subtitle": "..." }',
      styleRules:
        "Español claro. Título memorable, subtítulo descriptivo.",
      knowledgeAreas: null,
      suggestedLength: null,
    },
    topic: project.topic,
  });

  let title = "";
  let subtitle = "";
  try {
    const parsed = JSON.parse(result.text);
    title = parsed.title;
    subtitle = parsed.subtitle;
  } catch {
    return NextResponse.json(
      { error: "Failed to parse title from model response" },
      { status: 500 },
    );
  }

  await db
    .update(projects)
    .set({ title, subtitle: subtitle || null })
    .where(eq(projects.id, projectId));

  return NextResponse.json({ title, subtitle });
}
```

- [ ] **Step 3: Create `app/api/projects/[id]/prompts/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, projectPrompts } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, asc } from "drizzle-orm";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId } = await params;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const chapterId = req.nextUrl.searchParams.get("chapterId");

  const promptList = await db
    .select()
    .from(projectPrompts)
    .where(
      chapterId
        ? eq(projectPrompts.chapterId, chapterId)
        : eq(projectPrompts.projectId, projectId),
    )
    .orderBy(asc(projectPrompts.position));

  return NextResponse.json(promptList);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId } = await params;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await req.json();
  const { chapterId, type, title, content, styleRules, knowledgeAreas, suggestedLength } = body;

  if (!chapterId || !type || !title || !content) {
    return NextResponse.json(
      { error: "chapterId, type, title, and content are required" },
      { status: 400 },
    );
  }

  // Get max position for this chapter
  const existing = await db
    .select()
    .from(projectPrompts)
    .where(eq(projectPrompts.chapterId, chapterId))
    .orderBy(asc(projectPrompts.position));
  const maxPos = existing.reduce((max, p) => Math.max(max, p.position), -1);

  const [prompt] = await db
    .insert(projectPrompts)
    .values({
      projectId,
      chapterId,
      type,
      title,
      content,
      styleRules: styleRules ?? null,
      knowledgeAreas: knowledgeAreas ?? null,
      suggestedLength: suggestedLength ?? null,
      position: maxPos + 1,
    })
    .returning();

  return NextResponse.json(prompt);
}
```

- [ ] **Step 4: Create `app/api/projects/[id]/prompts/[promptId]/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, projectPrompts } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, and } from "drizzle-orm";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; promptId: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId, promptId } = await params;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const [existing] = await db
    .select()
    .from(projectPrompts)
    .where(
      and(
        eq(projectPrompts.id, promptId),
        eq(projectPrompts.projectId, projectId),
      ),
    )
    .limit(1);
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await req.json();
  const { content, styleRules, knowledgeAreas, suggestedLength } = body;

  const [updated] = await db
    .update(projectPrompts)
    .set({
      ...(content !== undefined && { content }),
      ...(styleRules !== undefined && { styleRules }),
      ...(knowledgeAreas !== undefined && { knowledgeAreas }),
      ...(suggestedLength !== undefined && { suggestedLength }),
    })
    .where(eq(projectPrompts.id, promptId))
    .returning();

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; promptId: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId, promptId } = await params;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const [existing] = await db
    .select()
    .from(projectPrompts)
    .where(
      and(
        eq(projectPrompts.id, promptId),
        eq(projectPrompts.projectId, projectId),
      ),
    )
    .limit(1);
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await db.delete(projectPrompts).where(eq(projectPrompts.id, promptId));

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Create `app/api/chapter-generations/[id]/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chapterGenerations, fragments, projects } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, asc } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;

  const [gen] = await db
    .select()
    .from(chapterGenerations)
    .where(eq(chapterGenerations.id, id))
    .limit(1);
  if (!gen)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  // Verify via project ownership
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, gen.projectId))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const frags = await db
    .select()
    .from(fragments)
    .where(eq(fragments.chapterGenerationId, id))
    .orderBy(asc(fragments.position));

  return NextResponse.json({ ...gen, fragments: frags });
}
```

- [ ] **Step 6: Run type check**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add app/api/
git commit -m "feat: add chapter generation, prompts, and title API routes"
```

---

### Task 7: Update project API routes

**Files:**
- Modify: `app/api/projects/route.ts`
- Modify: `app/api/projects/[id]/route.ts`

- [ ] **Step 1: Update `POST /api/projects` to copy prompts from template**

Replace the file:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, chapters, prompts, projectPrompts } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, asc, desc } from "drizzle-orm";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const result = await db
    .select()
    .from(projects)
    .where(eq(projects.userId, user.id))
    .orderBy(desc(projects.createdAt));
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, topic, bookTemplateId } = body;

  if (!name || !topic || !bookTemplateId) {
    return NextResponse.json(
      { error: "name, topic, and bookTemplateId are required" },
      { status: 400 },
    );
  }

  const [project] = await db
    .insert(projects)
    .values({ userId: user.id, name, topic, bookTemplateId })
    .returning();

  // Copy template prompts to project_prompts
  const templateChapters = await db
    .select()
    .from(chapters)
    .where(eq(chapters.bookTemplateId, bookTemplateId))
    .orderBy(asc(chapters.position));

  for (const chapter of templateChapters) {
    const templatePrompts = await db
      .select()
      .from(prompts)
      .where(eq(prompts.chapterId, chapter.id))
      .orderBy(asc(prompts.position));

    if (templatePrompts.length > 0) {
      await db.insert(projectPrompts).values(
        templatePrompts.map((p) => ({
          projectId: project.id,
          chapterId: chapter.id,
          position: p.position,
          type: p.type,
          title: p.title,
          content: p.content,
          styleRules: p.styleRules,
          knowledgeAreas: p.knowledgeAreas,
          suggestedLength: p.suggestedLength,
        })),
      );
    }
  }

  return NextResponse.json(project);
}
```

- [ ] **Step 2: Update `GET /api/projects/[id]` to return chapters with generations**

Replace the file:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, chapters, chapterGenerations } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, asc, desc, and } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Load template chapters
  const chapterList = await db
    .select()
    .from(chapters)
    .where(eq(chapters.bookTemplateId, project.bookTemplateId))
    .orderBy(asc(chapters.position));

  // Load latest generation per chapter (scoped to this project)
  const chaptersWithGenerations = await Promise.all(
    chapterList.map(async (ch) => {
      const [latestGen] = await db
        .select()
        .from(chapterGenerations)
        .where(
          and(
            eq(chapterGenerations.projectId, project.id),
            eq(chapterGenerations.chapterId, ch.id),
          ),
        )
        .orderBy(desc(chapterGenerations.createdAt))
        .limit(1);

      return {
        id: ch.id,
        position: ch.position,
        title: ch.title,
        latestGeneration: latestGen ?? null,
      };
    }),
  );

  return NextResponse.json({
    ...project,
    chapters: chaptersWithGenerations,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await req.json();
  const { title, subtitle, topic } = body;

  const [updated] = await db
    .update(projects)
    .set({
      ...(title !== undefined && { title }),
      ...(subtitle !== undefined && { subtitle }),
      ...(topic !== undefined && { topic }),
    })
    .where(eq(projects.id, id))
    .returning();

  return NextResponse.json(updated);
}
```

- [ ] **Step 3: Run type check**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/projects/
git commit -m "feat: update project API routes for chapter-based generation"
```

---

### Task 8: Create new UI — Project Page

**Files:**
- Modify: `app/projects/[id]/page.tsx`
- Modify: `app/projects/page.tsx`
- Modify: `components/patterns/project-card.tsx`
- Create: `components/projects/generate-chapter-button.tsx`

- [ ] **Step 1: Create `components/projects/generate-chapter-button.tsx`**

```typescript
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, Play, RotateCcw } from "lucide-react";

export function GenerateChapterButton({
  projectId,
  chapterId,
  hasGeneration,
}: {
  projectId: string;
  chapterId: string;
  hasGeneration: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleGenerate() {
    setLoading(true);
    const res = await fetch(
      `/api/projects/${projectId}/chapters/${chapterId}/generate`,
      { method: "POST" },
    );
    if (res.ok) {
      router.refresh();
    } else {
      const data = await res.json();
      alert(data.error ?? "Error generating chapter");
    }
    setLoading(false);
  }

  return (
    <Button
      onClick={handleGenerate}
      disabled={loading}
      variant={hasGeneration ? "outline" : "default"}
      size="sm"
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin mr-1" />
      ) : hasGeneration ? (
        <RotateCcw className="h-4 w-4 mr-1" />
      ) : (
        <Play className="h-4 w-4 mr-1" />
      )}
      {hasGeneration ? "Regenerar" : "Generar"}
    </Button>
  );
}
```

- [ ] **Step 2: Rewrite `app/projects/[id]/page.tsx`**

```typescript
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { GenerateChapterButton } from "@/components/projects/generate-chapter-button";
import { Loader2, Pencil, Check, X, BookOpen } from "lucide-react";

interface GenerationData {
  id: string;
  status: string;
  assembledContent: string | null;
  error: string | null;
  createdAt: string;
}

interface ChapterData {
  id: string;
  position: number;
  title: string;
  latestGeneration: GenerationData | null;
}

interface ProjectData {
  id: string;
  name: string;
  topic: string;
  title: string | null;
  subtitle: string | null;
  chapters: ChapterData[];
}

function statusBadge(status: string) {
  switch (status) {
    case "completed":
      return (
        <Badge className="bg-success/10 text-success border-success/20">
          Completado
        </Badge>
      );
    case "generating":
      return (
        <Badge className="bg-info/10 text-info border-info/20">
          Generando
        </Badge>
      );
    case "failed":
      return <Badge variant="destructive">Fallido</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

export default function ProjectPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<ProjectData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingSubtitle, setEditingSubtitle] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editSubtitle, setEditSubtitle] = useState("");

  async function fetchProject() {
    try {
      const res = await fetch(`/api/projects/${params.id}`);
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const data = await res.json();
      setProject(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchProject();
  }, [params.id]);

  // Poll if any chapter is generating
  useEffect(() => {
    if (!project) return;
    const hasGenerating = project.chapters.some(
      (ch) => ch.latestGeneration?.status === "generating",
    );
    if (!hasGenerating) return;

    const interval = setInterval(fetchProject, 3000);
    return () => clearInterval(interval);
  }, [project]);

  async function saveTitle() {
    if (!project) return;
    await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: editTitle }),
    });
    setProject({ ...project, title: editTitle });
    setEditingTitle(false);
  }

  async function saveSubtitle() {
    if (!project) return;
    await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subtitle: editSubtitle }),
    });
    setProject({ ...project, subtitle: editSubtitle });
    setEditingSubtitle(false);
  }

  if (loading)
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );

  if (error || !project) {
    return (
      <div className="max-w-4xl mx-auto p-6 text-center py-20">
        <p className="text-destructive mb-4">{error ?? "Project not found"}</p>
        <Link href="/projects" className="text-sm text-primary hover:underline">
          Back to projects
        </Link>
      </div>
    );
  }

  const completedCount = project.chapters.filter(
    (ch) => ch.latestGeneration?.status === "completed",
  ).length;

  return (
    <div className="max-w-4xl mx-auto p-6">
      <Breadcrumbs
        items={[
          { label: "Projects", href: "/projects" },
          { label: project.name },
        ]}
      />

      {/* Title section */}
      <div className="mt-4 mb-6">
        {editingTitle ? (
          <div className="flex items-center gap-2 mb-1">
            <Input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="text-2xl font-bold h-auto py-1"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") saveTitle();
                if (e.key === "Escape") setEditingTitle(false);
              }}
            />
            <Button size="icon" variant="ghost" onClick={saveTitle}>
              <Check className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setEditingTitle(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">
              {project.title ?? project.name}
            </h1>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                setEditTitle(project.title ?? "");
                setEditingTitle(true);
              }}
            >
              <Pencil className="h-4 w-4 text-muted-foreground" />
            </Button>
          </div>
        )}

        {editingSubtitle ? (
          <div className="flex items-center gap-2 mt-1">
            <Input
              value={editSubtitle}
              onChange={(e) => setEditSubtitle(e.target.value)}
              className="text-muted-foreground h-auto py-1"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") saveSubtitle();
                if (e.key === "Escape") setEditingSubtitle(false);
              }}
            />
            <Button size="icon" variant="ghost" onClick={saveSubtitle}>
              <Check className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setEditingSubtitle(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {project.subtitle && (
              <p className="text-muted-foreground">{project.subtitle}</p>
            )}
            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                setEditSubtitle(project.subtitle ?? "");
                setEditingSubtitle(true);
              }}
            >
              <Pencil className="h-3 w-3 text-muted-foreground" />
            </Button>
          </div>
        )}
      </div>

      {/* Progress */}
      <div className="flex items-center gap-2 mb-6 text-sm text-muted-foreground">
        <BookOpen className="h-4 w-4" />
        <span>
          {completedCount}/{project.chapters.length} capítulos completados
        </span>
      </div>

      {/* Chapters */}
      <div className="space-y-4">
        {project.chapters.map((ch) => (
          <Card key={ch.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <CardTitle className="text-base">
                    Capítulo {ch.position + 1}: {ch.title}
                  </CardTitle>
                  {ch.latestGeneration &&
                    statusBadge(ch.latestGeneration.status)}
                </div>
                <div className="flex items-center gap-2">
                  <GenerateChapterButton
                    projectId={project.id}
                    chapterId={ch.id}
                    hasGeneration={ch.latestGeneration !== null}
                  />
                  <Link
                    href={`/projects/${project.id}/chapters/${ch.id}/prompts`}
                  >
                    <Button variant="ghost" size="icon">
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              </div>
            </CardHeader>
            {ch.latestGeneration?.assembledContent && (
              <CardContent>
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown>
                    {ch.latestGeneration.assembledContent}
                  </ReactMarkdown>
                </div>
              </CardContent>
            )}
            {ch.latestGeneration?.status === "generating" && (
              <CardContent>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generando fragmentos...
                </div>
              </CardContent>
            )}
            {ch.latestGeneration?.status === "failed" && (
              <CardContent>
                <p className="text-sm text-destructive">
                  {ch.latestGeneration.error ?? "Error desconocido"}
                </p>
              </CardContent>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update `app/projects/page.tsx` — remove run counts**

```typescript
import { db } from "@/lib/db";
import { projects, bookTemplates } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, desc } from "drizzle-orm";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { ProjectCard } from "@/components/patterns/project-card";
import { BookOpen } from "lucide-react";

export default async function ProjectsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const userProjects = user
    ? await db
        .select()
        .from(projects)
        .where(eq(projects.userId, user.id))
        .orderBy(desc(projects.createdAt))
    : [];

  const templates = await db.select().from(bookTemplates);

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Proyectos</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Create and manage your book generation projects
          </p>
        </div>
        <CreateProjectDialog templates={templates} />
      </div>

      {userProjects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <BookOpen className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <h2 className="text-lg font-medium mb-1">No projects yet</h2>
          <p className="text-sm text-muted-foreground max-w-sm">
            Create your first project to start generating AI-powered books in
            Spanish.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {userProjects.map((p, i) => (
            <ProjectCard key={p.id} project={p} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Update `components/patterns/project-card.tsx` — remove runCount**

```typescript
"use client";

import Link from "next/link";
import { motion } from "motion/react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { BookOpen, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

export function ProjectCard({
  project,
  index,
}: {
  project: {
    id: string;
    name: string;
    topic: string;
    title: string | null;
    createdAt: Date;
  };
  index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        delay: index * 0.05,
        duration: 0.25,
        ease: [0.16, 1, 0.3, 1],
      }}
    >
      <Link href={`/projects/${project.id}`}>
        <Card className="hover:border-brand-200 dark:hover:border-brand-800 hover:shadow-sm transition-all duration-200 group">
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="group-hover:text-primary transition-colors">
                {project.title ?? project.name}
              </CardTitle>
              <BookOpen className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
            </div>
            <CardDescription className="line-clamp-2">
              {project.topic}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDistanceToNow(project.createdAt, {
                addSuffix: true,
                locale: es,
              })}
            </span>
          </CardContent>
        </Card>
      </Link>
    </motion.div>
  );
}
```

- [ ] **Step 5: Run type check**

```bash
pnpm typecheck
```

Expected: no errors on new code (old files will error due to `runs` imports — handled in cleanup task).

- [ ] **Step 6: Commit**

```bash
git add app/projects/ components/projects/ components/patterns/
git commit -m "feat: new project page with per-chapter generation and inline title editing"
```

---

### Task 9: Create prompt editor page

**Files:**
- Create: `app/projects/[id]/chapters/[chapterId]/prompts/page.tsx`

- [ ] **Step 1: Write the prompt editor page**

```typescript
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Loader2, Plus, Trash2, Save } from "lucide-react";

interface ProjectPrompt {
  id: string;
  chapterId: string;
  position: number;
  type: string;
  title: string;
  content: string;
  styleRules: string | null;
  knowledgeAreas: string | null;
  suggestedLength: string | null;
}

const PROMPT_TYPE_LABELS: Record<string, string> = {
  apertura: "Apertura",
  modelo: "Modelo",
  contraste: "Contraste",
  amplificacion: "Amplificación",
  anecdota: "Anécdota",
  acumulacion: "Acumulación",
  proceso: "Proceso",
  cierre: "Cierre",
  ensamblaje: "Ensamblaje",
};

export default function PromptsPage() {
  const params = useParams<{ id: string; chapterId: string }>();
  const router = useRouter();
  const [prompts, setPrompts] = useState<ProjectPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [showNew, setShowNew] = useState(false);
  const [newPrompt, setNewPrompt] = useState({
    type: "apertura",
    title: "",
    content: "",
  });

  useEffect(() => {
    fetchPrompts();
  }, [params.id, params.chapterId]);

  async function fetchPrompts() {
    try {
      const res = await fetch(
        `/api/projects/${params.id}/prompts?chapterId=${params.chapterId}`,
      );
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      setPrompts(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  async function savePrompt(promptId: string, field: string, value: string) {
    setSaving((s) => ({ ...s, [promptId]: true }));
    await fetch(`/api/projects/${params.id}/prompts/${promptId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    setSaving((s) => ({ ...s, [promptId]: false }));
  }

  async function addPrompt() {
    const res = await fetch(`/api/projects/${params.id}/prompts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...newPrompt, chapterId: params.chapterId }),
    });
    if (res.ok) {
      setShowNew(false);
      setNewPrompt({ type: "apertura", title: "", content: "" });
      fetchPrompts();
    }
  }

  async function deletePrompt(promptId: string) {
    await fetch(`/api/projects/${params.id}/prompts/${promptId}`, {
      method: "DELETE",
    });
    fetchPrompts();
  }

  if (loading)
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );

  if (error) {
    return (
      <div className="max-w-4xl mx-auto p-6 text-center py-20">
        <p className="text-destructive">{error}</p>
        <Link
          href={`/projects/${params.id}`}
          className="text-sm text-primary hover:underline"
        >
          Back to project
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <Breadcrumbs
        items={[
          { label: "Projects", href: "/projects" },
          { label: "Project", href: `/projects/${params.id}` },
          { label: "Prompts" },
        ]}
      />

      <div className="flex items-center justify-between mt-4 mb-6">
        <h1 className="text-xl font-bold">Prompts del Capítulo</h1>
        <Button onClick={() => setShowNew(true)} disabled={showNew}>
          <Plus className="h-4 w-4 mr-1" /> Añadir Prompt
        </Button>
      </div>

      {showNew && (
        <Card className="mb-4 border-brand-200">
          <CardContent className="pt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Tipo</Label>
                <Select
                  value={newPrompt.type}
                  onValueChange={(v) =>
                    setNewPrompt((p) => ({ ...p, type: v }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PROMPT_TYPE_LABELS).map(([key, label]) => (
                      <SelectItem key={key} value={key}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Título</Label>
                <Input
                  value={newPrompt.title}
                  onChange={(e) =>
                    setNewPrompt((p) => ({ ...p, title: e.target.value }))
                  }
                />
              </div>
            </div>
            <div>
              <Label>Contenido</Label>
              <Textarea
                value={newPrompt.content}
                onChange={(e) =>
                  setNewPrompt((p) => ({ ...p, content: e.target.value }))
                }
                rows={4}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={addPrompt}>Guardar</Button>
              <Button variant="ghost" onClick={() => setShowNew(false)}>
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {prompts.map((prompt) => (
          <Card key={prompt.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">
                  <span className="text-muted-foreground">
                    {prompt.position + 1}.
                  </span>{" "}
                  {PROMPT_TYPE_LABELS[prompt.type] ?? prompt.type}:{" "}
                  {prompt.title}
                </CardTitle>
                <div className="flex items-center gap-1">
                  {saving[prompt.id] && (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => deletePrompt(prompt.id)}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground">
                  Contenido
                </Label>
                <Textarea
                  defaultValue={prompt.content}
                  onBlur={(e) => {
                    if (e.target.value !== prompt.content)
                      savePrompt(prompt.id, "content", e.target.value);
                  }}
                  rows={3}
                  className="text-sm"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">
                  Reglas de Estilo
                </Label>
                <Textarea
                  defaultValue={prompt.styleRules ?? ""}
                  onBlur={(e) => {
                    if (e.target.value !== (prompt.styleRules ?? ""))
                      savePrompt(prompt.id, "styleRules", e.target.value);
                  }}
                  rows={2}
                  className="text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">
                    Áreas de Conocimiento
                  </Label>
                  <Input
                    defaultValue={prompt.knowledgeAreas ?? ""}
                    onBlur={(e) => {
                      if (e.target.value !== (prompt.knowledgeAreas ?? ""))
                        savePrompt(prompt.id, "knowledgeAreas", e.target.value);
                    }}
                    className="text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">
                    Extensión Sugerida
                  </Label>
                  <Input
                    defaultValue={prompt.suggestedLength ?? ""}
                    onBlur={(e) => {
                      if (e.target.value !== (prompt.suggestedLength ?? ""))
                        savePrompt(
                          prompt.id,
                          "suggestedLength",
                          e.target.value,
                        );
                    }}
                    className="text-sm"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run type check**

```bash
pnpm typecheck
```

Expected: no errors in new file.

- [ ] **Step 3: Commit**

```bash
git add app/projects/
git commit -m "feat: add prompt editor page for per-project prompt customization"
```

---

### Task 10: Remove old files and clean up

**Files:**
- Delete: `lib/db/schema/runs.ts`
- Delete: `lib/db/schema/chapter-runs.ts`
- Delete: `trigger/generate-book.ts`
- Delete: `app/api/projects/[id]/generate/route.ts`
- Delete: `app/api/runs/[id]/route.ts`
- Delete: `app/projects/[id]/runs/[runId]/page.tsx`
- Delete: `components/projects/generate-button.tsx`
- Modify: `lib/db/schema/index.ts`
- Modify: `lib/db/schema/fragments.ts`

- [ ] **Step 1: Delete old files**

```bash
rm lib/db/schema/runs.ts
rm lib/db/schema/chapter-runs.ts
rm trigger/generate-book.ts
rm app/api/projects/\[id\]/generate/route.ts
rm app/api/runs/\[id\]/route.ts
rm app/projects/\[id\]/runs/\[runId\]/page.tsx
rm components/projects/generate-button.tsx
```

- [ ] **Step 2: Update `lib/db/schema/index.ts`**

```typescript
export * from "./book-templates";
export * from "./chapters";
export * from "./prompts";
export * from "./project-prompts";
export * from "./projects";
export * from "./chapter-generations";
export * from "./fragments";
```

- [ ] **Step 3: Update `lib/db/schema/fragments.ts` — remove old FK columns, make new ones NOT NULL**

```typescript
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { chapterGenerations } from "./chapter-generations";
import { projectPrompts } from "./project-prompts";

export const fragments = pgTable(
  "fragments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chapterGenerationId: uuid("chapter_generation_id")
      .notNull()
      .references(() => chapterGenerations.id, { onDelete: "cascade" }),
    projectPromptId: uuid("project_prompt_id")
      .notNull()
      .references(() => projectPrompts.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    content: text("content"),
    metadata: jsonb("metadata"),
    modelUsed: text("model_used"),
    tokensUsed: integer("tokens_used"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_fragments_chapter_generation").on(table.chapterGenerationId),
  ],
);

export type Fragment = typeof fragments.$inferSelect;
export type NewFragment = typeof fragments.$inferInsert;
```

- [ ] **Step 4: Run type check**

```bash
pnpm typecheck
```

Expected: no errors (all references to old tables removed).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove run-based system (runs, chapter_runs, generate-book)"
```

---

### Task 11: Write cleanup migration for old columns/tables

**Files:**
- Create: `supabase/migrations/YYYYMMDDHHMMSS_cleanup_old_tables.sql`

- [ ] **Step 1: Generate filename and write SQL**

```bash
echo "supabase/migrations/$(date +%Y%m%d%H%M%S)_cleanup_old_tables.sql"
```

```sql
-- Drop old FK columns from fragments (after data is migrated / old system is gone)
ALTER TABLE fragments DROP COLUMN IF EXISTS chapter_run_id;
ALTER TABLE fragments DROP COLUMN IF EXISTS prompt_id;

-- Make new columns NOT NULL (only if all data backfilled)
ALTER TABLE fragments ALTER COLUMN chapter_generation_id SET NOT NULL;
ALTER TABLE fragments ALTER COLUMN project_prompt_id SET NOT NULL;

-- Drop old index
DROP INDEX IF EXISTS idx_fragments_chapter_run;

-- Drop old tables
DROP TABLE IF EXISTS chapter_runs CASCADE;
DROP TABLE IF EXISTS runs CASCADE;

-- Drop old enum
DROP TYPE IF EXISTS chapter_run_status;
DROP TYPE IF EXISTS run_status;
```

- [ ] **Step 2: Apply migration**

```bash
pnpm db:migrate
```

- [ ] **Step 3: Verify DB state**

Run `pnpm db:studio` and check:
- `runs`, `chapter_runs` tables gone
- `project_prompts`, `chapter_generations` present
- `fragments` has `chapter_generation_id` and `project_prompt_id` as NOT NULL
- Old FK columns gone

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/
git commit -m "feat: add migration to drop old run-based tables and clean up fragments"
```

---

### Task 12: Update seed script

**Files:**
- Modify: `scripts/seed.ts`

- [ ] **Step 1: No changes needed for core seed**

The seed creates `book_templates`, `chapters`, and `prompts` — all unchanged. Projects and project_prompts are created at project creation time. The seed is fine as-is.

- [ ] **Step 2: Verify seed still works**

```bash
pnpm db:seed
```

Expected: "Seed data inserted" with book template ID.

- [ ] **Step 3: Commit** (only if changes were needed — skip otherwise)

---

### Task 13: Final verification

- [ ] **Step 1: Run full type check**

```bash
pnpm typecheck
```

Expected: zero errors.

- [ ] **Step 2: Run lint**

```bash
pnpm lint
```

Expected: zero errors (or only pre-existing).

- [ ] **Step 3: Run tests**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 4: Run dev server and smoke test**

```bash
pnpm dev
```

Manual checks:
1. Navigate to `/projects` — list loads, no errors
2. Create a new project — redirects to project page, prompts copied
3. Project page shows chapters with "Generar" button
4. Click "Generar" on a chapter — status changes, fragments appear
5. Navigate to prompts page — prompts listed, editable
6. Edit a prompt — saves on blur
7. Add a new prompt — appears in list
8. Delete a prompt — removed from list
9. Regenerate a chapter — new generation created
10. Edit title inline — saves on Enter

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: final verification fixes"
```
