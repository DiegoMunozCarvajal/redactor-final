import { generateCompletion, type ReasoningEffort } from "./completion";
import { DEFAULT_GENERATION_MODEL } from "./providers";
import { webSearchBatch, type SearchResult } from "./web-search";
import { retrieveContext } from "./rag";

// Re-export SearchResult for convenience
export type { SearchResult };

export interface PlaceholderFillEvent {
  type: "placeholder" | "done" | "error";
  name?: string;
  definition?: string;
  sources?: SearchResult[];
  error?: string;
}

// Default model for generation if none specified
const DEFAULT_MODEL = DEFAULT_GENERATION_MODEL;

function extractJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {}
  const match = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (match) {
    try {
      return JSON.parse(match[1]);
    } catch {}
  }
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      return JSON.parse(objMatch[0]);
    } catch {}
  }
  throw new Error("Could not parse JSON from response");
}

const RESEARCH_DECISION_PROMPT = `Eres un planificador de investigación. Dado:
1. Un brief de capítulo
2. Una lista de nombres de placeholder (todos factuales — los estilísticos ya fueron resueltos)

Para cada placeholder, decide si necesita búsqueda web o puede inferirse del contexto.
Devuelve un array JSON con los nombres que NECESITAN búsqueda web. Solo incluye aquellos donde la verificación factual externa agregue valor (ej. estudios específicos, papers, eventos históricos, estadísticas, expertos nombrados). Omite los que pueden definirse con confianza desde el brief del capítulo (ej. elegir un caso de estudio relevante, un ejemplo conocido).

Ejemplo:
Placeholders: ["FUENTE_PRINCIPAL", "EJEMPLO_HISTORICO", "ESTUDIO_CLAVE"]
Resultado: ["FUENTE_PRINCIPAL", "ESTUDIO_CLAVE"]
(Razón: EJEMPLO_HISTORICO puede elegirse del conocimiento general; los otros requieren citas específicas)`;

const FILL_SYSTEM_PROMPT = `Eres un investigador experto y escritor fantasma. Tu tarea es definir los valores de placeholders factuales para el capítulo de un libro.

## Entrada
- Brief del capítulo: qué cubre este capítulo específico
- Nombres de placeholders: los {placeholders} que necesitan definición (todos factuales)
- Resultados de búsqueda: hallazgos de búsqueda web (si los hay)
- Source Material: fragmentos de tus documentos subidos que coinciden con este placeholder (si los hay)

## Instrucciones

### Calidad de fuentes
Antes de definir cada placeholder, evalúa los resultados de búsqueda y el material de fuentes:
- ¿El resultado trata directamente el tema del placeholder y del brief del capítulo? Si no, descártalo.
- ¿El contenido es específico (nombres, fechas, datos) o es genérico (reformulaciones vagas)? Solo usa contenido específico.
- ¿La fuente es confiable (paper académico, institución reconocida, publicación verificable)? Prioriza estas.
- Si tienes Source Material de tus documentos, PREFIÉRELO sobre los resultados de búsqueda web. Son tus fuentes curadas.

Si ningún resultado pasa estos criterios, NO uses los resultados. Responde con tu mejor conocimiento pero no inventes fuentes ni cifras.

### Definiciones
1. Para placeholders CON fuentes de calidad: extrae y cita nombres, fechas, instituciones o datos de las fuentes
2. Para placeholders SIN fuentes de calidad: elige el ejemplo, caso o referencia más pertinente y específico que se ajuste al brief. No inventes citas
3. Cada definición: 1-3 oraciones, directamente usable en un párrafo del libro (no una meta-descripción)
4. Alinea cada definición con el alcance del brief del capítulo
5. Responde ÚNICAMENTE con JSON válido: {"placeholders": {"NOMBRE": "definición", ...}}

## Ejemplo
Placeholders: ["FUENTE_PRINCIPAL", "ESTUDIO_CLAVE"]
Resultados de búsqueda: un paper de PNAS 2018 por Milkman et al. sobre nudges de vacunación (relevante, específico, académico — cumple los criterios de calidad)
Respuesta: {"placeholders": {"FUENTE_PRINCIPAL": "El estudio de 2018 publicado en PNAS por Katherine Milkman y colegas de la Universidad de Pennsylvania, que demostró que los recordatorios de planificación aumentaron las tasas de vacunación contra la gripe en 4.2 puntos porcentuales entre 37,000 empleados", "ESTUDIO_CLAVE": "Un ensayo controlado aleatorizado publicado en The Lancet Digital Health (2021) que mostró que los recordatorios personalizados por mensaje de texto mejoraron la adherencia a la medicación en un 14% entre pacientes hipertensos durante 12 meses"}}`;

// Keywords that suggest this placeholder should use RAG instead of web search
const RAG_FUNCTION_KEYWORDS = [
  "bibliografía", "bibliografia", "paper", "estudio", "ejemplo",
  "fuente", "referencia", "cita", "investigación", "académico",
  "academico", "paper", "artículo", "articulo", "publicación",
  "publicacion", "autor", "evidence", "evidencia", "caso",
];

