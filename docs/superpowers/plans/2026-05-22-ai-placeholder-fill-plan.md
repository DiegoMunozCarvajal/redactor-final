# AI-Powered Placeholder Filling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-fill chapter placeholder definitions using an LLM with web search (Exa/Tavily + Semantic Scholar), with two-phase research→streaming architecture, per-placeholder regenerate, and configurable AI prompts per chapter.

**Architecture:** New tables (`chapter_briefs`, `chapter_config_prompts`, `projects.description`). New module `lib/ai/web-search.ts` wraps Exa + Tavily. New module `lib/ai/placeholder-fill.ts` implements two-phase fill: Phase 1 (cheap model decides searches, executes them), Phase 2 (user-selected model streams placeholder definitions via SSE). UI extracts: `PlaceholderFillSection` component replaces inline placeholder section in project chapter page. `ChapterBriefSection` added. Admin: AI Configuration section in template chapter editor. Project settings: description field with generate button.

**Tech Stack:** Next.js 15, Drizzle ORM, React, TypeScript, Server-Sent Events, Exa API, Tavily API, Semantic Scholar API

---

### File Structure

| File | Responsibility |
|------|---------------|
| `lib/db/schema/chapter-briefs.ts` | Schema for per-chapter briefs |
| `lib/db/schema/chapter-config-prompts.ts` | Schema for per-chapter AI config prompts |
| `lib/ai/web-search.ts` | Exa + Tavily web search wrapper |
| `lib/ai/placeholder-fill.ts` | Two-phase fill: research + streaming generation |
| `app/api/projects/[id]/chapters/[chapterId]/placeholders/fill/route.ts` | SSE endpoint for fill all |
| `app/api/projects/[id]/chapters/[chapterId]/placeholders/[name]/fill/route.ts` | Single placeholder fill/regenerate |
| `app/api/projects/[id]/chapters/[chapterId]/brief/route.ts` | GET/PATCH chapter brief |
| `app/api/projects/[id]/chapters/[chapterId]/brief/generate/route.ts` | LLM generate brief |
| `app/api/projects/[id]/description/route.ts` | PATCH project description |
| `app/api/chapters/[id]/config-prompts/route.ts` | GET/PUT config prompts (admin) |
| `components/projects/placeholder-fill-section.tsx` | Placeholder fill UI (streaming, sources, regenerate) |
| `components/projects/chapter-brief-section.tsx` | Brief section UI |
| `app/projects/[id]/chapters/[chapterId]/page.tsx` | Integrate new components |
| `app/projects/[id]/page.tsx` | Add description field |
| `app/templates/[id]/chapters/[chapterId]/page.tsx` | Add AI Configuration section |
| `lib/db/schema/projects.ts` | Add description column |
| `lib/db/schema/index.ts` | Export new schemas |
| `supabase/migrations/` | New migration |

---

### Task 1: Schema — chapter_briefs + chapter_config_prompts + projects.description

**Files:**
- Create: `lib/db/schema/chapter-briefs.ts`
- Create: `lib/db/schema/chapter-config-prompts.ts`
- Modify: `lib/db/schema/projects.ts`
- Modify: `lib/db/schema/index.ts`
- Create: `supabase/migrations/20260522200000_ai_placeholder_fill.sql`

- [ ] **Step 1: Create chapter-briefs schema**

```typescript
// lib/db/schema/chapter-briefs.ts
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { chapters } from "./chapters";

export const chapterBriefs = pgTable("chapter_briefs", {
  id: uuid("id").primaryKey().defaultRandom(),
  chapterId: uuid("chapter_id")
    .notNull()
    .references(() => chapters.id, { onDelete: "cascade" })
    .unique(),
  content: text("content"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ChapterBrief = typeof chapterBriefs.$inferSelect;
export type NewChapterBrief = typeof chapterBriefs.$inferInsert;
```

- [ ] **Step 2: Create chapter-config-prompts schema**

```typescript
// lib/db/schema/chapter-config-prompts.ts
import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { chapters } from "./chapters";

export const chapterConfigPrompts = pgTable(
  "chapter_config_prompts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // 'fill_placeholders' | 'generate_brief'
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("idx_config_prompts_unique").on(table.chapterId, table.type)],
);

export type ChapterConfigPrompt = typeof chapterConfigPrompts.$inferSelect;
export type NewChapterConfigPrompt = typeof chapterConfigPrompts.$inferInsert;
```

- [ ] **Step 3: Add description to projects schema**

In `lib/db/schema/projects.ts`, add after `subtitle`:
```typescript
description: text("description"),
```

- [ ] **Step 4: Export from index**

Add to `lib/db/schema/index.ts`:
```typescript
export * from "./chapter-briefs";
export * from "./chapter-config-prompts";
```

- [ ] **Step 5: Write SQL migration**

```sql
-- supabase/migrations/20260522200000_ai_placeholder_fill.sql

-- Add project description
ALTER TABLE projects ADD COLUMN IF NOT EXISTS description text;

-- Create chapter_briefs
CREATE TABLE IF NOT EXISTS chapter_briefs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id uuid NOT NULL UNIQUE REFERENCES chapters(id) ON DELETE CASCADE,
  content    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Create chapter_config_prompts
CREATE TABLE IF NOT EXISTS chapter_config_prompts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id uuid NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  type       text NOT NULL,
  content    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_config_prompts_unique
  ON chapter_config_prompts (chapter_id, type);
```

