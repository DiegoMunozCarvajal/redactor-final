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