function shouldUseRag(
  placeholderName: string,
  functionStr?: string | null,
  notes?: string | null,
): boolean {
  const text = `${placeholderName} ${functionStr ?? ""} ${notes ?? ""}`.toLowerCase();
  return RAG_FUNCTION_KEYWORDS.some((kw) => text.includes(kw));
}

export async function researchPlaceholders(
  placeholderNames: string[],
  chapterBrief: string,
  projectTopic: string | null,
): Promise<Record<string, SearchResult[]>> {
  if (placeholderNames.length === 0) return {};

  // Phase 1a: Decide which placeholders need research
  const decisionPrompt = `${RESEARCH_DECISION_PROMPT}\n\nChapter brief: ${chapterBrief || "(none)"}\nPlaceholders: ${JSON.stringify(placeholderNames)}`;

  let needsResearch: string[] = [];
  try {
    const decision = await generateCompletion({
      model: DEFAULT_GENERATION_MODEL,
      systemPrompt: "",
      userPrompt: decisionPrompt,
    });
    const parsed = extractJson(decision.data as string);
    needsResearch = Array.isArray(parsed)
      ? (parsed as string[])
      : ((parsed as Record<string, unknown>).needsResearch as string[] ?? []);
  } catch {
    // If provider fails or parsing fails, research all
    needsResearch = placeholderNames;
  }

  // Phase 1b: Execute searches
  if (needsResearch.length === 0) return {};

  // Build query → placeholder name map so we can key results by name
  const queryToName = new Map<string, string>();
  const searchQueries = needsResearch.map((name) => {
    const readable = name.replace(/_/g, " ").toLowerCase();
    const query = `${readable} ${projectTopic || ""} ${chapterBrief || ""}`.trim();
    queryToName.set(query, name);
    return query;
  });

  const batchResults = await webSearchBatch(searchQueries);

  // Transform from Record<query, SearchResult[]> to Record<placeholderName, SearchResult[]>
  const results: Record<string, SearchResult[]> = {};
  for (const [query, hits] of Object.entries(batchResults)) {
    const name = queryToName.get(query);
    if (name) {
      results[name] = hits;
    }
  }
  return results;
}

/**
 * Research placeholders splitting between RAG (source documents) and web search.
 * Placeholders whose function/notes suggest bibliography, papers, examples, etc.
 * use RAG retrieval from uploaded sources; the rest use web search.
 */
export async function researchPlaceholdersWithRag(
  placeholderNames: string[],
  chapterBrief: string,
  projectTopic: string | null,
  projectId: string,
  placeholderFunctions: Record<string, { function?: string | null; notes?: string | null }>,
): Promise<{
  searchResults: Record<string, SearchResult[]>;
  ragContexts: Record<string, string>;
}> {
  // Split placeholders into RAG vs web search
  const ragNames: string[] = [];
  const webNames: string[] = [];

  for (const name of placeholderNames) {
    const func = placeholderFunctions[name];
    if (shouldUseRag(name, func?.function, func?.notes)) {
      ragNames.push(name);
    } else {
      webNames.push(name);
    }
  }

  // RAG: retrieve context for each placeholder
  const ragContexts: Record<string, string> = {};
  for (const name of ragNames) {
    try {
      const query = `${name.replace(/_/g, " ")} ${chapterBrief} ${projectTopic ?? ""}`;
      const { contextText } = await retrieveContext(query, projectId, {
        topK: 5,
        tokenBudget: 3000,
      });
      if (contextText) {
        ragContexts[name] = contextText;
      }
    } catch (err) {
      console.warn(`[rag] Failed to retrieve context for {${name}}:`, (err as Error).message);
    }
  }

  // Web search: use existing logic for remaining
  const searchResults = webNames.length > 0
    ? await researchPlaceholders(webNames, chapterBrief, projectTopic)
    : {};

  return { searchResults, ragContexts };
}

