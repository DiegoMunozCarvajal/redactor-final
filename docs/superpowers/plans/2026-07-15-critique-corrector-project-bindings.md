# Critique and Corrector Project Bindings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preload effective critique and corrector prompt revisions on chapter pages, persist selector changes for the whole project, and execute both stages with exact registry revision IDs.

**Architecture:** Add a focused client registry loader that resolves project binding over global default and owns binding mutations. Existing critique/corrector cards consume resolved registry state. Chapter execution sends revision IDs through small tested payload builders; no legacy inline prompt content remains.

**Tech Stack:** Next.js 15, React 19, TypeScript, Vitest, Testing Library, existing prompt registry APIs, Drizzle-backed `project_prompt_bindings`.

---

## File map

- Create `components/prompts/review-prompt-registry.ts`: load critique/corrector definitions, revisions, defaults, and project bindings; expose binding mutation helpers.
- Create `components/prompts/__tests__/review-prompt-registry.test.ts`: loader precedence, error, PUT, and DELETE coverage.
- Modify `components/prompts/critique-prompt-section.tsx`: render effective registry revision and persistent selector.
- Modify `components/prompts/corrector-prompt-section.tsx`: render effective registry revision and persistent selector.
- Create `components/prompts/__tests__/review-prompt-sections.test.tsx`: default selection, project binding selection, loading, and error UI.
- Create `lib/review/request-payloads.ts`: construct critique/correction request bodies using revision IDs only.
- Create `lib/review/__tests__/request-payloads.test.ts`: prove legacy inline prompt objects cannot enter request bodies.
- Modify `components/prompts/corrector-section.tsx`: accept effective corrector revision ID and send registry payload.
- Create `components/prompts/__tests__/corrector-section.test.tsx`: verify correction interaction posts exact revision ID.
- Modify `app/projects/[id]/chapters/[chapterId]/page.tsx`: load effective review prompts, persist selector changes, wire execution and blocker logic.
- Create `lib/__tests__/review-prompt-cutover.test.ts`: guard chapter page against reintroducing legacy critique/corrector prompt payloads.

### Task 1: Review prompt registry loader and binding mutations

**Files:**
- Create: `components/prompts/review-prompt-registry.ts`
- Test: `components/prompts/__tests__/review-prompt-registry.test.ts`

- [ ] **Step 1: Write failing loader and mutation tests**