- [ ] **Step 6: Run migration and typecheck**

```bash
pnpm db:migrate
pnpm typecheck
```

Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add lib/db/schema/chapter-briefs.ts lib/db/schema/chapter-config-prompts.ts lib/db/schema/projects.ts lib/db/schema/index.ts supabase/migrations/20260522200000_ai_placeholder_fill.sql
git commit -m "feat: add chapter_briefs, chapter_config_prompts, and projects.description schemas"
```

---

### Task 2: Web Search Module

**Files:**
- Create: `lib/ai/web-search.ts`

- [ ] **Step 1: Create the web search module**

```typescript
// lib/ai/web-search.ts

const EXA_API_URL = "https://api.exa.ai/search";
const TAVILY_API_URL = "https://api.tavily.com/search";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  provider: "exa" | "tavily" | "semantic-scholar";
  publishedDate?: string;
}

async function searchExa(query: string): Promise<SearchResult[]> {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) throw new Error("EXA_API_KEY not set");

  const res = await fetch(EXA_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      query,
      numResults: 3,
      contents: { text: true },
    }),
  });

  if (!res.ok) throw new Error(`Exa search failed: ${res.status}`);
  const data = await res.json();
  return (data.results ?? []).map((r: any) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: (r.text ?? "").slice(0, 300),
    provider: "exa" as const,
    publishedDate: r.publishedDate,
  }));
}

async function searchTavily(query: string): Promise<SearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY not set");

  const res = await fetch(TAVILY_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "basic",
      max_results: 3,
    }),
  });

  if (!res.ok) throw new Error(`Tavily search failed: ${res.status}`);
  const data = await res.json();
  return (data.results ?? []).map((r: any) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: (r.content ?? "").slice(0, 300),
    provider: "tavily" as const,
    publishedDate: r.published_date,
  }));
}

async function searchSemanticScholar(query: string): Promise<SearchResult[]> {
  const apiKey = process.env.SEMANTIC_SCHOLAR_API_KEY;
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=3&fields=title,url,abstract,publicationDate`;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;

  const res = await fetch(url, { headers });
  if (!res.ok) return [];

  const data = await res.json();
  return (data.data ?? []).map((r: any) => ({
    title: r.title ?? "",
    url: r.url ?? `https://api.semanticscholar.org/CorpusID:${r.paperId}`,
    snippet: (r.abstract ?? "").slice(0, 300),
    provider: "semantic-scholar" as const,
    publishedDate: r.publicationDate,
  }));
}

/**
 * Search the web via Exa (primary), falling back to Tavily, with Semantic Scholar for academic queries.
 */
export async function webSearch(query: string): Promise<SearchResult[]> {
  const results: SearchResult[] = [];

  // Exa first (primary)
  try {
    const exaResults = await searchExa(query);
    results.push(...exaResults);
  } catch (err) {
    console.warn("[web-search] Exa failed, falling back to Tavily:", (err as Error).message);
    try {
      const tavilyResults = await searchTavily(query);
      results.push(...tavilyResults);
    } catch (err2) {
      console.warn("[web-search] Tavily also failed:", (err2 as Error).message);
    }
  }

  // Semantic Scholar always (for academic queries)
  try {
    const ssResults = await searchSemanticScholar(query);
    results.push(...ssResults);
  } catch {
    // non-critical
  }

  return results;
}

/**
 * Search multiple queries in parallel and return deduplicated results.
 */
export async function webSearchBatch(queries: string[]): Promise<Record<string, SearchResult[]>> {
  const results: Record<string, SearchResult[]> = {};
  const settled = await Promise.allSettled(queries.map((q) => webSearch(q)));
  for (let i = 0; i < queries.length; i++) {
    const result = settled[i];
    results[queries[i]] = result.status === "fulfilled" ? result.value : [];
  }
  return results;
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add lib/ai/web-search.ts
git commit -m "feat: add web search module with Exa/Tavily/Semantic Scholar"
```

---

### Task 3: Placeholder Fill Logic

**Files:**
- Create: `lib/ai/placeholder-fill.ts`

This module implements the two-phase fill: research decision → search execution → streaming generation.

- [ ] **Step 1: Create placeholder-fill.ts**

```typescript
// lib/ai/placeholder-fill.ts
import { generateCompletion } from "@/lib/ai/completion";
import { webSearchBatch } from "@/lib/ai/web-search";
import { DEFAULT_GENERATION_MODEL } from "@/lib/ai/providers";

export interface PlaceholderFillEvent {
  type: "placeholder" | "done" | "error";
  name?: string;
  definition?: string;
  sources?: SearchResult[];
  error?: string;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  provider: "exa" | "tavily" | "semantic-scholar";
}

const RESEARCH_DECISION_PROMPT = `You are a research planner. Given:
1. A project description
2. A chapter brief
3. A list of placeholder names

For each placeholder, decide whether it needs web research to fill accurately.
Return a JSON array of placeholder names that need research. Only include ones where factual accuracy matters (e.g., sources, papers, studies, historical facts, data points). Skip ones that are purely stylistic (e.g., tone, audience description, voice).

Example:
Placeholders: ["TEMA_DEL_LIBRO", "TONO_DEL_LIBRO", "FUENTE_O_PAPER_BASE", "LECTOR_OBJETIVO"]
Return: ["TEMA_DEL_LIBRO", "FUENTE_O_PAPER_BASE"]`;

const FILL_SYSTEM_PROMPT = `You are an expert book researcher and ghostwriter. Your task is to define placeholder values for a book chapter.

## Input
- Project description: what the book is about
- Chapter brief: what this specific chapter covers
- Placeholder names: the {placeholders} that need definitions
- Research results: web search findings for factual placeholders (if any)

## Instructions
1. Define each placeholder with a concise, research-backed value
2. Use the research results when available for factual placeholders
3. Each definition should be 1-3 sentences, specific and actionable
4. Align with the chapter brief and project description
5. Output ONLY valid JSON: {"placeholders": {"NAME": "definition", ...}}

## Example
Input placeholders: ["TEMA_DEL_LIBRO", "TONO_DEL_LIBRO"]
Output: {"placeholders": {"TEMA_DEL_LIBRO": "Atomic habits and behavior change through systems thinking", "TONO_DEL_LIBRO": "Practical, authoritative but warm, backed by research"}}`;

// Cheap model for research decisions
const RESEARCH_MODEL = "deepseek-v4-flash";

async function extractJson(text: string): Promise<any> {
  // Try direct parse first
  try { return JSON.parse(text); } catch {}
  // Try to extract from markdown code block
  const match = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (match) {
    try { return JSON.parse(match[1]); } catch {}
  }
  // Try to find JSON object
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch {}
  }
  throw new Error("Could not parse JSON from response");
}

