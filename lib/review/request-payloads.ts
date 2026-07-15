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
