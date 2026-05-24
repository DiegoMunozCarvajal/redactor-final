import { generateCompletion } from "@/lib/ai/completion";
import { DEFAULT_GENERATION_MODEL, getProviderForModel } from "@/lib/ai/providers";
import type { ReasoningEffort } from "@/lib/ai/completion";

const DEFAULT_SYSTEM_PROMPT = `Eres un escritor senior de no-ficción en español. Redactas la sección de un capítulo siguiendo las instrucciones que recibirás abajo.

Cómo escribes:
- Español claro y preciso. Oraciones cortas (15-25 palabras) con ritmo variado.
- Un párrafo = una idea. Máximo 5 oraciones por párrafo.
- Voz activa. Usas pasiva solo cuando el sujeto no importa.
- Cada afirmación no obvia la respaldas con un ejemplo, dato o fuente concreta en la oración siguiente.
- Si mencionas un concepto abstracto, lo aterrizas de inmediato con una ilustración.
- Las citas a estudios, papers o fuentes incluyen autor o institución.
- Las transiciones entre párrafos son explícitas: el lector nunca se pregunta "¿y esto qué tiene que ver?".
- Calificas con atributos verificables: no dices "un estudio importante" sino "un estudio de 2023 con 12,000 participantes".

Qué evitas:
- Adjetivos que no informan: "integral", "profundo", "innovador", "revolucionario", "fascinante".
- Relleno: "realmente", "verdaderamente", "básicamente", "simplemente".
- Aperturas que anuncian en vez de enganchar: "En este capítulo...", "A continuación...".

Responde ÚNICAMENTE con el contenido de la sección. Sin títulos, sin etiquetas, sin introducciones meta.`;

const ASSEMBLY_SYSTEM_PROMPT = `Eres un editor senior que ensambla capítulos de libros de no-ficción en español. Recibes fragmentos escritos por distintos redactores y tu trabajo es fusionarlos en un capítulo unificado, cohesivo y con voz consistente.

Cómo trabajas:
- Eliminas redundancias. Fragmentos que dicen lo mismo se consolidan en uno solo.
- Tejes transiciones explícitas entre fragmentos. El lector nunca siente que pasó de un tema a otro sin aviso.
- Si hay contradicción entre fragmentos, resuelves a favor del más preciso o matizas la diferencia.
- Organizas el contenido en la secuencia lógica que mejor sirva al brief del capítulo: de lo general a lo específico, de lo simple a lo complejo, o la estructura que los propios fragmentos sugieran.

Voz y estilo:
- Unificas el tono hacia lo que pide el brief del capítulo.
- Consistencia terminológica: mismo término para el mismo concepto en todo el capítulo.
- Sin adjetivos vacíos, sin clichés, sin muletillas, voz activa.

Formato:
- ## para el título del capítulo, ### para secciones internas.
- Sin marcas de fragmentos ("Fragmento 1"), sin referencias al proceso de ensamblaje.

Responde ÚNICAMENTE con el capítulo ensamblado. Sin introducciones, sin notas al editor.`;

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
  maxTokens?: number;
  effort?: ReasoningEffort;
  /** Override the default system prompt. Defaults to Spanish-only output instruction. */
  systemPrompt?: string;
  /** Chapter brief content. Injected into the user prompt as context when provided. */
  chapterBrief?: string;
  /** Project topic. Used as fallback when {tema} placeholder has no definition. */
  projectTopic?: string | null;
}

/** Assembly output scales with fragment count. Each fragment contributes ~1024 tokens. */
function assemblyMaxTokens(fragmentCount: number): number {
  return Math.max(16384, fragmentCount * 1024);
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

export function applyPlaceholders(content: string, placeholders: Record<string, string>, projectTopic?: string | null): string {
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
  // Fallback: if {tema} wasn't in the placeholder map but project has a topic, use it
  if (projectTopic && content.includes("{tema}") && !placeholders["tema"]) {
    const sanitized = sanitizeValue(projectTopic);
    content = content.replaceAll("{tema}", `<<TEMA>>${sanitized}<</TEMA>>`);
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
    maxTokens,
    effort,
    systemPrompt = DEFAULT_SYSTEM_PROMPT,
    chapterBrief,
    projectTopic,
  } = params;
  let content = applyPlaceholders(prompt.content, placeholders, projectTopic);

  // Prepend chapter brief as context when available
  if (chapterBrief) {
    content = `## Contexto del capítulo\nBrief: ${chapterBrief}\n\n## Instrucción específica\n${content}`;
  }

  const result = await generateCompletion({
    model,
    systemPrompt,
    userPrompt: content,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
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
  maxTokens?: number,
  chapterBrief?: string,
): Promise<GenerateResult> {
  const fragmentsText = fragments
    .map((f, i) => `### Fragment ${i + 1}\n\n${f.content}`)
    .join("\n\n---\n\n");

  let content = applyPlaceholders(assemblyPrompt.content, placeholders, undefined);
  content = content.replace(
    /\[PEGAR AQUÍ TODOS LOS FRAGMENTOS DEL CAPÍTULO\]|\[PASTE ALL CHAPTER FRAGMENTS HERE\]/g,
    fragmentsText,
  );

  // Prepend chapter brief context when available
  if (chapterBrief) {
    content = `## Brief del capítulo\n${chapterBrief}\n\n${content}`;
  }

  const effectiveMaxTokens = maxTokens ?? assemblyMaxTokens(fragments.length);

  const result = await generateCompletion({
    model,
    systemPrompt: ASSEMBLY_SYSTEM_PROMPT,
    userPrompt: content,
    maxTokens: effectiveMaxTokens,
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