export async function researchPlaceholders(
  placeholderNames: string[],
  chapterBrief: string,
  projectDescription: string,
): Promise<Record<string, SearchResult[]>> {
  if (placeholderNames.length === 0) return {};

  // Phase 1a: Decide which placeholders need research
  const decisionPrompt = `${RESEARCH_DECISION_PROMPT}\n\nProject: ${projectDescription || "(none)"}\nChapter brief: ${chapterBrief || "(none)"}\nPlaceholders: ${JSON.stringify(placeholderNames)}`;

  const decision = await generateCompletion({
    model: RESEARCH_MODEL,
    systemPrompt: "",
    userPrompt: decisionPrompt,
  });

  let needsResearch: string[] = [];
  try {
    const parsed = await extractJson(decision.data as string);
    needsResearch = Array.isArray(parsed) ? parsed : (parsed.needsResearch ?? []);
  } catch {
    // If parsing fails, research all
    needsResearch = placeholderNames;
  }

  // Phase 1b: Execute searches
  if (needsResearch.length === 0) return {};

  const searchQueries = needsResearch.map((name) => {
    const readable = name.replace(/_/g, " ").toLowerCase();
    return `${readable} ${projectDescription || ""} ${chapterBrief || ""}`.trim();
  });

  return webSearchBatch(searchQueries);
}

export async function* fillPlaceholders(
  placeholderNames: string[],
  chapterBrief: string,
  projectDescription: string,
  promptContents: string[],
  searchResults: Record<string, SearchResult[]>,
  model: string = DEFAULT_GENERATION_MODEL,
  customSystemPrompt?: string,
): AsyncGenerator<PlaceholderFillEvent> {
  const systemPrompt = customSystemPrompt || FILL_SYSTEM_PROMPT;

  // Build the research context
  let researchContext = "";
  if (Object.keys(searchResults).length > 0) {
    researchContext = "\n\n## Research Results\n";
    for (const [query, results] of Object.entries(searchResults)) {
      if (results.length === 0) continue;
      researchContext += `\n### Query: ${query}\n`;
      for (const r of results) {
        researchContext += `- ${r.title}\n  ${r.snippet}\n  URL: ${r.url}\n`;
      }
    }
  }

  const userPrompt = `## Project Description\n${projectDescription || "(none)"}

## Chapter Brief
${chapterBrief || "(none)"}

## Content Prompts (for context)
${promptContents.map((c, i) => `Prompt ${i + 1}: ${c.slice(0, 200)}${c.length > 200 ? "..." : ""}`).join("\n\n")}

${researchContext}

## Placeholders to Define
${JSON.stringify(placeholderNames)}

Define each placeholder. Return JSON: {"placeholders": {"NAME": "definition", ...}}`;

  const result = await generateCompletion({
    model,
    systemPrompt,
    userPrompt,
    effort: "max",
  });

  try {
    const parsed = await extractJson(result.data as string);
    const definitions: Record<string, string> = parsed.placeholders ?? parsed;

    for (const name of placeholderNames) {
      const definition = definitions[name];
      if (definition) {
        // Build sources map for this placeholder
        const placeholderSources: SearchResult[] = [];
        for (const [query, results] of Object.entries(searchResults)) {
          if (query.toLowerCase().includes(name.replace(/_/g, " ").toLowerCase())) {
            placeholderSources.push(...results);
          }
        }

        yield {
          type: "placeholder",
          name,
          definition,
          sources: placeholderSources.slice(0, 5),
        };
      }
    }
  } catch (err) {
    yield {
      type: "error",
      error: `Failed to parse response: ${(err as Error).message}`,
    };
    return;
  }

  yield { type: "done" };
}

