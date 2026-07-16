export function legacyPromptLibraryTarget(tab?: string): string {
  const kind = tab === "critique" || tab === "corrector" ? tab : "assembly";
  return `/generation?kind=${kind}`;
}

export function legacyMetaPromptsTarget(): string {
  return "/generation?kind=template-generator";
}

export function legacyGenerationPromptsTarget(): string {
  return "/generation?kind=generation-system";
}

export function legacyPromptDetailTarget(): string {
  return "/generation";
}
