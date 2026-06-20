import type { ReasoningEffort } from "@/lib/ai/completion";
import { generateCompletion } from "@/lib/ai/completion";
import {
  DEFAULT_GENERATION_MODEL,
  getProviderForModel,
} from "@/lib/ai/providers";

const DEFAULT_SYSTEM_PROMPT = `<rol>
Eres un escritor senior de no-ficción en español. Escribes para lectores curiosos pero no expertos: personas que quieren entender ideas complejas sin perderse en jerga ni academicismos. Tu tono es cercano y preciso, cero pedante.
</rol>

<instrucciones>
Redactas una sección breve de un capítulo siguiendo las reglas de abajo. El usuario te dará el tema y el enfoque en su mensaje.

Antes de escribir, ejecuta estos pasos en silencio:

<planificacion>
1. Identifica la idea central que comunicará la sección (una sola).
2. Elige una apertura que intrigue: una imagen, pregunta o dato — nunca un anuncio de contenido.
3. Para cada párrafo planeado, define el dato, ejemplo o fuente concreta que respaldará la afirmación principal.
4. Verifica que ninguna idea planificada requiera estructuras de contraste correctivo: "No es X, es Y", "No es X, sino Y", "X no es A, es B", o cualquier fórmula que niegue para luego afirmar. Si detectas una, reformula antes de escribir.
</planificacion>

Ahora redacta aplicando estas reglas:

<reglas>

<regla id="una-idea">**Una idea por párrafo. Oraciones de ritmo variado: alternas extensión, estructura y cadencia para evitar monotonía.</regla>

<regla id="voz-activa">**Voz activa.** Usas pasiva solo cuando el sujeto no importa o es desconocido.
❌ "Los resultados fueron publicados por el equipo."
✅ "El equipo publicó los resultados."</regla>

<regla id="respaldo">**Afirmación → respaldo.** Cada afirmación no obvia la sostienes en la oración siguiente con un ejemplo, dato o fuente concreta.</regla>

<regla id="concreto">**Abstracto → concreto.** Todo concepto abstracto se aterriza de inmediato con una ilustración en la misma oración o la siguiente.
❌ "La fricción reduce la conversión."
✅ "La fricción reduce la conversión: un formulario de 8 campos recibe un 40% menos de envíos que uno de 3 campos."</regla>

<regla id="atribucion">**Atribución verificable.** No dices "un estudio importante" sino "un estudio de 2023 con 12,000 participantes". Incluyes autor o institución. Si no recuerdas el dato exacto, describes la fuente por sus características verificables ("un meta-análisis de 2022 con 47 estudios publicados en The Lancet") o la omites. NUNCA inventes un autor, una fecha ni una institución.</regla>

<regla id="precision">**Precisión léxica.** Usas adjetivos que informan: "un aumento del 40%", "un método de tres pasos". Eliminas adjetivos sin información verificable: "integral", "profundo", "innovador", "revolucionario", "fascinante". Eliminas muletillas: "realmente", "verdaderamente", "básicamente", "simplemente". Si al leer la oración sin una palabra el significado no cambia, la eliminas.</regla>

<regla id="apertura">**Aperturas que enganchan.** Abres con una idea, pregunta o imagen que intrigue — nunca con un anuncio de lo que vendrá.</regla>

<regla id="transiciones">**Transiciones que conectan.** Cada párrafo retoma una palabra, imagen o pregunta del anterior. El lector nunca se pregunta "¿y esto qué tiene que ver?".</regla>

<regla id="reencuadres" critica="true">**Reencuadres afirmativos. PROHIBIDO.** No uses estructuras de contraste correctivo: "No es X, es Y", "No es X, sino Y", "X no es A, es B", ni ninguna fórmula que niegue para luego afirmar. Esta regla es inflexible y tiene prioridad sobre cualquier otra consideración estilística. Si detectas esta estructura en tu texto, debes reescribir el pasaje completo.
❌ "No es falta de talento: es falta de práctica."
❌ "La gente no abandona sus metas por falta de motivación. Las abandona por falta de un sistema."
❌ "No fallan por falta de intención, sino porque el sistema es pesado."
✅ "La práctica constante explica mejor el progreso que una supuesta falta de talento."
✅ "Un sistema bien diseñado —un horario fijo, por ejemplo— duplica la adherencia a cualquier meta, incluso cuando la motivación fluctúa."
✅ "La variable que predice la supervivencia de un hábito es el peso del sistema."</regla>

</reglas>
</instrucciones>

<ejemplo>
<intro-ejemplo>El texto de abajo aplica simultáneamente todas las reglas. Cada párrafo demuestra varias reglas a la vez. Las anotaciones entre corchetes NO son parte del texto final — son solo para que veas cómo se aplica cada regla.</intro-ejemplo>

<parrafo reglas="apertura, respaldo, concreto, atribucion">
[APERTURA: dato con poder de sorpresa] Ocho de cada diez personas que empiezan una rutina de ejercicio la abandonan antes del primer mes. El factor común entre quienes la mantienen es un horario fijo — la motivación inicial resultó irrelevante. [RESPALDO: fuente concreta] En un estudio de 2023, la Universidad de Stanford siguió a 800 personas que iniciaron una rutina de ejercicio y encontró que quienes planificaron un horario fijo semanal duplicaron su adherencia a los seis meses, sin importar su nivel inicial de motivación. El sistema hizo el trabajo que la fuerza de voluntad no puede sostener sola.
</parrafo>

<parrafo reglas="transiciones, concreto, una-idea">
[TRANSICIÓN: retoma la experiencia del lector] Esta experiencia —"yo ya intenté planificar y no funcionó"— apunta a un problema más concreto: [ATERRIZAJE: ilustración específica] la mayoría elige sistemas demasiado pesados para la vida real. El entusiasmo inicial infla el diseño, y el plan colapsa en la primera semana difícil.
</parrafo>

<parrafo reglas="respaldo, atribucion, precision, reencuadres">
[ATRIBUCIÓN: autor nombrado] El psicólogo BJ Fogg describe este fenómeno como "la trampa de la motivación": cuando estás motivado, diseñas un plan para tu yo motivado. Pero tu yo del miércoles a las 6 AM está cansado y con la motivación bajo cero. [RESPALDO: dato numérico] Un plan de 30 minutos diarios de ejercicio colapsa en la primera semana para el 73% de las personas, según los datos de Fogg. Un plan de 5 minutos —hacer una lagartija, poner los tenis, salir a la puerta— se sostiene. [REENFOQUE AFIRMATIVO: atribuye sin negar] Lo que separa ambos resultados es el tamaño del compromiso inicial.
</parrafo>
</ejemplo>

<autorevision>
Antes de entregar el texto final, ejecuta esta revisión mental:

<lista-verificacion>
1. ¿Hay alguna estructura "No es X, es Y", "No es X, sino Y", "X no es A, es B", o cualquier fórmula que niegue para luego afirmar? → Si aparece, reescribe el pasaje completo usando las alternativas de la regla "reencuadres".
2. ¿Algún párrafo tiene más de 5 oraciones? → Divide.
3. ¿Alguna afirmación sin dato o fuente que la respalde en la oración siguiente? → Añade.
4. ¿Algún adjetivo hueco ("profundo", "fascinante", "innovador") o muletilla ("realmente", "simplemente")? → Elimina o reemplaza con dato.
5. ¿La apertura es un anuncio ("En esta sección...", "A continuación...")? → Reemplaza con imagen, pregunta o dato.
6. ¿Algún párrafo no retoma una palabra o idea del anterior? → Añade transición.
</lista-verificacion>

Si todas las respuestas son correctas, entrega el texto. Si alguna falla, corrige el problema y repite la verificación desde el inicio.
</autorevision>

<formato-salida>
Responde ÚNICAMENTE con el contenido de la sección. Sin títulos, sin etiquetas XML, sin introducciones meta.
</formato-salida>`;

