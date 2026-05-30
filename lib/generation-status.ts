const IN_FLIGHT_STATUSES = new Set(["pending", "generating", "assembling"]);
const DEFAULT_STALE_MS = 30 * 60 * 1000;

export interface GenerationStatusState {
  id: string;
  status: string;
  createdAt: string;
  generationMetadata?: {
    type?: string;
    promptId?: string;
    promptTitle?: string;
    model?: string;
    provider?: string;
    effort?: string;
  } | null;
}

export function isInFlightGeneration(
  generation: GenerationStatusState,
  now = Date.now(),
  staleMs = DEFAULT_STALE_MS,
): boolean {
  if (!IN_FLIGHT_STATUSES.has(generation.status)) return false;
  return now - new Date(generation.createdAt).getTime() < staleMs;
}

export function getActiveGeneration<T extends GenerationStatusState>(
  generations: T[],
  now = Date.now(),
  staleMs = DEFAULT_STALE_MS,
): T | undefined {
  return generations
    .filter((generation) => isInFlightGeneration(generation, now, staleMs))
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )[0];
}

export function getActivePromptGenerationByPromptId<T extends GenerationStatusState>(
  generations: T[],
  now = Date.now(),
  staleMs = DEFAULT_STALE_MS,
): Map<string, T> {
  const activeByPrompt = new Map<string, T>();
  const activeGenerations = generations
    .filter((generation) => isInFlightGeneration(generation, now, staleMs))
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

  for (const generation of activeGenerations) {
    const promptId = generation.generationMetadata?.type === "prompt"
      ? generation.generationMetadata.promptId
      : undefined;
    if (promptId && !activeByPrompt.has(promptId)) {
      activeByPrompt.set(promptId, generation);
    }
  }

  return activeByPrompt;
}