Create `components/prompts/__tests__/review-prompt-registry.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  clearReviewPromptBinding,
  loadReviewPromptRegistry,
  setReviewPromptBinding,
} from "@/components/prompts/review-prompt-registry";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("loadReviewPromptRegistry", () => {
  it("resolves project binding before global default and default otherwise", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/prompt-bindings")) {
        return json([{ kind: "critique", promptRevisionId: "critique-bound" }]);
      }
      if (url.includes("kind=critique")) {
        return json([{ id: "critique-def", name: "Critique", defaultRevisionId: "critique-default" }]);
      }
      if (url.includes("kind=corrector")) {
        return json([{ id: "corrector-def", name: "Corrector", defaultRevisionId: "corrector-default" }]);
      }
      if (url.endsWith("/critique-def/revisions")) {
        return json([
          { id: "critique-bound", versionLabel: "2.0", revisionNumber: 2, systemTemplate: "s2", userTemplate: "u2", requiredMarkers: [], outputContract: null },
          { id: "critique-default", versionLabel: "1.0", revisionNumber: 1, systemTemplate: "s1", userTemplate: "u1", requiredMarkers: [], outputContract: null },
        ]);
      }
      if (url.endsWith("/corrector-def/revisions")) {
        return json([{ id: "corrector-default", versionLabel: "1.0", revisionNumber: 1, systemTemplate: "s", userTemplate: "u", requiredMarkers: [], outputContract: null }]);
      }
      return json({ error: "not found" }, 404);
    });

    const result = await loadReviewPromptRegistry("project-1", fetcher as typeof fetch);

    expect(result.critique.effective).toMatchObject({ id: "critique-bound", source: "project-binding" });
    expect(result.critique.bindingRevisionId).toBe("critique-bound");
    expect(result.corrector.effective).toMatchObject({ id: "corrector-default", source: "global-default" });
    expect(result.corrector.bindingRevisionId).toBeNull();
  });

  it("rejects unavailable configured revisions", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/prompt-bindings")) return json([]);
      if (url.includes("kind=critique")) return json([{ id: "d1", name: "Critique", defaultRevisionId: "missing" }]);
      if (url.includes("kind=corrector")) return json([]);
      if (url.endsWith("/d1/revisions")) return json([]);
      return json({ error: "not found" }, 404);
    });

    await expect(loadReviewPromptRegistry("project-1", fetcher as typeof fetch)).rejects.toThrow(
      "Configured critique revision missing is unavailable",
    );
  });
});

describe("review prompt binding mutations", () => {
  it("persists an exact project revision", async () => {
    const fetcher = vi.fn(async () => json({ ok: true }));
    await setReviewPromptBinding("project-1", "critique", "revision-1", fetcher as typeof fetch);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/projects/project-1/prompt-bindings",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ kind: "critique", promptRevisionId: "revision-1" }),
      }),
    );
  });

  it("clears project binding to restore global default", async () => {
    const fetcher = vi.fn(async () => json({ ok: true }));
    await clearReviewPromptBinding("project-1", "corrector", fetcher as typeof fetch);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/projects/project-1/prompt-bindings?kind=corrector",
      { method: "DELETE" },
    );
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
rtk pnpm exec vitest run components/prompts/__tests__/review-prompt-registry.test.ts --exclude '.claude/worktrees/**'
```

Expected: FAIL because `review-prompt-registry.ts` does not exist.

- [ ] **Step 3: Implement loader and mutation helpers**

Create `components/prompts/review-prompt-registry.ts`:

```ts
export type ReviewPromptKind = "critique" | "corrector";
export type ReviewPromptSource = "project-binding" | "global-default";

export interface ReviewPromptRevision {
  id: string;
  name: string;
  versionLabel: string;
  revisionNumber: number;
  systemTemplate: string;
  userTemplate: string;
  requiredMarkers: string[];
  outputContract: string | null;
}

export interface EffectiveReviewPrompt extends ReviewPromptRevision {
  source: ReviewPromptSource;
}

export interface ReviewPromptKindState {
  effective: EffectiveReviewPrompt | null;
  revisions: ReviewPromptRevision[];
  defaultRevisionId: string | null;
  bindingRevisionId: string | null;
}

export interface ReviewPromptRegistryData {
  critique: ReviewPromptKindState;
  corrector: ReviewPromptKindState;
}

interface DefinitionSummary {
  id: string;
  name: string;
  defaultRevisionId: string | null;
}

interface RevisionResponse {
  id: string;
  versionLabel: string;
  revisionNumber: number;
  systemTemplate: string;
  userTemplate: string;
  requiredMarkers: string[];
  outputContract: string | null;
}

interface BindingResponse {
  kind: string;
  promptRevisionId: string;
}

async function readJson<T>(fetcher: typeof fetch, url: string): Promise<T> {
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json() as Promise<T>;
}

async function loadKind(
  kind: ReviewPromptKind,
  bindingRevisionId: string | null,
  fetcher: typeof fetch,
): Promise<ReviewPromptKindState> {
  const definitions = await readJson<DefinitionSummary[]>(
    fetcher,
    `/api/prompt-definitions?kind=${kind}`,
  );
  const groups = await Promise.all(
    definitions.map(async (definition) => {
      const revisions = await readJson<RevisionResponse[]>(
        fetcher,
        `/api/prompt-definitions/${definition.id}/revisions`,
      );
      return revisions.map((revision) => ({ ...revision, name: definition.name }));
    }),
  );
  const revisions = groups.flat();
  const defaultRevisionId =
    definitions.find((definition) => definition.defaultRevisionId)?.defaultRevisionId ?? null;
  const effectiveRevisionId = bindingRevisionId ?? defaultRevisionId;
  const revision = effectiveRevisionId
    ? revisions.find((item) => item.id === effectiveRevisionId)
    : null;

  if (effectiveRevisionId && !revision) {
    throw new Error(`Configured ${kind} revision ${effectiveRevisionId} is unavailable`);
  }

  return {
    effective: revision
      ? { ...revision, source: bindingRevisionId ? "project-binding" : "global-default" }
      : null,
    revisions,
    defaultRevisionId,
    bindingRevisionId,
  };
}

export async function loadReviewPromptRegistry(
  projectId: string,
  fetcher: typeof fetch = fetch,
): Promise<ReviewPromptRegistryData> {
  try {
    const bindings = await readJson<BindingResponse[]>(
      fetcher,
      `/api/projects/${projectId}/prompt-bindings`,
    );
    const bindingByKind = new Map(bindings.map((item) => [item.kind, item.promptRevisionId]));
    const [critique, corrector] = await Promise.all([
      loadKind("critique", bindingByKind.get("critique") ?? null, fetcher),
      loadKind("corrector", bindingByKind.get("corrector") ?? null, fetcher),
    ]);
    return { critique, corrector };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Could not load review prompt registry: ${detail}`);
  }
}