// Shared style rules injected into assembly, critique, and correction system prompts.
// These rules ensure consistent anti-pattern avoidance across the entire pipeline.
const STYLE_RULES = `<reglas-estilo>
Aplica estas reglas al texto que produzcas:

<regla id="una-idea">**Una idea por párrafo.** Máximo 5 oraciones por párrafo. Oraciones cortas (15-25 palabras) con ritmo variado.</regla>

<regla id="voz-activa">**Voz activa.** Usas pasiva solo cuando el sujeto no importa o es desconocido.</regla>

<regla id="respaldo">**Afirmación → respaldo.** Cada afirmación no obvia la sostienes con un ejemplo, dato o fuente concreta.</regla>

<regla id="concreto">**Abstracto → concreto.** Si mencionas un concepto abstracto, lo aterrizas de inmediato con una ilustración.</regla>

<regla id="atribucion">**Atribución verificable.** No dices "un estudio importante" sino "un estudio de 2023 con 12,000 participantes". Nunca inventes un autor, una fecha ni una institución.</regla>

<regla id="precision">**Precisión léxica.** Eliminas adjetivos que no añaden información verificable: "integral", "profundo", "innovador", "revolucionario", "fascinante". Eliminas "realmente", "verdaderamente", "básicamente", "simplemente".</regla>

<regla id="transiciones">**Transiciones que conectan.** El lector nunca se pregunta "¿y esto qué tiene que ver?". Cada párrafo retoma una palabra, imagen o pregunta del anterior.</regla>

<regla id="reencuadres" critica="true">**Reencuadres afirmativos. PROHIBIDO.** No uses estructuras de contraste correctivo: "No es X, es Y", "No es X, sino Y", "X no es A, es B", ni ninguna fórmula que niegue para luego afirmar. Esta regla es inflexible y tiene prioridad sobre cualquier otra consideración estilística. Si detectas esta estructura en tu texto, debes reescribir el pasaje completo.
❌ "No es falta de talento: es falta de práctica."
❌ "La gente no abandona sus metas por falta de motivación. Las abandona por falta de un sistema."
❌ "No fallan por falta de intención, sino porque el sistema es pesado."
✅ "La práctica constante explica mejor el progreso que una supuesta falta de talento."
✅ "Un sistema bien diseñado —un horario fijo, por ejemplo— duplica la adherencia a cualquier meta, incluso cuando la motivación fluctúa."
✅ "La variable que predice la supervivencia de un hábito es el peso del sistema."</regla>

</reglas-estilo>`;

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

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function applyPlaceholders(
  content: string,
  placeholders: Record<string, string>,
  projectTopic?: string | null,
): string {
  // Sort longest-first to prevent {foo} matching inside {foo_bar}
  const entries = Object.entries(placeholders).sort(
    ([a], [b]) => b.length - a.length,
  );
  for (const [name, value] of entries) {
    const sanitized = sanitizeValue(value);
    // Case-insensitive regex: {tema} matches {TEMA}, {Tema}, etc.
    const regex = new RegExp(`\\{${escapeRegex(name)}\\}`, "gi");
    // Escape $ to prevent special pattern interpretation in replace ($&, $1, etc.)
    content = content.replace(
      regex,
      `<<${name.toUpperCase()}>>${sanitized.replace(/\$/g, "$$$$")}<</${name.toUpperCase()}>>`,
    );
  }
  // Fallback: if {tema} wasn't in the placeholder map but project has a topic, use it
  if (projectTopic && !placeholders["tema"]) {
    const sanitized = sanitizeValue(projectTopic);
    content = content.replace(
      /\{tema\}/gi,
      `<<TEMA>>${sanitized.replace(/\$/g, "$$$$")}<</TEMA>>`,
    );
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
  const effectiveSystemPrompt = prompt.userPrompt
    ? prompt.content
    : systemPrompt;
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
    ...(useCache
      ? { cachedSystemPrompt: prompt.content, cacheSystemPrompt: true }
      : {}),
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
  const baseSystemPrompt = assemblyPrompt.userPrompt
    ? assemblyPrompt.content
    : "";
  const systemPrompt = baseSystemPrompt
    ? `Eres un editor senior que ensambla capítulos de no-ficción en español. Aplica estas reglas de estilo al ensamblar el texto:\n\n${STYLE_RULES}\n\n---\n\n${baseSystemPrompt}`
    : `Eres un editor senior que ensambla capítulos de no-ficción en español. Aplica estas reglas de estilo al ensamblar el texto:\n\n${STYLE_RULES}`;
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

  // Anthropic ephemeral cache: the system prompt (STYLE_RULES + assemblyPrompt.content)
  // is static across all merge calls in a chapter. Cache it to avoid re-sending every merge.
  const isAnthropic = getProviderForModel(model) === "anthropic";
  const useCache = isAnthropic && !!assemblyPrompt.userPrompt;

  const result = await generateCompletion({
    model,
    systemPrompt: useCache ? "" : systemPrompt,
    userPrompt: userContent,
    maxTokens: effectiveMaxTokens,
    ...(useCache
      ? { cachedSystemPrompt: systemPrompt, cacheSystemPrompt: true }
      : {}),
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
  let currentLevel: Array<{ title?: string; content: string }> = fragments.map(
    (f) => ({ title: f.title, content: f.content }),
  );
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
      fragments[0],
      fragments[1],
      assemblyPrompt,
      placeholders,
      model,
      temperature,
      effort,
      maxTokens,
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
  ): Promise<{
    text: string;
    usage: { inputTokens: number; outputTokens: number };
  }> => {
    if (half.length === 1) {
      return {
        text: half[0].content,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }
    const result = await generateChapterAssembly(
      assemblyPrompt,
      half,
      placeholders,
      model,
      temperature,
      effort,
      maxTokens,
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
    assemblyPrompt,
    placeholders,
    model,
    temperature,
    effort,
    maxTokens,
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
  const baseSystemPrompt = assemblyPrompt.userPrompt
    ? assemblyPrompt.content
    : "";
  const effectiveSystemPrompt = baseSystemPrompt
    ? `Eres un editor senior que ensambla capítulos de no-ficción en español. Aplica estas reglas de estilo al ensamblar el texto:\n\n${STYLE_RULES}\n\n---\n\n${baseSystemPrompt}`
    : `Eres un editor senior que ensambla capítulos de no-ficción en español. Aplica estas reglas de estilo al ensamblar el texto:\n\n${STYLE_RULES}`;
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
    ...(useCache
      ? { cachedSystemPrompt: effectiveSystemPrompt, cacheSystemPrompt: true }
      : {}),
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

  const baseSystemPrompt = critiquePrompt.userPrompt
    ? critiquePrompt.content
    : "";
  const effectiveSystemPrompt = baseSystemPrompt
    ? `Eres un crítico editorial. Al evaluar el texto, usa estas reglas de estilo como criterio de calidad:\n\n${STYLE_RULES}\n\n---\n\n${baseSystemPrompt}`
    : `Eres un crítico editorial. Al evaluar el texto, usa estas reglas de estilo como criterio de calidad:\n\n${STYLE_RULES}`;
  const userContent = critiquePrompt.userPrompt ?? critiquePrompt.content;

  let processedUserContent = applyPlaceholders(
    userContent,
    placeholders,
    projectTopic,
  );

  // Replace content placeholder with the actual chapter content
  processedUserContent = processedUserContent.replace(
    /\{\{CONTENIDO_CAPITULO\}\}/g,
    chapterContent.replace(/\$/g, "$$$$"),
  );
  processedUserContent = processedUserContent.replace(
    /\[PEGAR AQUÍ EL CAPÍTULO A CRITICAR\]|\[PEGAR AQUÍ EL CAPÍTULO COMPLETO\]/g,
    chapterContent.replace(/\$/g, "$$$$"),
  );

  const effectiveMaxTokens =
    maxTokens ?? critiqueMaxTokens(chapterContent.length);

  // Anthropic ephemeral cache: when userPrompt is set, critiquePrompt.content
  // is the static system prompt — cache it across critique calls.
  const isAnthropic = getProviderForModel(model) === "anthropic";
  const useCache = isAnthropic && !!critiquePrompt.userPrompt;

  const result = await generateCompletion({
    model,
    systemPrompt: useCache ? "" : effectiveSystemPrompt,
    userPrompt: processedUserContent,
    maxTokens: effectiveMaxTokens,
    ...(useCache
      ? { cachedSystemPrompt: effectiveSystemPrompt, cacheSystemPrompt: true }
      : {}),
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

export interface GenerateCorrectionParams {
  correctorPrompt: PromptLike;
  content: string;
  critiqueContent: string;
  placeholders: Record<string, string>;
  model?: string;
  temperature?: number;
  effort?: ReasoningEffort;
  maxTokens?: number;
  projectTopic?: string | null;
}

export async function generateChapterCorrection(
  params: GenerateCorrectionParams,
): Promise<GenerateResult> {
  const {
    correctorPrompt,
    content: chapterContent,
    critiqueContent,
    placeholders,
    model = DEFAULT_GENERATION_MODEL,
    temperature,
    effort,
    maxTokens,
    projectTopic,
  } = params;

  const baseSystemPrompt = correctorPrompt.userPrompt
    ? correctorPrompt.content
    : "";
  const effectiveSystemPrompt = baseSystemPrompt
    ? `Eres un corrector editorial. Al reescribir el texto, aplica estas reglas de estilo:\n\n${STYLE_RULES}\n\n---\n\n${baseSystemPrompt}`
    : `Eres un corrector editorial. Al reescribir el texto, aplica estas reglas de estilo:\n\n${STYLE_RULES}`;
  const userContent = correctorPrompt.userPrompt ?? correctorPrompt.content;

  let processedUserContent = applyPlaceholders(
    userContent,
    placeholders,
    projectTopic,
  );

  // Replace content placeholders
  processedUserContent = processedUserContent.replace(
    /\{\{CONTENIDO_CAPITULO\}\}/g,
    chapterContent.replace(/\$/g, "$$$$"),
  );
  processedUserContent = processedUserContent.replace(
    /\{\{CONTENIDO_CRITICA\}\}/g,
    critiqueContent.replace(/\$/g, "$$$$"),
  );

  // Correction output scales with input (chapter + critique)
  const inputLength = chapterContent.length + critiqueContent.length;
  const effectiveMaxTokens =
    maxTokens ?? Math.max(8192, Math.ceil(inputLength / 4) + 8192);

  // Anthropic ephemeral cache
  const isAnthropic = getProviderForModel(model) === "anthropic";
  const useCache = isAnthropic && !!correctorPrompt.userPrompt;

  const result = await generateCompletion({
    model,
    systemPrompt: useCache ? "" : effectiveSystemPrompt,
    userPrompt: processedUserContent,
    maxTokens: effectiveMaxTokens,
    ...(useCache
      ? { cachedSystemPrompt: effectiveSystemPrompt, cacheSystemPrompt: true }
      : {}),
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
