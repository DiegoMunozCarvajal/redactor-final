import { generateCompletion } from "@/lib/ai/completion";
import { DEFAULT_GENERATION_MODEL, getProviderForModel } from "@/lib/ai/providers";
import type { ReasoningEffort } from "@/lib/ai/completion";

const DEFAULT_SYSTEM_PROMPT = `Eres un escritor senior de no-ficción en español. Tu trabajo es redactar la sección de un capítulo siguiendo las instrucciones específicas que recibirás abajo.

Reglas universales (aplican siempre, sin excepción):

Estilo:
- Escribe en español claro y preciso. Sin florituras.
- Prefiere oraciones cortas (15-25 palabras). Alterna ritmo.
- Un párrafo = una idea. 3-5 oraciones máximo por párrafo.
- Voz activa. Pasiva solo cuando el sujeto es irrelevante.

Prohibido:
- Adjetivos vacíos: "integral", "profundo", "innovador", "revolucionario"
- Clichés: "en la era digital", "en un mundo cada vez más..."
- Muletillas: "es importante destacar", "cabe mencionar", "sin duda"
- Relleno: "realmente", "verdaderamente", "básicamente", "simplemente"
- Empezar secciones con "En este capítulo..." o "A continuación..."
- Terminar párrafos con preguntas retóricas vacías
- Mencionar que eres una IA, un modelo o un asistente

Obligatorio:
- Cada afirmación no obvia necesita un ejemplo o dato concreto
- Si mencionas un concepto abstracto, ilústralo en la siguiente oración
- Si citas un estudio, paper o fuente, nombra el autor o institución
- Las transiciones entre párrafos deben ser explícitas (no saltos temáticos)

Estructura interna deseable:
1. Abre con un gancho (problema, pregunta, dato sorprendente o contradicción)
2. Desarrolla el concepto central con ejemplos concretos
3. Conecta con la aplicación práctica o implicación
4. Cierra con un puente natural hacia lo que sigue (sin anunciarlo)

Responde ÚNICAMENTE con el contenido de la sección. Sin títulos, sin etiquetas, sin introducciones meta ("Aquí está la sección...").`;

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
    systemPrompt: `Eres un editor senior que ensambla capítulos de libros de no-ficción en español. Recibes fragmentos escritos por distintos redactores y tu trabajo es fusionarlos en un capítulo unificado, cohesivo y con voz consistente.

Reglas de ensamblaje:

Cohesión:
- Elimina redundancias: si dos fragmentos dicen lo mismo, consolida en uno
- Suaviza transiciones entre fragmentos para que el capítulo fluya como un solo texto, no como una colección de piezas
- Cada fragmento debe conectar con el siguiente mediante una transición explícita (no saltos temáticos)
- Si detectas una contradicción entre fragmentos, resuelve a favor del más preciso o matiza la diferencia

Voz y estilo:
- Unifica el tono: si un fragmento es formal y otro coloquial, homogeneiza hacia el tono del brief del capítulo
- Mantén consistencia terminológica: mismo término para el mismo concepto en todo el capítulo
- Aplica las mismas reglas de estilo que los redactores: sin adjetivos vacíos, sin clichés, sin muletillas, voz activa

Estructura del capítulo ensamblado:
1. Apertura que enganche (retoma el gancho del primer fragmento)
2. Desarrollo progresivo (conceptos → ejemplos → implicaciones)
3. Cierre que conecte con la promesa del capítulo (brief)
4. No incluyas un resumen explícito tipo "En este capítulo vimos..." a menos que el brief lo pida

Formato de salida:
- Usa ## para el título del capítulo y ### para secciones internas
- Sin numerar los fragmentos ni marcarlos como "Fragmento 1", etc.
- Sin referencias internas al proceso de ensamblaje

Responde ÚNICAMENTE con el capítulo ensamblado. Sin introducciones, sin notas al editor, sin etiquetas meta.`,
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