export async function fillSinglePlaceholder(
  name: string,
  chapterBrief: string,
  projectDescription: string,
  promptContents: string[],
  existingDefinitions: Record<string, string>,
  model: string = DEFAULT_GENERATION_MODEL,
  customSystemPrompt?: string,
): Promise<{ definition: string; sources: SearchResult[] }> {
  // Research this specific placeholder
  const query = `${name.replace(/_/g, " ")} ${projectDescription || ""}`.trim();
  const searchResults = await webSearchBatch([query]);
  const sources = searchResults[query] ?? [];

  let researchContext = "";
  if (sources.length > 0) {
    researchContext = "\n\n## Research Results\n";
    for (const r of sources) {
      researchContext += `- ${r.title}\n  ${r.snippet}\n  URL: ${r.url}\n`;
    }
  }

  const systemPrompt = customSystemPrompt || `You are an expert book researcher. Define this single placeholder with a concise, research-backed value that fits the chapter. Output ONLY: {"definition": "..."}`;

  const userPrompt = `## Project Description\n${projectDescription || "(none)"}

## Chapter Brief
${chapterBrief || "(none)"}

## Existing Placeholder Definitions (for context)
${Object.entries(existingDefinitions).map(([k, v]) => `- {${k}}: ${v}`).join("\n")}

${researchContext}

## Placeholder to Define
{${name}}

Return JSON: {"definition": "your concise definition"}`;

  const result = await generateCompletion({
    model,
    systemPrompt,
    userPrompt,
    effort: "max",
  });

  try {
    const parsed = await extractJson(result.data as string);
    return { definition: parsed.definition ?? "", sources };
  } catch {
    return { definition: (result.data as string).trim(), sources };
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add lib/ai/placeholder-fill.ts
git commit -m "feat: add two-phase placeholder fill logic with web research"
```

---

### Task 4: API — Chapter Brief CRUD + Generate

**Files:**
- Create: `app/api/projects/[id]/chapters/[chapterId]/brief/route.ts`
- Create: `app/api/projects/[id]/chapters/[chapterId]/brief/generate/route.ts`

- [ ] **Step 1: Create brief CRUD route**

```typescript
// app/api/projects/[id]/chapters/[chapterId]/brief/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, chapterBriefs } from "@/lib/db/schema";
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

  const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const [brief] = await db.select().from(chapterBriefs).where(eq(chapterBriefs.chapterId, chapterId));
  return NextResponse.json(brief ?? { content: null });
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

  const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const { content } = body;

  const [brief] = await db
    .insert(chapterBriefs)
    .values({ chapterId, content })
    .onConflictDoUpdate({ target: chapterBriefs.chapterId, set: { content, updatedAt: new Date() } })
    .returning();

  return NextResponse.json(brief);
}
```

- [ ] **Step 2: Create brief generate route**

```typescript
// app/api/projects/[id]/chapters/[chapterId]/brief/generate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, projectPrompts, chapterBriefs, chapterConfigPrompts } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, and, asc } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { generateCompletion } from "@/lib/ai/completion";

const DEFAULT_BRIEF_PROMPT = `You are a book editor. Based on the chapter title, the content prompts, and the project description, write a 2-3 sentence brief describing the chapter's scope, target reader, and desired outcome. Be specific and concise. Output ONLY the brief text, no JSON wrapper.`;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; chapterId: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id, chapterId } = await params;

  const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const model = (body.model as string) || undefined;

  // Load prompts for context
  const promptList = await db
    .select({ title: projectPrompts.title, content: projectPrompts.content })
    .from(projectPrompts)
    .where(eq(projectPrompts.chapterId, chapterId))
    .orderBy(asc(projectPrompts.position));

  // Load custom system prompt if exists
  const [config] = await db
    .select()
    .from(chapterConfigPrompts)
    .where(and(eq(chapterConfigPrompts.chapterId, chapterId), eq(chapterConfigPrompts.type, "generate_brief")));

  const systemPrompt = config?.content || DEFAULT_BRIEF_PROMPT;

  const userPrompt = `## Project Description\n${project.description || "(none)"}

## Chapter Prompts
${promptList.map((p, i) => `### ${p.title}\n${p.content.slice(0, 300)}${p.content.length > 300 ? "..." : ""}`).join("\n\n")}

Write a 2-3 sentence chapter brief.`;

  const result = await generateCompletion({
    model: model || "deepseek-v4-flash",
    systemPrompt,
    userPrompt,
  });

  const briefContent = (result.data as string).trim();

  const [brief] = await db
    .insert(chapterBriefs)
    .values({ chapterId, content: briefContent })
    .onConflictDoUpdate({ target: chapterBriefs.chapterId, set: { content: briefContent, updatedAt: new Date() } })
    .returning();

  return NextResponse.json(brief);
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add app/api/projects/[id]/chapters/[chapterId]/brief/
git commit -m "feat: add chapter brief CRUD and LLM generate endpoints"
```

---

### Task 5: API — Project Description Update

**Files:**
- Create: `app/api/projects/[id]/description/route.ts`

- [ ] **Step 1: Create description PATCH route**

```typescript
// app/api/projects/[id]/description/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;

  const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const { description } = body;

  const [updated] = await db
    .update(projects)
    .set({ description })
    .where(eq(projects.id, id))
    .returning();

  return NextResponse.json(updated);
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
pnpm typecheck
git add app/api/projects/[id]/description/route.ts
git commit -m "feat: add project description PATCH endpoint"
```

---

### Task 6: API — Fill Placeholders (SSE + Single)

**Files:**
- Create: `app/api/projects/[id]/chapters/[chapterId]/placeholders/fill/route.ts`
- Create: `app/api/projects/[id]/chapters/[chapterId]/placeholders/[name]/fill/route.ts`

- [ ] **Step 1: Create SSE fill-all route**

