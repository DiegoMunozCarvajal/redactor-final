import { generateCompletion, type ReasoningEffort } from "./completion";
import { DEFAULT_GENERATION_MODEL } from "./providers";
import { webSearchBatch, type SearchResult } from "./web-search";

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
1. Una descripción de proyecto
2. Un brief de capítulo
3. Una lista de nombres de placeholder (todos factuales — los estilísticos ya fueron resueltos)

Para cada placeholder, decide si necesita búsqueda web o puede inferirse del contexto.
Devuelve un array JSON con los nombres que NECESITAN búsqueda web. Solo incluye aquellos donde la verificación factual externa agregue valor (ej. estudios específicos, papers, eventos históricos, estadísticas, expertos nombrados). Omite los que pueden definirse con confianza desde el brief del capítulo y la descripción del proyecto (ej. elegir un caso de estudio relevante, un ejemplo conocido).

Ejemplo:
Placeholders: ["FUENTE_PRINCIPAL", "EJEMPLO_HISTORICO", "ESTUDIO_CLAVE"]
Resultado: ["FUENTE_PRINCIPAL", "ESTUDIO_CLAVE"]
(Razón: EJEMPLO_HISTORICO puede elegirse del conocimiento general; los otros requieren citas específicas)`;

const FILL_SYSTEM_PROMPT = `Eres un investigador experto y escritor fantasma. Tu tarea es definir los valores de placeholders factuales para el capítulo de un libro.

## Entrada
- Descripción del proyecto: de qué trata el libro
- Brief del capítulo: qué cubre este capítulo específico
- Nombres de placeholders: los {placeholders} que necesitan definición (todos factuales)
- Resultados de búsqueda: hallazgos de búsqueda web para placeholders investigados (si los hay)

## Instrucciones
1. Define cada placeholder con un valor conciso y específico, respaldado por los resultados de búsqueda cuando estén disponibles
2. Para placeholders CON resultados de búsqueda: cita nombres, fechas, instituciones o datos específicos de las fuentes proporcionadas
3. Para placeholders SIN resultados de búsqueda: elige el ejemplo, caso o referencia más relevante y específico que encaje con el brief del capítulo
4. Cada definición debe ser de 1-3 oraciones, específica y directamente usable en un párrafo del libro (no una meta-descripción de qué es el placeholder)
5. Alinea cada definición con el alcance del brief del capítulo y la descripción del proyecto
6. Responde ÚNICAMENTE con JSON válido: {"placeholders": {"NOMBRE": "definición", ...}}

## Ejemplo
Placeholders: ["FUENTE_PRINCIPAL", "ESTUDIO_CLAVE"]
Resultados de búsqueda: un paper de PNAS 2018 por Milkman et al. sobre nudges de vacunación
Respuesta: {"placeholders": {"FUENTE_PRINCIPAL": "El estudio de 2018 publicado en PNAS por Katherine Milkman y colegas de la Universidad de Pennsylvania, que demostró que los recordatorios de planificación aumentaron las tasas de vacunación contra la gripe en 4.2 puntos porcentuales entre 37,000 empleados", "ESTUDIO_CLAVE": "Un ensayo controlado aleatorizado publicado en The Lancet Digital Health (2021) que mostró que los recordatorios personalizados por mensaje de texto mejoraron la adherencia a la medicación en un 14% entre pacientes hipertensos durante 12 meses"}}`;

export async function researchPlaceholders(
  placeholderNames: string[],
  chapterBrief: string,
  projectDescription: string,
): Promise<Record<string, SearchResult[]>> {
  if (placeholderNames.length === 0) return {};

  // Phase 1a: Decide which placeholders need research
  const decisionPrompt = `${RESEARCH_DECISION_PROMPT}\n\nProject: ${projectDescription || "(none)"}\nChapter brief: ${chapterBrief || "(none)"}\nPlaceholders: ${JSON.stringify(placeholderNames)}`;

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
    const query = `${readable} ${projectDescription || ""} ${chapterBrief || ""}`.trim();
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

export async function* fillPlaceholders(
  placeholderNames: string[],
  chapterBrief: string,
  projectDescription: string,
  promptContents: string[],
  searchResults: Record<string, SearchResult[]>,
  model: string = DEFAULT_MODEL,
  customSystemPrompt?: string,
  effort?: ReasoningEffort,
  temperature?: number,
): AsyncGenerator<PlaceholderFillEvent> {
  const systemPrompt = customSystemPrompt || FILL_SYSTEM_PROMPT;

  // Build the research context
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

  const userPrompt = `## Project Description\n${projectDescription || "(none)"}

## Chapter Brief
${chapterBrief || "(none)"}

## Content Prompts (for context)
${promptContents
    .map(
      (c, i) =>
        `Prompt ${i + 1}: ${c.slice(0, 200)}${c.length > 200 ? "..." : ""}`,
    )
    .join("\n\n")}

${researchContext}

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
  projectDescription: string,
  promptContents: string[],
  existingDefinitions: Record<string, string>,
  model: string = DEFAULT_MODEL,
  customSystemPrompt?: string,
  effort?: ReasoningEffort,
  temperature?: number,
): Promise<{ definition: string; sources: SearchResult[] }> {
  // Research this specific placeholder
  const query = `${name.replace(/_/g, " ")} ${projectDescription || ""}`.trim();
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

Reglas:
- Si hay resultados de búsqueda, cita nombres, fechas, instituciones o datos específicos de las fuentes
- Si no hay resultados de búsqueda, elige el ejemplo, caso o referencia más relevante y específico que encaje con el brief del capítulo
- La definición debe ser de 1-3 oraciones, directamente usable en un párrafo del libro (no una meta-descripción)
- Alinea la definición con el alcance del brief del capítulo y la descripción del proyecto
- Responde ÚNICAMENTE: {"definition": "..."}`;

  const userPrompt = `## Project Description\n${projectDescription || "(none)"}

## Chapter Brief
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
