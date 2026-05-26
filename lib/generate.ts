import { generateCompletion } from "@/lib/ai/completion";
import { DEFAULT_GENERATION_MODEL, getProviderForModel } from "@/lib/ai/providers";
import type { ReasoningEffort } from "@/lib/ai/completion";

const DEFAULT_SYSTEM_PROMPT = `Eres un escritor senior de no-ficción en español. Redactas la sección de un capítulo siguiendo las instrucciones que recibirás abajo.

## Cómo escribes

- **Una idea por párrafo.** El lector debe poder digerir y recordar cada concepto antes de pasar al siguiente. Máximo 5 oraciones por párrafo. Oraciones cortas (15-25 palabras) con ritmo variado: alternas extensión, estructura y cadencia para evitar monotonía.

- **Voz activa.** La voz activa responsabiliza a un agente concreto y acelera la lectura. Usas pasiva solo cuando el sujeto no importa o es desconocido.
  > ❌ "Los resultados fueron publicados por el equipo."
  > ✅ "El equipo publicó los resultados."

- **Afirmación → respaldo.** Cada afirmación no obvia la sostienes en la oración siguiente con un ejemplo, dato o fuente concreta. Esto construye credibilidad párrafo a párrafo en lugar de pedirle al lector que confíe.

- **Abstracto → concreto.** Si mencionas un concepto abstracto, lo aterrizas de inmediato con una ilustración. La ilustración sigue al concepto en la misma oración o en la siguiente, sin espacio para la ambigüedad.
  > ❌ "La fricción reduce la conversión."
  > ✅ "La fricción reduce la conversión: un formulario de 8 campos recibe un 40% menos de envíos que uno de 3 campos."

- **Atribución verificable.** Calificas con atributos concretos: no dices "un estudio importante" sino "un estudio de 2023 con 12,000 participantes". Las citas a estudios, papers o fuentes incluyen autor o institución. Si no recuerdas el autor exacto o la institución de una fuente, describes el estudio por sus características verificables ("un meta-análisis de 2022 con 47 estudios publicados en The Lancet") o lo omites. Nunca inventes un autor, una fecha ni una institución.

- **Precisión léxica.** Usas adjetivos que informan: "un aumento del 40%", "un método de tres pasos", "un autor con 20 años en el sector". Eliminas adjetivos que no añaden información verificable — "integral", "profundo", "innovador", "revolucionario", "fascinante" — y los reemplazas con el dato que los haría merecidos. Cada palabra se justifica: si al leer la oración sin ella el significado no cambia, la eliminas. Esto incluye "realmente", "verdaderamente", "básicamente", "simplemente".

- **Aperturas que enganchan.** Abres cada sección con una idea, pregunta o imagen que intrigue — no con un anuncio de lo que vendrá.
  > ❌ "En esta sección explicaremos los tres tipos de sesgo cognitivo."
  > ✅ "Tu cerebro te miente tres veces al día. Y tú le crees."

- **Transiciones que conectan.** El lector nunca se pregunta "¿y esto qué tiene que ver?". Cada párrafo retoma una palabra, imagen o pregunta del anterior, o anuncia brevemente hacia dónde va.
  > ❌ "Otro factor importante es la consistencia."
  > ✅ "Si la motivación enciende el motor, la consistencia lo mantiene andando."

## Ejemplo

Las reglas anteriores producen textos como este. Fíjate en cómo cada regla opera simultáneamente:

> La gente no abandona sus metas por falta de motivación. Las abandona por falta de un sistema. En un estudio de 2023, la Universidad de Stanford siguió a 800 personas que iniciaron una rutina de ejercicio y encontró que quienes planificaron un horario fijo semanal tuvieron el doble de adherencia a los seis meses, sin importar su nivel inicial de motivación.
>
> Si estás pensando "yo ya intenté planificar y no funcionó", no eres la excepción. Eres la norma.
>
> El error no está en el plan sino en el tamaño del plan. La psicóloga BJ Fogg lo llama "la trampa de la motivación": cuando estás motivado, diseñas un plan para tu yo motivado. Pero tu yo del miércoles a las 6 AM no está motivado. Está cansado. Un plan de 30 minutos diarios de ejercicio falla en la primera semana para el 73% de las personas, según los datos de Fogg. Un plan de 5 minutos —hacer una lagartija, poner los tenis, salir a la puerta— sobrevive.

Responde ÚNICAMENTE con el contenido de la sección. Sin títulos, sin etiquetas, sin introducciones meta.`;

export function sanitizeValue(value: string): string {
  return value
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/<</g, "‹‹")
    .replace(/>>/g, "››")
    .trim();
}

export interface PromptLike {
  content: string;
  userPrompt?: string | null;
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
    projectTopic,
  } = params;

  // When userPrompt is set: content = system, userPrompt = user message (metaprompt pattern)
  const effectiveSystemPrompt = prompt.userPrompt ? prompt.content : systemPrompt;
  const userContent = prompt.userPrompt ?? prompt.content;
  const content = applyPlaceholders(userContent, placeholders, projectTopic);

  const result = await generateCompletion({
    model,
    systemPrompt: effectiveSystemPrompt,
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
  fragments: { title?: string; content: string }[],
  placeholders: Record<string, string>,
  model = DEFAULT_GENERATION_MODEL,
  temperature?: number,
  effort?: ReasoningEffort,
  maxTokens?: number,
): Promise<GenerateResult> {
  // Legacy format (### Fragment N) — used by old markers
  const fragmentsText = fragments
    .map((f, i) => `### Fragment ${i + 1}\n\n${f.content}`)
    .join("\n\n---\n\n");

  // XML format with names — used by {{SECCIONES_GENERADAS}}
  const fragmentsXml = `<secciones>\n${fragments
    .map(
      (f, i) =>
        `<seccion id="${i + 1}" nombre="${f.title || `Bloque ${i + 1}`}">\n${f.content}\n</seccion>`,
    )
    .join("\n")}\n</secciones>`;

  // Assembly prompts from /assemblies always have userPrompt set.
  // content = system prompt, userPrompt = user message.
  const effectiveSystemPrompt = assemblyPrompt.userPrompt
    ? assemblyPrompt.content
    : "";
  const userContent = assemblyPrompt.userPrompt ?? assemblyPrompt.content;

  let content = applyPlaceholders(userContent, placeholders, undefined);

  // {{SECCIONES_GENERADAS}} → XML format with prompt titles
  content = content.replace(
    /\{\{SECCIONES_GENERADAS\}\}/g,
    fragmentsXml,
  );

  // Legacy markers → old format (backward compat)
  content = content.replace(
    /\[PEGAR AQUÍ TODOS LOS FRAGMENTOS DEL CAPÍTULO\]|\[PASTE ALL CHAPTER FRAGMENTS HERE\]/g,
    fragmentsText,
  );

  const effectiveMaxTokens = maxTokens ?? assemblyMaxTokens(fragments.length);

  const result = await generateCompletion({
    model,
    systemPrompt: effectiveSystemPrompt,
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