```typescript
// app/api/projects/[id]/chapters/[chapterId]/placeholders/fill/route.ts
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { projects, chapterBriefs, projectPrompts, chapterPlaceholders, chapterConfigPrompts } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, and, asc } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { researchPlaceholders, fillPlaceholders } from "@/lib/ai/placeholder-fill";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; chapterId: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return new Response(JSON.stringify({ error: "csrf" }), { status: 403 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });

  const { id: projectId, chapterId } = await params;

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project || project.userId !== user.id) {
    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const model = (body.model as string) || undefined;

  // Load context
  const [brief] = await db.select().from(chapterBriefs).where(eq(chapterBriefs.chapterId, chapterId));
  const placeholderRows = await db.select().from(chapterPlaceholders).where(eq(chapterPlaceholders.chapterId, chapterId)).orderBy(asc(chapterPlaceholders.name));
  const promptRows = await db.select({ content: projectPrompts.content }).from(projectPrompts).where(eq(projectPrompts.chapterId, chapterId)).orderBy(asc(projectPrompts.position));

  const [config] = await db.select().from(chapterConfigPrompts).where(and(eq(chapterConfigPrompts.chapterId, chapterId), eq(chapterConfigPrompts.type, "fill_placeholders")));

  const placeholderNames = placeholderRows.map((p) => p.name);
  const chapterBrief = brief?.content ?? "";
  const projectDescription = project.description ?? "";
  const promptContents = promptRows.map((p) => p.content);

  // Phase 1: Research
  const searchResults = await researchPlaceholders(placeholderNames, chapterBrief, projectDescription);

  // Phase 2: Generate + stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of fillPlaceholders(
          placeholderNames,
          chapterBrief,
          projectDescription,
          promptContents,
          searchResults,
          model,
          config?.content,
        )) {
          const data = JSON.stringify(event);
          controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${data}\n\n`));

          // Save definition to DB on placeholder event
          if (event.type === "placeholder" && event.name && event.definition) {
            await db
              .update(chapterPlaceholders)
              .set({ definition: event.definition })
              .where(and(eq(chapterPlaceholders.chapterId, chapterId), eq(chapterPlaceholders.name, event.name)));
          }
        }
      } catch (err) {
        const errorEvent = { type: "error", error: (err as Error).message };
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify(errorEvent)}\n\n`));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 2: Create single fill route**

```typescript
// app/api/projects/[id]/chapters/[chapterId]/placeholders/[name]/fill/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, chapterBriefs, projectPrompts, chapterPlaceholders, chapterConfigPrompts } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, and, asc } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { fillSinglePlaceholder } from "@/lib/ai/placeholder-fill";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; chapterId: string; name: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return new Response(JSON.stringify({ error: "csrf" }), { status: 403 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: projectId, chapterId, name } = await params;

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const model = (body.model as string) || undefined;

  const [brief] = await db.select().from(chapterBriefs).where(eq(chapterBriefs.chapterId, chapterId));
  const promptRows = await db.select({ content: projectPrompts.content }).from(projectPrompts).where(eq(projectPrompts.chapterId, chapterId)).orderBy(asc(projectPrompts.position));
  const existingRows = await db.select().from(chapterPlaceholders).where(eq(chapterPlaceholders.chapterId, chapterId));

  const [config] = await db.select().from(chapterConfigPrompts).where(and(eq(chapterConfigPrompts.chapterId, chapterId), eq(chapterConfigPrompts.type, "fill_placeholders")));

  const existingDefinitions: Record<string, string> = {};
  for (const row of existingRows) {
    if (row.definition && row.name !== name) {
      existingDefinitions[row.name] = row.definition;
    }
  }

  const { definition, sources } = await fillSinglePlaceholder(
    name,
    brief?.content ?? "",
    project.description ?? "",
    promptRows.map((p) => p.content),
    existingDefinitions,
    model,
    config?.content,
  );

  // Save to DB
  await db
    .update(chapterPlaceholders)
    .set({ definition })
    .where(and(eq(chapterPlaceholders.chapterId, chapterId), eq(chapterPlaceholders.name, name)));

  return NextResponse.json({ name, definition, sources });
}
```

- [ ] **Step 3: Typecheck and commit**

```bash
pnpm typecheck
git add app/api/projects/[id]/chapters/[chapterId]/placeholders/fill/ app/api/projects/[id]/chapters/[chapterId]/placeholders/\[name\]/
git commit -m "feat: add SSE streaming fill-all and single fill endpoints"
```

---

### Task 7: API — Config Prompts CRUD (Admin)

**Files:**
- Create: `app/api/chapters/[id]/config-prompts/route.ts`

- [ ] **Step 1: Create config prompts route**

```typescript
// app/api/chapters/[id]/config-prompts/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chapterConfigPrompts } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, and } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { requireAdmin } from "@/lib/auth/admin";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const rows = await db.select().from(chapterConfigPrompts).where(eq(chapterConfigPrompts.chapterId, id));
  return NextResponse.json(rows);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const admin = await requireAdmin();
  if (!admin.authorized) return admin.response;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  // body: { prompts: [{ type: "fill_placeholders"|"generate_brief", content: "..." }] }
  const prompts: { type: string; content: string }[] = body.prompts ?? [];

  for (const p of prompts) {
    await db
      .insert(chapterConfigPrompts)
      .values({ chapterId: id, type: p.type, content: p.content })
      .onConflictDoUpdate({
        target: [chapterConfigPrompts.chapterId, chapterConfigPrompts.type],
        set: { content: p.content },
      });
  }

  const rows = await db.select().from(chapterConfigPrompts).where(eq(chapterConfigPrompts.chapterId, id));
  return NextResponse.json(rows);
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
pnpm typecheck
git add app/api/chapters/[id]/config-prompts/route.ts
git commit -m "feat: add chapter config prompts CRUD endpoint (admin)"
```

---

### Task 8: UI — Chapter Brief Section Component

**Files:**
- Create: `components/projects/chapter-brief-section.tsx`

- [ ] **Step 1: Create the component**

```typescript
// components/projects/chapter-brief-section.tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Sparkles, Save } from "lucide-react";
import { toast } from "sonner";

