import { generateCompletion } from "@/lib/ai/completion";
import { DEFAULT_GENERATION_MODEL, getProviderForModel } from "@/lib/ai/providers";
import type { ReasoningEffort } from "@/lib/ai/completion";

const DEFAULT_SYSTEM_PROMPT =
  "Escribe siempre en español. Responde únicamente con el contenido solicitado, sin introducciones ni comentarios adicionales.";

export function sanitizeValue(value: string): string {
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
  effort?: ReasoningEffort;
  /** Override the default system prompt. Defaults to Spanish-only output instruction. */
  systemPrompt?: string;
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

export function applyPlaceholders(content: string, placeholders: Record<string, string>): string {
  // Sort longest-first to prevent {foo} matching inside {foo_bar}
  const entries = Object.entries(placeholders).sort(
    ([a], [b]) => b.length - a.length,
  );
  for (const [name, value] of entries) {
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
  const {
    prompt,
    placeholders,
    model = DEFAULT_GENERATION_MODEL,
    temperature,
    effort,
    systemPrompt = DEFAULT_SYSTEM_PROMPT,
  } = params;
  const content = applyPlaceholders(prompt.content, placeholders);

  const result = await generateCompletion({
    model,
    systemPrompt,
    userPrompt: content,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(effort !== undefined ? { effort } : {}),
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
  effort?: ReasoningEffort,
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
    systemPrompt: "Eres un editor que ensambla capítulos de libros en español. Escribe siempre en español. Responde únicamente con el capítulo ensamblado, sin introducciones ni comentarios adicionales.",
    userPrompt: content,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(effort !== undefined ? { effort } : {}),
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
