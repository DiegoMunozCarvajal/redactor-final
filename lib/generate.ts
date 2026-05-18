import { generateCompletion } from "@/lib/ai/completion";
import { DEFAULT_GENERATION_MODEL, getProviderForModel } from "@/lib/ai/providers";

function sanitizeTopic(topic: string): string {
  // Strip control characters and prevent delimiter injection
  return topic
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/<</g, "‹‹")
    .replace(/>>/g, "››")
    .trim();
}

export interface PromptLike {
  content: string;
  styleRules: string | null;
  knowledgeAreas: string | null;
  suggestedLength: string | null;
}

export interface GeneratePromptParams {
  prompt: PromptLike;
  topic: string;
  subtitle?: string | null;
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
  const { prompt, topic, subtitle, model = DEFAULT_GENERATION_MODEL } = params;
  let content = prompt.content.replace(/\[TEMA\]/g, `<<TEMA>>${sanitizeTopic(topic)}<</TEMA>>`);
  if (subtitle) {
    content = content.replace(/\[SUBTÍTULO\]/g, `<<SUBTÍTULO>>${sanitizeTopic(subtitle)}<</SUBTÍTULO>>`);
  }

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
  subtitle?: string | null,
  model = DEFAULT_GENERATION_MODEL,
): Promise<GenerateResult> {
  const fragmentsText = fragments
    .map((f, i) => `### Fragmento ${i + 1} (${f.type})\n\n${f.content}`)
    .join("\n\n---\n\n");

  let content = assemblyPrompt.content
    .replace(/\[TEMA\]/g, `<<TEMA>>${sanitizeTopic(topic)}<</TEMA>>`)
    .replace(
      /\[PEGAR AQUÍ TODOS LOS FRAGMENTOS DEL CAPÍTULO\]/g,
      fragmentsText,
    );
  if (subtitle) {
    content = content.replace(/\[SUBTÍTULO\]/g, `<<SUBTÍTULO>>${sanitizeTopic(subtitle)}<</SUBTÍTULO>>`);
  }

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