export async function* fillPlaceholders(
  placeholderNames: string[],
  chapterBrief: string,
  promptContents: string[],
  searchResults: Record<string, SearchResult[]>,
  model: string = DEFAULT_MODEL,
  customSystemPrompt?: string,
  effort?: ReasoningEffort,
  temperature?: number,
  ragContexts?: Record<string, string>,
): AsyncGenerator<PlaceholderFillEvent> {
  const systemPrompt = customSystemPrompt || FILL_SYSTEM_PROMPT;

  // Build the research context from web search results
  let researchContext = "";
  if (Object.keys(searchResults).length > 0) {
    researchContext = "\n\n## Research Results\n";
    for (const [name, results] of Object.entries(searchResults)) {
      if (results.length === 0) continue;
      researchContext += `\n### ${name.replace(/_/g, " ")}\n`;
      for (const r of results) {
        researchContext += `- ${r.title}\n  ${r.snippet}\n  URL: ${r.url}\n`;
      }
    }
  }

  // Build RAG context from source documents
  let ragContext = "";
  if (ragContexts && Object.keys(ragContexts).length > 0) {
    ragContext = "\n\n## Source Material (from your documents)\n";
    for (const [name, ctx] of Object.entries(ragContexts)) {
      ragContext += `\n### ${name.replace(/_/g, " ")}\n${ctx}\n`;
    }
  }

  const userPrompt = `## Chapter Brief
${chapterBrief || "(none)"}

## Content Prompts (for context)
${promptContents
    .map(
      (c, i) =>
        `Prompt ${i + 1}: ${c.slice(0, 200)}${c.length > 200 ? "..." : ""}`,
    )
    .join("\n\n")}

${researchContext}
${ragContext}

## Placeholders to Define
${JSON.stringify(placeholderNames)}

Define each placeholder. Return JSON: {"placeholders": {"NAME": "definition", ...}}`;

  let result;
  try {
    result = await generateCompletion({
      model,
      systemPrompt,
      userPrompt,
      ...(effort !== undefined ? { effort } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
    });
  } catch (err) {
    yield {
      type: "error",
      error: `Provider failure: ${(err as Error).message}`,
    };
    return;
  }

  try {
    const parsed = extractJson(result.data as string) as Record<string, unknown>;
    const definitions = (parsed.placeholders ?? parsed) as Record<string, string>;

    for (const name of placeholderNames) {
      const definition = definitions[name];
      if (definition) {
        // Look up sources directly by placeholder name
        const placeholderSources = searchResults[name] ?? [];

        yield {
          type: "placeholder",
          name,
          definition,
          sources: placeholderSources.slice(0, 5),
        };
      } else {
        yield { type: "error", name, error: `No definition generated for {${name}}` };
      }
    }
  } catch (err) {
    yield {
      type: "error",
      error: `Failed to parse response: ${(err as Error).message}`,
    };
    return;
  }

  yield { type: "done" };
}

export async function fillSinglePlaceholder(
  name: string,
  chapterBrief: string,
  projectTopic: string | null,
  promptContents: string[],
  existingDefinitions: Record<string, string>,
  model: string = DEFAULT_MODEL,
  customSystemPrompt?: string,
  effort?: ReasoningEffort,
  temperature?: number,
): Promise<{ definition: string; sources: SearchResult[] }> {
  // Research this specific placeholder
  const query = `${name.replace(/_/g, " ")} ${projectTopic || ""} ${chapterBrief || ""}`.trim();
  const searchResults = await webSearchBatch([query]);
  const sources = searchResults[query] ?? [];

  let researchContext = "";
  if (sources.length > 0) {
    researchContext = "\n\n## Research Results\n";
    for (const r of sources) {
      researchContext += `- ${r.title}\n  ${r.snippet}\n  URL: ${r.url}\n`;
    }
  }

  const systemPrompt =
    customSystemPrompt ||
    `Eres un investigador experto en libros. Define este placeholder con un valor conciso y específico que encaje en el capítulo.

Calidad de fuentes:
- Evalúa los resultados de búsqueda: ¿tratan directamente el tema del placeholder y del brief? ¿Son específicos o genéricos? ¿La fuente es confiable?
- Si los resultados son relevantes y específicos, extrae datos, nombres, fechas e instituciones de ellos
- Si ningún resultado es útil, descártalos y responde con tu mejor conocimiento sin inventar fuentes ni cifras

Reglas:
- La definición debe ser de 1-3 oraciones, directamente usable en un párrafo del libro (no una meta-descripción)
- Alinea la definición con el alcance del brief del capítulo
- Responde ÚNICAMENTE: {"definition": "..."}

Ejemplo:
Placeholder: {CASO_ESTUDIO}
Brief del capítulo: "La aplicación de los seis principios de persuasión de Cialdini en campañas de salud pública, cubriendo reciprocidad, escasez y prueba social con casos documentados de cambios de comportamiento a escala poblacional"
Resultados de búsqueda: [resultados sobre campañas reales de salud pública]
Respuesta: {"definition": "La campaña 'Truth' antitabaco en Estados Unidos (2000-2014), que aplicó el principio de prueba social al mostrar adolescentes rechazando la manipulación de las tabacaleras, redujo el tabaquismo juvenil del 23% al 7% según un estudio del CDC publicado en 2015 en American Journal of Public Health"}`;

  const userPrompt = `## Chapter Brief
${chapterBrief || "(none)"}

## Existing Placeholder Definitions (for context)
${Object.entries(existingDefinitions)
  .map(([k, v]) => `- {${k}}: ${v}`)
  .join("\n")}

${researchContext}

## Placeholder to Define
{${name}}

Return JSON: {"definition": "your concise definition"}`;

  const result = await generateCompletion({
    model,
    systemPrompt,
    userPrompt,
    ...(effort !== undefined ? { effort } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
  });

  try {
    const parsed = extractJson(result.data as string) as Record<string, unknown>;
    return { definition: (parsed.definition as string) ?? "", sources };
  } catch {
    return { definition: (result.data as string).trim(), sources };
  }
}
