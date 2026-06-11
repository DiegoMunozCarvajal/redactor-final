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

- **Reencuadres afirmativos.** Evitas estructuras de contraste correctivo basadas en la fórmula "No es X, es Y". En su lugar, expresas la idea mediante afirmaciones directas, explicaciones causales o reformulaciones progresivas.
  > ❌ "No es falta de talento: es falta de práctica."
  > ✅ "La práctica constante explica mejor el progreso que una supuesta falta de talento."

## Ejemplo

Las reglas anteriores producen textos como este. Fíjate en cómo cada regla opera simultáneamente:

> La gente no abandona sus metas por falta de motivación. Las abandona por falta de un sistema. En un estudio de 2023, la Universidad de Stanford siguió a 800 personas que iniciaron una rutina de ejercicio y encontró que quienes planificaron un horario fijo semanal tuvieron el doble de adherencia a los seis meses, sin importar su nivel inicial de motivación.
>
> Si estás pensando "yo ya intenté planificar y no funcionó", esa experiencia es más común de lo que parece. La mayoría no falla por falta de intención, sino porque intenta organizarse con sistemas demasiado pesados para sostenerlos en la vida real.
>
> El tamaño del plan suele ser el punto donde todo empieza a romperse. La psicóloga BJ Fogg lo llama "la trampa de la motivación": cuando estás motivado, diseñas un plan para tu yo motivado. Pero tu yo del miércoles a las 6 AM no está motivado. Está cansado. Un plan de 30 minutos diarios de ejercicio falla en la primera semana para el 73% de las personas, según los datos de Fogg. Un plan de 5 minutos —hacer una lagartija, poner los tenis, salir a la puerta— sobrevive.

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

/** Assembly output scales with fragment count. Each fragment contributes ~2048 tokens.
 *  Base floor accounts for thinking overhead when effort is active. */
function assemblyMaxTokens(fragmentCount: number): number {
  return Math.max(32768, fragmentCount * 2048);
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
    // Escape $ to prevent special pattern interpretation in replaceAll ($&, $1, etc.)
    content = content.replaceAll(
      token,
      `<<${name.toUpperCase()}>>${sanitized.replace(/\$/g, "$$$$")}<</${name.toUpperCase()}>>`,
    );
  }
  // Fallback: if {tema} wasn't in the placeholder map but project has a topic, use it
  if (projectTopic && content.includes("{tema}") && !placeholders["tema"]) {
    const sanitized = sanitizeValue(projectTopic);
    content = content.replaceAll("{tema}", `<<TEMA>>${sanitized.replace(/\$/g, "$$$$")}<</TEMA>>`);
  }
  return content;
}

/** Strip <<NAME>>...<</NAME>> wrappers that applyPlaceholders inserts.
 *  LLMs sometimes reproduce these verbatim. Remove them from generated output. */