async function assertMutation(response: Response): Promise<void> {
  if (response.ok) return;
  const body = await response.json().catch(() => ({})) as { error?: string };
  throw new Error(body.error ?? `Request failed (${response.status})`);
}

export async function setReviewPromptBinding(
  projectId: string,
  kind: ReviewPromptKind,
  promptRevisionId: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  await assertMutation(await fetcher(`/api/projects/${projectId}/prompt-bindings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, promptRevisionId }),
  }));
}

export async function clearReviewPromptBinding(
  projectId: string,
  kind: ReviewPromptKind,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  await assertMutation(await fetcher(
    `/api/projects/${projectId}/prompt-bindings?kind=${encodeURIComponent(kind)}`,
    { method: "DELETE" },
  ));
}
```

- [ ] **Step 4: Run tests and verify GREEN**

Run the Task 1 test command. Expected: all tests PASS.

- [ ] **Step 5: Commit Task 1**

```bash
rtk git add components/prompts/review-prompt-registry.ts components/prompts/__tests__/review-prompt-registry.test.ts
rtk git commit -m "feat: load review prompt bindings"
```

### Task 2: Registry-backed Critique and Corrector cards

**Files:**
- Modify: `components/prompts/critique-prompt-section.tsx`
- Modify: `components/prompts/corrector-prompt-section.tsx`
- Test: `components/prompts/__tests__/review-prompt-sections.test.tsx`

- [ ] **Step 1: Write failing card tests**

Create `components/prompts/__tests__/review-prompt-sections.test.tsx` with jsdom. Render each card using one global-default fixture and one project-binding fixture. Assert:

```tsx
expect(screen.getByText("Critique v1.0")).toBeTruthy();
expect(screen.getByText("Global default")).toBeTruthy();
expect(screen.getByRole("combobox", { name: "Critique prompt revision" })).toHaveValue("__global_default__");

expect(screen.getByText("Corrector v2.0")).toBeTruthy();
expect(screen.getByText("Project binding")).toBeTruthy();
expect(screen.getByRole("combobox", { name: "Corrector prompt revision" })).toHaveValue("corrector-v2");
```

Use `fireEvent` to select `critique-v2`; assert `onRevisionChange("critique-v2")`. Select `__global_default__`; assert the same sentinel is emitted. Render `loading=true`; assert action button disabled. Render an error; assert error text and Retry callback.

- [ ] **Step 2: Run card tests and verify RED**

Run:

```bash
rtk pnpm exec vitest run components/prompts/__tests__/review-prompt-sections.test.tsx --exclude '.claude/worktrees/**'
```

Expected: FAIL because current cards accept legacy `prompt` objects and expose no revision selector.

- [ ] **Step 3: Replace legacy card props with registry props**

For both cards, use this shared prop shape with the stage-specific action props retained:

```ts
interface RegistryPromptProps {
  prompt: EffectiveReviewPrompt | null;
  revisions: ReviewPromptRevision[];
  bindingRevisionId: string | null;
  defaultRevisionId: string | null;
  loading: boolean;
  error: string | null;
  saving: boolean;
  onRetry: () => void;
  onRevisionChange: (value: string) => void;
}
```

Set selector value to `bindingRevisionId ?? "__global_default__"`. Add first option:

```tsx
<SelectItem value="__global_default__">
  Use global default
  {defaultPrompt ? ` — ${defaultPrompt.name} v${defaultPrompt.versionLabel}` : " — not configured"}
</SelectItem>
```

List all revisions as `${revision.name} v${revision.versionLabel}`. Show a `Badge` using `prompt.source === "project-binding" ? "Project binding" : "Global default"`. Keep model selector and action button. Disable prompt selector and action during `loading`, `saving`, error, or missing effective prompt. Replace delete buttons with retry/error UI; chapter cards no longer delete prompt definitions.

- [ ] **Step 4: Run card tests and verify GREEN**

Run the Task 2 test command. Expected: all tests PASS.

- [ ] **Step 5: Commit Task 2**

```bash
rtk git add components/prompts/critique-prompt-section.tsx components/prompts/corrector-prompt-section.tsx components/prompts/__tests__/review-prompt-sections.test.tsx
rtk git commit -m "feat: select project review prompts"
```

### Task 3: Revision-only execution payloads

**Files:**
- Create: `lib/review/request-payloads.ts`
- Test: `lib/review/__tests__/request-payloads.test.ts`
- Modify: `components/prompts/corrector-section.tsx`
- Test: `components/prompts/__tests__/corrector-section.test.tsx`

- [ ] **Step 1: Write failing payload tests**

Create `lib/review/__tests__/request-payloads.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildCorrectionRequestBody, buildCritiqueRequestBody } from "@/lib/review/request-payloads";

describe("review request payloads", () => {
  it("builds critique payload with exact revision ID", () => {
    expect(buildCritiqueRequestBody("critique-rev", "gpt-5.5")).toEqual({
      critiquePromptRevisionId: "critique-rev",
      model: "gpt-5.5",
    });
  });

  it("builds correction payload with exact revision and critique IDs", () => {
    expect(buildCorrectionRequestBody("corrector-rev", "critique-gen", "gpt-5.5")).toEqual({
      correctorPromptRevisionId: "corrector-rev",
      critiqueGenerationId: "critique-gen",
      model: "gpt-5.5",
    });
  });
});
```

- [ ] **Step 2: Run payload tests and verify RED**

Run:

```bash
rtk pnpm exec vitest run lib/review/__tests__/request-payloads.test.ts --exclude '.claude/worktrees/**'
```

Expected: FAIL because `request-payloads.ts` does not exist.

- [ ] **Step 3: Implement exact payload builders**

Create `lib/review/request-payloads.ts`:

```ts
export function buildCritiqueRequestBody(critiquePromptRevisionId: string, model: string) {
  return { critiquePromptRevisionId, model };
}

export function buildCorrectionRequestBody(
  correctorPromptRevisionId: string,
  critiqueGenerationId: string,
  model: string,
) {
  return { correctorPromptRevisionId, critiqueGenerationId, model };
}
```

- [ ] **Step 4: Update CorrectorSection through a failing interaction test**

Create `components/prompts/__tests__/corrector-section.test.tsx`. Render with `correctionTrigger=0`, then rerender with `correctionTrigger=1`, `correctorPromptRevisionId="corrector-rev"`, one completed critique, and an assembly. Mock `fetch` with a successful response. Use `waitFor` and assert posted JSON equals:

```ts
{
  correctorPromptRevisionId: "corrector-rev",
  critiqueGenerationId: "critique-gen",
  model: "gpt-5.5",
}
```

Run:

```bash
rtk pnpm exec vitest run components/prompts/__tests__/corrector-section.test.tsx --exclude '.claude/worktrees/**'
```

Expected: FAIL because current component accepts legacy prompt ID/content and sends `correctorPrompt`.

- [ ] **Step 5: Replace legacy CorrectorSection props and body**

Change props to:

```ts
correctorPromptRevisionId?: string;
```

Remove `projectCorrectorPromptId`, `projectCorrectorPromptContent`, and `projectCorrectorPromptUserPrompt`. Guard on `correctorPromptRevisionId`. Build body with:

```ts
const body = buildCorrectionRequestBody(
  correctorPromptRevisionId,
  selectedCritiqueGenId,
  correctorModel,
);
```

- [ ] **Step 6: Run Task 3 tests and verify GREEN**

Run both Task 3 test commands. Expected: all tests PASS.

- [ ] **Step 7: Commit Task 3**

```bash
rtk git add lib/review/request-payloads.ts lib/review/__tests__/request-payloads.test.ts components/prompts/corrector-section.tsx components/prompts/__tests__/corrector-section.test.tsx
rtk git commit -m "fix: send review prompt revisions"
```

### Task 4: Chapter page loading, persistence, and execution wiring

**Files:**
- Modify: `app/projects/[id]/chapters/[chapterId]/page.tsx`
- Test: `lib/__tests__/review-prompt-cutover.test.ts`

- [ ] **Step 1: Write failing cutover test**

Create `lib/__tests__/review-prompt-cutover.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(
  new URL("../../app/projects/[id]/chapters/[chapterId]/page.tsx", import.meta.url),
  "utf8",
);
const corrector = readFileSync(
  new URL("../../components/prompts/corrector-section.tsx", import.meta.url),
  "utf8",
);

describe("review prompt registry cutover", () => {
  it("loads effective review prompts and persists project bindings", () => {
    expect(page).toContain("loadReviewPromptRegistry");
    expect(page).toContain("setReviewPromptBinding");
    expect(page).toContain("clearReviewPromptBinding");
  });

  it("sends revision IDs without legacy inline prompt objects", () => {
    expect(page).toContain("critiquePromptRevisionId");
    expect(corrector).toContain("correctorPromptRevisionId");
    expect(page).not.toMatch(/critiquePrompt:\s*\{/);
    expect(corrector).not.toMatch(/correctorPrompt\s*=/);
  });
});
```

- [ ] **Step 2: Run cutover test and verify RED**

Run:

```bash
rtk pnpm exec vitest run lib/__tests__/review-prompt-cutover.test.ts --exclude '.claude/worktrees/**'
```

Expected: FAIL because page still uses legacy chapter prompts and payloads.

- [ ] **Step 3: Add review registry state and loader**

Import registry helpers and types. Add state:

```ts
const [reviewRegistry, setReviewRegistry] = useState<ReviewPromptRegistryData | null>(null);
const [reviewRegistryLoading, setReviewRegistryLoading] = useState(true);
const [reviewRegistryError, setReviewRegistryError] = useState<string | null>(null);
const [savingReviewKind, setSavingReviewKind] = useState<ReviewPromptKind | null>(null);
```

Add `refreshReviewRegistry` using `useCallback`; set loading/error, call `loadReviewPromptRegistry(params.id)`, and retain no stale data after failure. Call it from `useEffect` on project ID.

- [ ] **Step 4: Persist selection changes**

Add:

```ts
async function changeReviewPrompt(kind: ReviewPromptKind, value: string) {
  setSavingReviewKind(kind);
  try {
    if (value === "__global_default__") {
      await clearReviewPromptBinding(params.id, kind);
    } else {
      await setReviewPromptBinding(params.id, kind, value);
    }
    await refreshReviewRegistry();
    toast.success(`${kind === "critique" ? "Critique" : "Corrector"} prompt updated for project`);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Prompt update failed");
  } finally {
    setSavingReviewKind(null);
  }
}
```

- [ ] **Step 5: Wire critique execution and blocker**

Replace legacy `critiquePrompt` lookup with `reviewRegistry?.critique.effective`. Build request using:

```ts
body: JSON.stringify(buildCritiqueRequestBody(
  critiquePrompt.id,
  critiqueModel,
)),
```

Extend `GenerationData.generationMetadata` with `critiquePromptRevisionId?: string`. In `critiqueBlocked`, compare `g.generationMetadata?.critiquePromptRevisionId === critiquePrompt.id`; remove the legacy `promptId === "inline"` fallback.

- [ ] **Step 6: Wire both cards and correction execution**

Pass each card its effective prompt, revisions, binding/default IDs, loading/error, retry, saving flag, and `onRevisionChange={(value) => void changeReviewPrompt(kind, value)}`. Remove both delete callbacks.

Pass CorrectorSection:

```tsx
correctorPromptRevisionId={reviewRegistry?.corrector.effective?.id}
```

Remove legacy corrector prompt ID/content/user prompt props.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run:

```bash
rtk pnpm exec vitest run components/prompts/__tests__/review-prompt-registry.test.ts components/prompts/__tests__/review-prompt-sections.test.tsx components/prompts/__tests__/corrector-section.test.tsx lib/review/__tests__/request-payloads.test.ts lib/__tests__/review-prompt-cutover.test.ts --exclude '.claude/worktrees/**'
```

Expected: all tests PASS.

- [ ] **Step 8: Commit Task 4**

```bash
rtk git add app/projects/'[id]'/chapters/'[chapterId]'/page.tsx lib/__tests__/review-prompt-cutover.test.ts
rtk git commit -m "fix: preload project review prompts"
```

### Task 5: Full verification

**Files:**
- Verify all files changed in Tasks 1-4.

- [ ] **Step 1: Run TypeScript**

```bash
rtk pnpm typecheck
```

Expected: exit 0, no TypeScript errors.

- [ ] **Step 2: Run targeted ESLint**

```bash
rtk pnpm exec eslint components/prompts/review-prompt-registry.ts components/prompts/critique-prompt-section.tsx components/prompts/corrector-prompt-section.tsx components/prompts/corrector-section.tsx app/projects/'[id]'/chapters/'[chapterId]'/page.tsx components/prompts/__tests__/review-prompt-registry.test.ts components/prompts/__tests__/review-prompt-sections.test.tsx components/prompts/__tests__/corrector-section.test.tsx lib/review/request-payloads.ts lib/review/__tests__/request-payloads.test.ts lib/__tests__/review-prompt-cutover.test.ts
```

Expected: exit 0, no new errors.

- [ ] **Step 3: Run full Vitest suite**

```bash
rtk pnpm exec vitest run --exclude '.claude/worktrees/**' --maxWorkers=1
```

Expected: all test files and tests PASS.

- [ ] **Step 4: Run production build**

```bash
rtk pnpm build
```

Expected: exit 0 with successful Next.js production build.

- [ ] **Step 5: Check diff hygiene**

```bash
rtk git diff --check
```

Expected: exit 0 with no whitespace errors.

- [ ] **Step 6: Manual acceptance on affected project**

Open `/projects/07d1288f-a468-49c2-b9a5-b8f1a4ad7975/chapters/ed9630a0-1bcb-450f-97da-a23dbe33e498` and verify:

1. Critique shows global default `Critique v1.0`.
2. Corrector shows global default `Corrector v1.0`.
3. Selecting another Critique revision persists after reload and appears in another chapter.
4. `Use global default` clears the project override.
5. Critique request starts without `critiquePromptRevisionId is required`.
6. Correction request starts without `correctorPromptRevisionId is required`.
