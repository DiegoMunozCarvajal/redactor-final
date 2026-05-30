export interface GenerationErrorState {
  status: string;
  error: string | null;
  createdAt: string;
}

export function getLatestGenerationError(
  generations: GenerationErrorState[],
): string | null {
  const latest = generations.reduce<GenerationErrorState | null>((current, generation) => {
    if (!current) return generation;
    return new Date(generation.createdAt).getTime() > new Date(current.createdAt).getTime()
      ? generation
      : current;
  }, null);

  return latest?.status === "failed" ? latest.error : null;
}