interface Props {
  projectId: string;
  chapterId: string;
  initialContent: string | null;
  onSaved?: (content: string) => void;
}

export function ChapterBriefSection({ projectId, chapterId, initialContent, onSaved }: Props) {
  const [content, setContent] = useState(initialContent ?? "");
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/chapters/${chapterId}/brief`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (res.ok) {
        toast.success("Brief saved");
        onSaved?.(content);
      } else {
        toast.error("Error saving brief");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function generate() {
    setGenerating(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/chapters/${chapterId}/brief/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const data = await res.json();
        setContent(data.content ?? "");
        toast.success("Brief generated");
      } else {
        toast.error("Error generating brief");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="mb-6">
      <h2 className="text-sm font-medium text-muted-foreground mb-3">Chapter Brief</h2>
      <Card>
        <CardContent className="pt-4 space-y-3">
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="text-xs min-h-[80px]"
            placeholder="A brief description of this chapter's scope, target reader, and desired outcome..."
          />
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              className="text-xs"
              onClick={generate}
              disabled={generating}
            >
              {generating ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
              Generate with AI
            </Button>
            <Button size="sm" className="text-xs" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
              Save
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
pnpm typecheck
git add components/projects/chapter-brief-section.tsx
git commit -m "feat: add chapter brief section component"
```

---

### Task 9: UI — Placeholder Fill Section Component

**Files:**
- Create: `components/projects/placeholder-fill-section.tsx`

This is the main UI component — replaces the inline placeholder section in the project chapter page. Handles streaming, sources, individual regenerate.

- [ ] **Step 1: Create the component**

```typescript
// components/projects/placeholder-fill-section.tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Sparkles, RefreshCw, ChevronDown, ChevronRight, ExternalLink, Save } from "lucide-react";
import { toast } from "sonner";
import { AVAILABLE_MODELS } from "@/lib/ai/providers";
import type { ChapterPlaceholder } from "@/lib/db/schema";

const MODELS = [
  { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", short: "DS Flash" },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", short: "DS Pro" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", short: "Haiku" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", short: "Sonnet" },
  { id: "claude-opus-4-7", label: "Claude Opus 4.7", short: "Opus" },
];

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  provider: string;
}

interface Props {
  projectId: string;
  chapterId: string;
  placeholders: ChapterPlaceholder[];
  onPlaceholdersSaved: (placeholders: ChapterPlaceholder[]) => void;
  onSaveDefinitions: () => Promise<void>;
  savingPlaceholders: boolean;
}

export function PlaceholderFillSection({
  projectId,
  chapterId,
  placeholders,
  onPlaceholdersSaved,
  onSaveDefinitions,
  savingPlaceholders,
}: Props) {
  const [fillModel, setFillModel] = useState("deepseek-v4-pro");
  const [filling, setFilling] = useState(false);
  const [fillingName, setFillingName] = useState<string | null>(null);
  const [definitions, setDefinitions] = useState<Record<string, string>>({});
  const [sources, setSources] = useState<Record<string, SearchResult[]>>({});
  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({});

  function getDefinition(name: string): string {
    return definitions[name] ?? placeholders.find((p) => p.name === name)?.definition ?? "";
  }

  function getSources(name: string): SearchResult[] {
    return sources[name] ?? [];
  }

  async function fillAll() {
    setFilling(true);
    setSources({});
    try {
      const res = await fetch(
        `/api/projects/${projectId}/chapters/${chapterId}/placeholders/fill`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: fillModel }),
        },
      );

      if (!res.ok) {
        toast.error("Error starting fill");
        setFilling(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) { setFilling(false); return; }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const dataStr = line.slice(6);
          try {
            const event = JSON.parse(dataStr);
            if (event.type === "placeholder" && event.name) {
              setDefinitions((prev) => ({ ...prev, [event.name]: event.definition }));
              if (event.sources?.length > 0) {
                setSources((prev) => ({ ...prev, [event.name]: event.sources }));
              }
            } else if (event.type === "done") {
              toast.success("Placeholders filled");
            } else if (event.type === "error") {
              toast.error(event.error ?? "Error filling");
            }
          } catch {}
        }
      }
    } catch {
      toast.error("Stream error");
    } finally {
      setFilling(false);
    }
  }

  async function fillOne(name: string) {
    setFillingName(name);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/chapters/${chapterId}/placeholders/${encodeURIComponent(name)}/fill`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: fillModel }),
        },
      );
      if (res.ok) {
        const data = await res.json();
        setDefinitions((prev) => ({ ...prev, [data.name]: data.definition }));
        if (data.sources?.length > 0) {
          setSources((prev) => ({ ...prev, [data.name]: data.sources }));
        }
        toast.success(`{${name}} filled`);
      } else {
        toast.error(`Error filling {${name}}`);
      }
    } catch {
      toast.error("Network error");
    } finally {
      setFillingName(null);
    }
  }

  if (placeholders.length === 0) return null;

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-muted-foreground">Placeholders</h2>
        <div className="flex items-center gap-2">
          <Select value={fillModel} onValueChange={setFillModel}>
            <SelectTrigger className="w-[130px] h-7 text-[10px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODELS.map((m) => (
                <SelectItem key={m.id} value={m.id} className="text-[10px]">{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" className="text-xs" onClick={fillAll} disabled={filling}>
            {filling ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
            Fill All
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-4 space-y-3">
          {placeholders.map((ph) => {
            const def = getDefinition(ph.name);
            const srcs = getSources(ph.name);
            const isFillingThis = fillingName === ph.name;
            const isStreaming = filling && !def;

            return (
              <div key={ph.id} className="space-y-1.5">
                <Label className="text-[10px] text-muted-foreground">
                  {"{"}{ph.name}{"}"}
                </Label>
                <div className="flex gap-2">
                  <Input
                    value={def}
                    onChange={(e) => setDefinitions((prev) => ({ ...prev, [ph.name]: e.target.value }))}
                    className="text-xs h-8 flex-1"
                    placeholder={
                      isStreaming ? "generating..." :
                      isFillingThis ? "generating..." :
                      `Define "${ph.name}"...`
                    }
                    disabled={isStreaming || isFillingThis}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 flex-shrink-0"
                    onClick={() => fillOne(ph.name)}
                    disabled={isFillingThis || filling}
                  >
                    {isFillingThis || isStreaming ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3 text-muted-foreground" />
                    )}
                  </Button>
                </div>

                {srcs.length > 0 && (
                  <div className="text-[10px]">
                    <button
                      type="button"
                      className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        setExpandedSources((prev) => ({
                          ...prev,
                          [ph.name]: !prev[ph.name],
                        }))
                      }
                    >
                      {expandedSources[ph.name] ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronRight className="h-3 w-3" />
                      )}
                      Sources ({srcs.length})
                    </button>
                    {expandedSources[ph.name] && (
                      <div className="mt-1 space-y-1 ml-4">
                        {srcs.map((s, i) => (
                          <a
                            key={i}
                            href={s.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-start gap-1 text-muted-foreground hover:text-foreground"
                          >
                            <ExternalLink className="h-2.5 w-2.5 mt-0.5 flex-shrink-0" />
                            <span>
                              {s.title} ({s.provider})
                            </span>
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <div className="flex justify-end pt-2">
            <Button size="sm" className="text-xs" onClick={onSaveDefinitions} disabled={savingPlaceholders}>
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
  );
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
pnpm typecheck
git add components/projects/placeholder-fill-section.tsx
git commit -m "feat: add placeholder fill section with streaming and per-item regenerate"
```

---

### Task 10: UI — Integrate into Project Chapter Page

**Files:**
- Modify: `app/projects/[id]/chapters/[chapterId]/page.tsx`

- [ ] **Step 1: Add imports**

Add at top:
```typescript
import { ChapterBriefSection } from "@/components/projects/chapter-brief-section";
import { PlaceholderFillSection } from "@/components/projects/placeholder-fill-section";
import type { ChapterPlaceholder } from "@/lib/db/schema";
```

- [ ] **Step 2: Add state for brief**

```typescript
const [chapterBrief, setChapterBrief] = useState<string | null>(null);
```

- [ ] **Step 3: Add brief fetch**

Add `fetchBrief` function:
```typescript
const fetchBrief = useCallback(async (signal?: AbortSignal) => {
  try {
    const res = await fetch(`/api/projects/${params.id}/chapters/${params.chapterId}/brief`, { signal });
    if (signal?.aborted) return;
    if (res.ok) {
      const data = await res.json();
      setChapterBrief(data.content ?? null);
    }
  } catch { /* supplementary */ }
}, [params.id, params.chapterId]);
```

Add to useEffect:
```typescript
Promise.all([fetchChapter(controller.signal), fetchPrompts(controller.signal), fetchPlaceholders(controller.signal), fetchBrief(controller.signal)]);
```

Add `fetchBrief` to dependency array.

- [ ] **Step 4: Replace inline placeholder section with component**

Remove the existing placeholder JSX block (the `{placeholders.length > 0 && (...)}` section with Card + Input + Save button) and replace with:

```tsx
<ChapterBriefSection
  projectId={params.id as string}
  chapterId={params.chapterId as string}
  initialContent={chapterBrief}
  onSaved={(content) => setChapterBrief(content)}
/>

<PlaceholderFillSection
  projectId={params.id as string}
  chapterId={params.chapterId as string}
  placeholders={placeholders}
  onPlaceholdersSaved={setPlaceholders}
  onSaveDefinitions={savePlaceholders}
  savingPlaceholders={savingPlaceholders}
/>
```

Place this between the toolbar section and the "No prompts" / "Content Prompts" area (replacing the existing placeholder section).

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm typecheck
git add app/projects/[id]/chapters/[chapterId]/page.tsx
git commit -m "feat: integrate chapter brief and placeholder fill sections into project chapter page"
```

---

### Task 11: UI — Project Description in Project Settings

**Files:**
- Modify: `app/projects/[id]/page.tsx`

- [ ] **Step 1: Add description state and handlers**

Add state:
```typescript
const [description, setDescription] = useState(project?.description ?? "");
const [savingDescription, setSavingDescription] = useState(false);
```

Add save handler:
```typescript
async function saveDescription() {
  setSavingDescription(true);
  try {
    const res = await fetch(`/api/projects/${params.id}/description`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description }),
    });
    if (res.ok) {
      toast.success("Description saved");
    } else {
      toast.error("Error saving description");
    }
  } catch {
    toast.error("Network error");
  } finally {
    setSavingDescription(false);
  }
}
```

- [ ] **Step 2: Add description UI**

Add a "Description" section to the project detail page, with a Textarea and Save button. Place it near the project name/title section.

The exact placement depends on the existing page structure. Read the current page, find the right spot (after the project title, before the chapter list), and add:

```tsx
<div className="space-y-2 mb-6">
  <Label className="text-xs text-muted-foreground">Description</Label>
  <Textarea
    value={description}
    onChange={(e) => setDescription(e.target.value)}
    className="text-xs min-h-[80px]"
    placeholder="What is this book about? This description helps the AI understand context for filling placeholders..."
  />
  <div className="flex justify-end">
    <Button size="sm" className="text-xs" onClick={saveDescription} disabled={savingDescription}>
      {savingDescription ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
      Save
    </Button>
  </div>
</div>
```

Need to import `Label`, `Textarea`, and check if `Save`/`Loader2` are imported.

- [ ] **Step 3: Typecheck and commit**

```bash
pnpm typecheck
git add app/projects/[id]/page.tsx
git commit -m "feat: add project description field to project settings page"
```

---

### Task 12: UI — AI Configuration in Template Editor

**Files:**
- Modify: `app/templates/[id]/chapters/[chapterId]/page.tsx`

- [ ] **Step 1: Add config prompts state and fetch**

Add state:
```typescript
const [configPrompts, setConfigPrompts] = useState<{ type: string; content: string }[]>([]);
const [configFormData, setConfigFormData] = useState<Record<string, string>>({});
const [savingConfig, setSavingConfig] = useState(false);
```

Add fetch in useEffect:
```typescript
fetch(`/api/chapters/${params.chapterId}/config-prompts`)
  .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
  .then((data) => { if (!cancelled) {
    setConfigPrompts(data);
    const form: Record<string, string> = {};
    for (const cp of data) form[cp.type] = cp.content;
    setConfigFormData(form);
  }})
```

Add save handler:
```typescript
async function saveConfigPrompts() {
  setSavingConfig(true);
  try {
    const prompts = Object.entries(configFormData).map(([type, content]) => ({ type, content }));
    const res = await fetch(`/api/chapters/${params.chapterId}/config-prompts`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompts }),
    });
    if (res.ok) {
      setConfigPrompts(await res.json());
      toast.success("AI config saved");
    } else {
      toast.error("Error saving AI config");
    }
  } catch {
    toast.error("Network error");
  } finally {
    setSavingConfig(false);
  }
}
```

- [ ] **Step 2: Add AI Configuration section UI**

Add after the Placeholders section and before the Assembly Prompt section:

```tsx
<div className="mb-6">
  <h2 className="text-sm font-medium text-muted-foreground mb-3">AI Configuration</h2>
  <Card>
    <CardContent className="pt-4 space-y-3">
      <div className="space-y-1.5">
        <Label className="text-[10px] text-muted-foreground">
          Placeholder Fill Prompt
        </Label>
        <Textarea
          value={configFormData["fill_placeholders"] ?? ""}
          onChange={(e) => setConfigFormData((prev) => ({ ...prev, fill_placeholders: e.target.value }))}
          className="text-xs min-h-[80px]"
          placeholder="System prompt for filling placeholders with AI..."
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-[10px] text-muted-foreground">
          Brief Generation Prompt
        </Label>
        <Textarea
          value={configFormData["generate_brief"] ?? ""}
          onChange={(e) => setConfigFormData((prev) => ({ ...prev, generate_brief: e.target.value }))}
          className="text-xs min-h-[80px]"
          placeholder="System prompt for generating chapter briefs with AI..."
        />
      </div>
      <div className="flex justify-end">
        <Button size="sm" className="text-xs" onClick={saveConfigPrompts} disabled={savingConfig}>
          {savingConfig ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
          Save
        </Button>
      </div>
    </CardContent>
  </Card>
</div>
```

- [ ] **Step 3: Typecheck and commit**

```bash
pnpm typecheck
git add app/templates/[id]/chapters/[chapterId]/page.tsx
git commit -m "feat: add AI configuration section to template chapter editor"
```

---

### Task 13: Final Verification

- [ ] **Step 1: Run typecheck**

```bash
pnpm typecheck
```

Expected: zero errors.

- [ ] **Step 2: Run lint**

```bash
pnpm lint
```

- [ ] **Step 3: Manual verification checklist**

- [ ] Create a project from a template with placeholders
- [ ] Add a project description in project settings
- [ ] Navigate to a chapter
- [ ] Add a chapter brief (manual text)
- [ ] Click "Generate with AI" on brief → verify brief is generated
- [ ] Click "Fill All" on placeholders → verify streaming one-by-one
- [ ] Verify sources are shown and links open in new tab
- [ ] Click regenerate on a single placeholder → verify single fill
- [ ] Edit a definition manually → Save
- [ ] Go to template editor → verify AI Configuration section
- [ ] Edit fill prompt → Save → verify it's used on next fill
- [ ] Edit brief prompt → Save → verify it's used on next brief generation
