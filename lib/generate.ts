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