function stripPlaceholderWrappers(text: string): string {
  return text.replace(/<<([A-Z_]+)>>([\s\S]*?)<<\/\1>>/g, "$2");
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

  // Anthropic ephemeral cache: when userPrompt is set, prompt.content is the
  // static system prompt — cache it across calls within the 5-min TTL window.
  const isAnthropic = getProviderForModel(model) === "anthropic";
  const useCache = isAnthropic && !!prompt.userPrompt;

  const result = await generateCompletion({
    model,
    systemPrompt: useCache ? "" : effectiveSystemPrompt,
    userPrompt: content,
    ...(useCache ? { cachedSystemPrompt: prompt.content, cacheSystemPrompt: true } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(effort !== undefined ? { effort } : {}),
  });

  return {
    text: stripPlaceholderWrappers(result.data as string),
    model,
    provider: getProviderForModel(model),
    usage: {
      inputTokens: result.usage.promptTokens,
      outputTokens: result.usage.completionTokens,
    },
  };
}

async function mergeTwoFragments(
  a: { title?: string; content: string },
  b: { title?: string; content: string },
  assemblyPrompt: PromptLike,
  placeholders: Record<string, string>,
  model: string,
  temperature?: number,
  effort?: ReasoningEffort,
  maxTokens?: number,
): Promise<GenerateResult> {
  const systemPrompt = assemblyPrompt.userPrompt ? assemblyPrompt.content : "";
  let userContent = assemblyPrompt.userPrompt ?? assemblyPrompt.content;

  userContent = applyPlaceholders(userContent, placeholders, undefined);

  // {{SECCIONES_GENERADAS}} → XML format
  const fragmentsXml = `<secciones>\n<seccion id="1" nombre="${a.title || "Bloque 1"}">\n${a.content}\n</seccion>\n<seccion id="2" nombre="${b.title || "Bloque 2"}">\n${b.content}\n</seccion>\n</secciones>`;
  userContent = userContent.replace(
    /\{\{SECCIONES_GENERADAS\}\}/g,
    fragmentsXml.replace(/\$/g, "$$$$"),
  );

  // Legacy markers
  const fragmentsText = `### Fragment 1\n\n${a.content}\n\n---\n\n### Fragment 2\n\n${b.content}`;
  userContent = userContent.replace(
    /\[PEGAR AQUÍ TODOS LOS FRAGMENTOS DEL CAPÍTULO\]|\[PASTE ALL CHAPTER FRAGMENTS HERE\]/g,
    fragmentsText.replace(/\$/g, "$$$$"),
  );

  const effectiveMaxTokens = maxTokens ?? assemblyMaxTokens(2);

  // Anthropic ephemeral cache: the assemblyPrompt.content (system prompt) is static
  // across all merge calls in a chapter. Cache it to avoid re-sending every merge.
  const isAnthropic = getProviderForModel(model) === "anthropic";
  const useCache = isAnthropic && !!assemblyPrompt.userPrompt;

  const result = await generateCompletion({
    model,
    systemPrompt: useCache ? "" : systemPrompt,
    userPrompt: userContent,
    maxTokens: effectiveMaxTokens,
    ...(useCache ? { cachedSystemPrompt: assemblyPrompt.content, cacheSystemPrompt: true } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(effort !== undefined ? { effort } : {}),
  });

  return {
    text: stripPlaceholderWrappers(result.data as string),
    model,
    provider: getProviderForModel(model),
    usage: {
      inputTokens: result.usage.promptTokens,
      outputTokens: result.usage.completionTokens,
    },
  };
}

export async function generateChapterAssemblyHierarchical(
  assemblyPrompt: PromptLike,
  fragments: { title?: string; content: string }[],
  placeholders: Record<string, string>,
  model = DEFAULT_GENERATION_MODEL,
  temperature?: number,
  effort?: ReasoningEffort,
  maxTokens?: number,
): Promise<GenerateResult> {
  if (fragments.length === 0) {
    throw new Error("No fragments to assemble");
  }

  if (fragments.length === 1) {
    return {
      text: fragments[0].content,
      model,
      provider: getProviderForModel(model),
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  // Build merge tree bottom-up
  let currentLevel: Array<{ title?: string; content: string }> = fragments.map((f) => ({ title: f.title, content: f.content }));
  const totalUsage = { inputTokens: 0, outputTokens: 0 };

  while (currentLevel.length > 1) {
    const nextLevel: Array<{ title?: string; content: string }> = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      if (i + 1 < currentLevel.length) {
        const result = await mergeTwoFragments(
          currentLevel[i],
          currentLevel[i + 1],
          assemblyPrompt,
          placeholders,
          model,
          temperature,
          effort,
          maxTokens,
        );
        nextLevel.push({ content: result.text });
        totalUsage.inputTokens += result.usage.inputTokens;
        totalUsage.outputTokens += result.usage.outputTokens;
      } else {
        nextLevel.push(currentLevel[i]);
      }
    }

    currentLevel = nextLevel;
  }

  return {
    text: currentLevel[0].content,
    model,
    provider: getProviderForModel(model),
    usage: totalUsage,
  };
}

export async function generateChapterAssemblyHalves(
  assemblyPrompt: PromptLike,
  fragments: { title?: string; content: string }[],
  placeholders: Record<string, string>,
  model = DEFAULT_GENERATION_MODEL,
  temperature?: number,
  effort?: ReasoningEffort,
  maxTokens?: number,
): Promise<GenerateResult> {
  if (fragments.length === 0) {
    throw new Error("No fragments to assemble");
  }

  if (fragments.length === 1) {
    return {
      text: fragments[0].content,
      model,
      provider: getProviderForModel(model),
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  if (fragments.length === 2) {
    return mergeTwoFragments(
      fragments[0], fragments[1],
      assemblyPrompt, placeholders, model, temperature, effort, maxTokens,
    );
  }

  const totalUsage = { inputTokens: 0, outputTokens: 0 };

  // Split into two roughly equal halves
  const mid = Math.floor(fragments.length / 2);
  const leftFragments = fragments.slice(0, mid);
  const rightFragments = fragments.slice(mid);

  // Assemble each half in one shot using the full assembly prompt
  const assembleHalf = async (
    half: { title?: string; content: string }[],
  ): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } }> => {
    if (half.length === 1) {
      return { text: half[0].content, usage: { inputTokens: 0, outputTokens: 0 } };
    }
    const result = await generateChapterAssembly(
      assemblyPrompt, half, placeholders,
      model, temperature, effort, maxTokens,
    );
    return { text: result.text, usage: result.usage };
  };

  const leftResult = await assembleHalf(leftFragments);
  totalUsage.inputTokens += leftResult.usage.inputTokens;
  totalUsage.outputTokens += leftResult.usage.outputTokens;

  const rightResult = await assembleHalf(rightFragments);
  totalUsage.inputTokens += rightResult.usage.inputTokens;
  totalUsage.outputTokens += rightResult.usage.outputTokens;

  // Merge the two assembled halves
  const merged = await mergeTwoFragments(
    { content: leftResult.text },
    { content: rightResult.text },
    assemblyPrompt, placeholders, model, temperature, effort, maxTokens,
  );
  totalUsage.inputTokens += merged.usage.inputTokens;
  totalUsage.outputTokens += merged.usage.outputTokens;

  return {
    text: merged.text,
    model,
    provider: getProviderForModel(model),
    usage: totalUsage,
  };
}

export type AssemblyAlgorithm = "merge-sort" | "sequential" | "halves";

export async function generateChapterAssemblySequential(
  assemblyPrompt: PromptLike,
  fragments: { title?: string; content: string }[],
  placeholders: Record<string, string>,
  model = DEFAULT_GENERATION_MODEL,
  temperature?: number,
  effort?: ReasoningEffort,
  maxTokens?: number,
): Promise<GenerateResult> {
  if (fragments.length === 0) {
    throw new Error("No fragments to assemble");
  }

  if (fragments.length === 1) {
    return {
      text: fragments[0].content,
      model,
      provider: getProviderForModel(model),
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  let accumulator = { content: fragments[0].content };
  const totalUsage = { inputTokens: 0, outputTokens: 0 };

  for (let i = 1; i < fragments.length; i++) {
    const result = await mergeTwoFragments(
      accumulator,
      { title: fragments[i].title, content: fragments[i].content },
      assemblyPrompt,
      placeholders,
      model,
      temperature,
      effort,
      maxTokens,
    );
    accumulator = { content: result.text };
    totalUsage.inputTokens += result.usage.inputTokens;
    totalUsage.outputTokens += result.usage.outputTokens;
  }

  return {
    text: accumulator.content,
    model,
    provider: getProviderForModel(model),
    usage: totalUsage,
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
  // Escape $ in replacement to prevent special pattern interpretation ($&, $1, etc.)
  content = content.replace(
    /\{\{SECCIONES_GENERADAS\}\}/g,
    fragmentsXml.replace(/\$/g, "$$$$"),
  );

  // Legacy markers → old format (backward compat)
  content = content.replace(
    /\[PEGAR AQUÍ TODOS LOS FRAGMENTOS DEL CAPÍTULO\]|\[PASTE ALL CHAPTER FRAGMENTS HERE\]/g,
    fragmentsText.replace(/\$/g, "$$$$"),
  );

  const effectiveMaxTokens = maxTokens ?? assemblyMaxTokens(fragments.length);

  // Anthropic ephemeral cache: system prompt (assemblyPrompt.content) is static
  const isAnthropic = getProviderForModel(model) === "anthropic";
  const useCache = isAnthropic && !!assemblyPrompt.userPrompt;

  const result = await generateCompletion({
    model,
    systemPrompt: useCache ? "" : effectiveSystemPrompt,
    userPrompt: content,
    maxTokens: effectiveMaxTokens,
    ...(useCache ? { cachedSystemPrompt: assemblyPrompt.content, cacheSystemPrompt: true } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(effort !== undefined ? { effort } : {}),
  });

  return {
    text: stripPlaceholderWrappers(result.data as string),
    model,
    provider: getProviderForModel(model),
    usage: {
      inputTokens: result.usage.promptTokens,
      outputTokens: result.usage.completionTokens,
    },
  };
}

export interface GenerateCritiqueParams {
  critiquePrompt: PromptLike;
  content: string;
  placeholders: Record<string, string>;
  model?: string;
  temperature?: number;
  effort?: ReasoningEffort;
  maxTokens?: number;
  projectTopic?: string | null;
}

/** Critique output scales with content length. Each ~1024 chars contributes ~1024 tokens. */
function critiqueMaxTokens(contentLength: number): number {
  return Math.max(8192, Math.ceil(contentLength / 4) + 4096);
}

export async function generateChapterCritique(
  params: GenerateCritiqueParams,
): Promise<GenerateResult> {
  const {
    critiquePrompt,
    content: chapterContent,
    placeholders,
    model = DEFAULT_GENERATION_MODEL,
    temperature,
    effort,
    maxTokens,
    projectTopic,
  } = params;

  const effectiveSystemPrompt = critiquePrompt.userPrompt
    ? critiquePrompt.content
    : "";
  const userContent = critiquePrompt.userPrompt ?? critiquePrompt.content;

  let processedUserContent = applyPlaceholders(userContent, placeholders, projectTopic);

  // Replace content placeholder with the actual chapter content
  processedUserContent = processedUserContent.replace(
    /\{\{CONTENIDO_CAPITULO\}\}/g,
    chapterContent.replace(/\$/g, "$$$$"),
  );
  processedUserContent = processedUserContent.replace(
    /\[PEGAR AQUÍ EL CAPÍTULO A CRITICAR\]|\[PEGAR AQUÍ EL CAPÍTULO COMPLETO\]/g,
    chapterContent.replace(/\$/g, "$$$$"),
  );

  const effectiveMaxTokens = maxTokens ?? critiqueMaxTokens(chapterContent.length);

  // Anthropic ephemeral cache: when userPrompt is set, critiquePrompt.content
  // is the static system prompt — cache it across critique calls.
  const isAnthropic = getProviderForModel(model) === "anthropic";
  const useCache = isAnthropic && !!critiquePrompt.userPrompt;

  const result = await generateCompletion({
    model,
    systemPrompt: useCache ? "" : effectiveSystemPrompt,
    userPrompt: processedUserContent,
    maxTokens: effectiveMaxTokens,
    ...(useCache ? { cachedSystemPrompt: critiquePrompt.content, cacheSystemPrompt: true } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(effort !== undefined ? { effort } : {}),
  });

  return {
    text: stripPlaceholderWrappers(result.data as string),
    model,
    provider: getProviderForModel(model),
    usage: {
      inputTokens: result.usage.promptTokens,
      outputTokens: result.usage.completionTokens,
    },
  };
}
