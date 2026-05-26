import { generateCompletion, type ReasoningEffort } from "./completion";
import { DEFAULT_GENERATION_MODEL } from "./providers";
import { webSearch, searchSemanticScholar, type SearchResult } from "./web-search";
import { retrieveContext } from "./rag";

export type { SearchResult };

export interface PlaceholderFillEvent {
  type: "placeholder" | "done" | "error";
  name?: string;
  definition?: string;
  sources?: SearchResult[];
  ragChunks?: number;
  /** Research provider used: "rag" | "semantic-scholar" | "web" | "direct" */
  provider?: string;
  error?: string;
  /** Index of current placeholder being filled (0-based) */
  current?: number;
  /** Total placeholders to fill */
  total?: number;
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

// Keywords for RAG (uploaded documents) — examples, stories, cases only
const RAG_KEYWORDS = [
  "ejemplo", "historia", "histórico", "historico", "anécdota",
  "anecdota", "caso", "narrativa", "experiencia", "ilustración",
  "ilustracion", "relato", "testimonio", "vivencia",
];

// Keywords for Semantic Scholar — academic papers, bibliography, studies
const SEMANTIC_SCHOLAR_KEYWORDS = [
  "bibliografía", "bibliografia", "paper", "estudio", "investigación",
  "investigacion", "académico", "academico", "artículo", "articulo",
  "publicación", "publicacion", "autor", "evidence", "evidencia",
  "fuente", "fuente principal", "referencia", "cita", "científico",
  "cientifico", "journal", "revista", "paper", "metaanálisis",
  "metanalisis", "revisión sistemática", "revision sistematica",
  "ensayo clínico", "ensayo clinico", "doi",
];

function shouldUseRag(
  placeholderName: string,
  functionStr?: string | null,
  notes?: string | null,
): boolean {
  const text = `${placeholderName} ${functionStr ?? ""} ${notes ?? ""}`.toLowerCase();
  return RAG_KEYWORDS.some((kw) => text.includes(kw));
}

function shouldUseSemanticScholar(
  placeholderName: string,
  functionStr?: string | null,
  notes?: string | null,
): boolean {
  const text = `${placeholderName} ${functionStr ?? ""} ${notes ?? ""}`.toLowerCase();
  return SEMANTIC_SCHOLAR_KEYWORDS.some((kw) => text.includes(kw));
}

// Placeholder names that are stylistic/creative — skip external research
const STYLISTIC_PATTERNS = [
  "lector", "audiencia", "audience", "tono", "tone", "estilo", "style",
  "enfoque", "approach", "perspectiva", "angulo", "ángulo", "nivel",
  "formato", "extensión", "extension",
];

function isStylistic(name: string, functionStr?: string | null): boolean {
  const lower = name.toLowerCase();
  if (STYLISTIC_PATTERNS.some((p) => lower.includes(p))) return true;
  // If function explicitly says it needs research, override
  if (functionStr?.toLowerCase().includes("investigación")) return false;
  if (functionStr?.toLowerCase().includes("búsqueda")) return false;
  return false;
}

// Placeholder names that resolve directly from project data (no LLM)
function resolveDirectly(
  name: string,
  projectTopic: string | null,
): string | null {
  const lower = name.toLowerCase();
  const segments = lower.split("_");

  if ((segments.includes("tema") || segments.includes("topic")) && projectTopic) {
    return projectTopic;
  }

  return null;
}

const INDIVIDUAL_FILL_SYSTEM_PROMPT = `Eres un investigador experto y escritor fantasma. Tu tarea es definir UN placeholder para el capítulo de un libro.

## Tu guía principal

La **Función del placeholder** y las **Notas adicionales** (provistas en el prompt del usuario) describen exactamente qué rol cumple esta variable en el texto y qué tipo de
contenido debe contener. Úsalas como tu guía principal para decidir qué generar. Seguir estas especificaciones con precisión asegura que el texto final sea coherente con el
resto del capítulo y cumpla su propósito narrativo.

## Instrucciones

1. **Primero, entiende la función y las notas**: te dicen el propósito del placeholder, cómo se relaciona con otros placeholders mencionados en el contexto del capítulo, la
extensión recomendada, el tono sugerido y el tipo de contenido esperado. Adhiérete estrictamente a ellas. Si hay tensión entre las notas y el research, las notas tienen
prioridad.

2. **Luego, evalúa los resultados de búsqueda y material de fuentes**. Esta evaluación es crítica porque el placeholder será insertado directamente en un libro, donde una
fuente incorrecta o genérica daña la credibilidad del capítulo entero. Usa el siguiente formato para razonar en voz alta:

<evaluacion>
- Resultado 1: ¿Trata directamente el tema del placeholder y del proyecto? [Sí/No]
  ¿El contenido es específico (nombres, fechas, datos)? [Sí/No]
  ¿La fuente es confiable (paper académico, institución reconocida, publicación verificable)? [Sí/No]
- Resultado 2: [mismo análisis]
- Conclusión: ¿Algún resultado pasa todos los criterios? [Sí/No]. Si sí, ¿cuál?
</evaluacion>

Criterios de evaluación:
- ¿Tratan directamente el tema del placeholder y del proyecto? Si no, descártalos.
- ¿El contenido es específico (nombres, fechas, datos) o genérico? Solo usa contenido específico.
- ¿La fuente es confiable (paper académico, institución reconocida, publicación verificable)? Prioriza estas.
- Si tienes Source Material de documentos subidos, PREFIÉRELO sobre resultados de búsqueda web. El Source Material fue seleccionado específicamente para este proyecto y tiene
 mayor relevancia contextual.

3. **Si ningún resultado pasa los criterios**, usa tu mejor conocimiento para responder, pero incluye solo información que puedas verificar. Es preferible una definición
precisa sin fuente explícita que una definición con fuentes inventadas. Para placeholders estilísticos o creativos (los que la nota indique que no requieren búsqueda), usa
directamente tu conocimiento.

4. **Redacta la definición**: 1-3 oraciones, directamente usable en un párrafo del libro (no escribas una meta-descripción tipo "este placeholder contiene..."). La definición
 debe poder insertarse tal cual en el flujo del texto sin edición adicional.

5. **Entrega el resultado**: responde ÚNICAMENTE con JSON válido en este formato: {"definition": "tu definición concisa"}

## Ejemplos

Ejemplo 1 — Placeholder que requiere búsqueda externa:

Placeholder: {CASO_ESTUDIO}
Función: "Proveer un caso de estudio real y documentado que ilustre el principio de prueba social en campañas de salud"
Notas: "Debe incluir nombre de la campaña, período, resultados cuantitativos y fuente académica. Extensión: 2-3 oraciones."

<evaluacion>
- Resultado 1 (Estudio CDC sobre campaña Truth): ¿Trata directamente el tema? Sí. ¿Específico? Sí — incluye fechas, porcentajes. ¿Fuente confiable? Sí — CDC + journal
académico.
- Resultado 2 (Meta-análisis genérico de prueba social): ¿Trata directamente el tema? Parcialmente. ¿Específico? No — sin datos de campaña concreta. ¿Fuente confiable? Sí,
pero demasiado genérico.
- Conclusión: Resultado 1 pasa todos los criterios.
</evaluacion>

{"definition": "La campaña 'Truth' antitabaco en Estados Unidos (2000-2014), que aplicó el principio de prueba social al mostrar adolescentes rechazando la manipulación de
las tabacaleras, redujo el tabaquismo juvenil del 23% al 7% según un estudio del CDC publicado en 2015 en American Journal of Public Health"}

Ejemplo 2 — Placeholder estilístico sin búsqueda externa:

Placeholder: {LECTOR_OBJETIVO}
Función: "Definir el perfil del lector ideal para calibrar el tono y profundidad del capítulo"
Notas: "Especificar rol profesional, contexto organizacional y nivel de conocimiento previo. Enfócate en rol, contexto y necesidad práctica; omite datos demográficos
genéricos (edad, país). Este placeholder es estilístico. No requiere búsqueda externa."

<evaluacion>
- Placeholder estilístico. No aplica búsqueda. Uso conocimiento directo.
</evaluacion>

{"definition": "Profesionales de comunicación en salud pública y funcionarios de ministerios de salud que diseñan campañas de prevención dirigidas a poblaciones diversas, con
 experiencia limitada en psicología del comportamiento"}`;

export interface PlaceholderDef {
  name: string;
  function?: string | null;
  notes?: string | null;
}

/**
 * Fill placeholders sequentially — one by one with individual prompts.
 * Each placeholder gets: research decision → targeted research (RAG or web) →
 * tailored prompt → generation → yield result.
 */
export async function* fillPlaceholdersSequential(
  placeholders: PlaceholderDef[],
  promptContents: string[],
  projectTopic: string | null,
  projectId: string,
  model: string = DEFAULT_MODEL,
  effort?: ReasoningEffort,
  temperature?: number,
): AsyncGenerator<PlaceholderFillEvent> {
  const total = placeholders.length;
  const promptContext = promptContents
    .map((c, i) => `Prompt ${i + 1}: ${c.slice(0, 300)}${c.length > 300 ? "..." : ""}`)
    .join("\n\n");

  const existingDefs: Record<string, string> = {};

  for (let i = 0; i < placeholders.length; i++) {
    const ph = placeholders[i];

    // Phase 0: Direct resolution
    const direct = resolveDirectly(ph.name, projectTopic);
    if (direct) {
      existingDefs[ph.name] = direct;
      yield {
        type: "placeholder",
        name: ph.name,
        definition: direct,
        sources: [],
        provider: "direct",
        current: i,
        total,
      };
      continue;
    }

    // Phase 1: Research — ternary decision: RAG | Semantic Scholar | Web search
    let sources: SearchResult[] = [];
    let ragContext = "";
    let ragChunks = 0;
    let researchProvider = ""; // "rag" | "semantic-scholar" | "web"

    const useRag = shouldUseRag(ph.name, ph.function, ph.notes);
    const useSS = shouldUseSemanticScholar(ph.name, ph.function, ph.notes);
    const skipResearch = isStylistic(ph.name, ph.function);

    if (!skipResearch) {
      const query = `${ph.name.replace(/_/g, " ")} ${projectTopic ?? ""}`.trim();

      if (useRag) {
        // RAG — uploaded source documents for examples/stories/cases
        researchProvider = "rag";
        try {
          const result = await retrieveContext(query, projectId, {
            topK: 5,
            tokenBudget: 3000,
          });
          if (result.contextText) {
            ragContext = result.contextText;
            ragChunks = result.chunks.length;
          }
        } catch (err) {
          console.warn(`[placeholder-fill] RAG failed for {${ph.name}}:`, (err as Error).message);
        }
      } else if (useSS) {
        // Semantic Scholar — academic papers, bibliography, studies
        researchProvider = "semantic-scholar";
        try {
          sources = await searchSemanticScholar(query);
        } catch (err) {
          console.warn(`[placeholder-fill] Semantic Scholar failed for {${ph.name}}:`, (err as Error).message);
        }
      } else {
        // Web search — Exa → Tavily (+ Semantic Scholar as supplement)
        researchProvider = "web";
        try {
          sources = await webSearch(query);
        } catch (err) {
          console.warn(`[placeholder-fill] Web search failed for {${ph.name}}:`, (err as Error).message);
        }
      }
    }

    // Phase 2: Build research context for the prompt
    let researchSection = "";
    if (ragContext) {
      researchSection = `\n## Research Results (RAG · tus documentos subidos)\n\n<research_results source="rag">\n<result id="1">\n<content>${ragContext}</content>\n</result>\n</research_results>`;
    } else if (sources.length > 0) {
      const sourceLabel = researchProvider === "semantic-scholar"
        ? "Semantic Scholar · papers académicos"
        : "Web search";
      researchSection = `\n## Research Results (${sourceLabel})\n\n<research_results source="${researchProvider}">`;
      for (let idx = 0; idx < sources.length; idx++) {
        const s = sources[idx];
        researchSection += `\n<result id="${idx + 1}">\n<content>${s.title}\n${s.snippet}</content>`;
        if (s.url) {
          researchSection += `\n<url>${s.url}</url>`;
        }
        researchSection += "\n</result>";
      }
      researchSection += "\n</research_results>";
    } else if (skipResearch) {
      researchSection = "\n## Nota\n\nEste placeholder es estilístico/creativo. No requiere búsqueda externa. Usa tu conocimiento para dar una definición pertinente y específica.";
    } else {
      researchSection = `\n## Nota\n\nNo se encontraron resultados de búsqueda (${researchProvider || "sin búsqueda"}). Usa tu mejor conocimiento.`;
    }

    // Phase 3: Build individual prompt
    // Function and notes are the PRIMARY guide — feature them prominently
    let functionSection = "";
    if (ph.function) {
      functionSection = `\n## 🎯 Función del placeholder\n\n${ph.function}`;
    }
    let notesSection = "";
    if (ph.notes) {
      notesSection = `\n## 📝 Notas para quien define este valor\n\n${ph.notes}`;
    }
    if (!functionSection) {
      functionSection = `\n## 🎯 Función del placeholder\n\nProporcionar información factual pertinente y específica para el contenido del capítulo.`;
    }

    // Include already-filled definitions as context
    let existingDefsSection = "";
    const existingEntries = Object.entries(existingDefs);
    if (existingEntries.length > 0) {
      existingDefsSection = "\n## Placeholders ya definidos (para contexto)\n\n" +
        existingEntries.map(([k, v]) => `- {${k}}: ${v}`).join("\n");
    }

    const userPrompt = `## Placeholder a definir

{${ph.name}}
${functionSection}
${notesSection}
## Tema del proyecto

${projectTopic || "(sin tema especificado)"}

## Contexto de los prompts del capítulo

${promptContext}
${existingDefsSection}
${researchSection}

Responde ÚNICAMENTE con JSON: {"definition": "tu definición concisa de 1-3 oraciones"}`;

    // Phase 4: Generate
    try {
      const result = await generateCompletion({
        model,
        systemPrompt: INDIVIDUAL_FILL_SYSTEM_PROMPT,
        userPrompt,
        ...(effort !== undefined ? { effort } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
      });

      const parsed = extractJson(result.data as string) as Record<string, unknown>;
      const definition = (parsed.definition as string) ?? "";

      if (definition) {
        existingDefs[ph.name] = definition;
        yield {
          type: "placeholder",
          name: ph.name,
          definition,
          sources,
          ragChunks: ragChunks || undefined,
          provider: skipResearch ? "none" : (researchProvider || "web"),
          current: i,
          total,
        };
      } else {
        yield {
          type: "error",
          name: ph.name,
          error: `No definition generated for {${ph.name}}`,
          current: i,
          total,
        };
      }
    } catch (err) {
      yield {
        type: "error",
        name: ph.name,
        error: `Generation failed: ${(err as Error).message}`,
        current: i,
        total,
      };
    }
  }

  yield { type: "done", total, current: total };
}

// ── Legacy batch functions kept for backward compat ──

const RESEARCH_DECISION_PROMPT = `Eres un planificador de investigación. Dado:
1. El tema del proyecto
2. Una lista de nombres de placeholder (todos factuales — los estilísticos ya fueron resueltos)

Para cada placeholder, decide si necesita búsqueda web o puede inferirse del contexto.
Devuelve un array JSON con los nombres que NECESITAN búsqueda web. Solo incluye aquellos donde la verificación factual externa agregue valor (ej. estudios específicos, papers, eventos históricos, estadísticas, expertos nombrados). Omite los que pueden definirse con confianza desde el tema del proyecto (ej. elegir un caso de estudio relevante, un ejemplo conocido).

Ejemplo:
Placeholders: ["FUENTE_PRINCIPAL", "EJEMPLO_HISTORICO", "ESTUDIO_CLAVE"]
Resultado: ["FUENTE_PRINCIPAL", "ESTUDIO_CLAVE"]
(Razón: EJEMPLO_HISTORICO puede elegirse del conocimiento general; los otros requieren citas específicas)`;

const FILL_SYSTEM_PROMPT = `Eres un investigador experto y escritor fantasma. Tu tarea es definir los valores de placeholders factuales para el capítulo de un libro.

## Entrada
- Tema del proyecto: qué cubre el libro
- Nombres de placeholders: los {placeholders} que necesitan definición (todos factuales)
- Content Prompts: los prompts del capítulo para contexto
- Resultados de búsqueda: hallazgos de búsqueda web (si los hay)
- Source Material: fragmentos de tus documentos subidos que coinciden con este placeholder (si los hay)

## Instrucciones

### Calidad de fuentes
Antes de definir cada placeholder, evalúa los resultados de búsqueda y el material de fuentes:
- ¿El resultado trata directamente el tema del placeholder y del proyecto? Si no, descártalo.
- ¿El contenido es específico (nombres, fechas, datos) o es genérico (reformulaciones vagas)? Solo usa contenido específico.
- ¿La fuente es confiable (paper académico, institución reconocida, publicación verificable)? Prioriza estas.
- Si tienes Source Material de tus documentos, PREFIÉRELO sobre los resultados de búsqueda web. Son tus fuentes curadas.

Si ningún resultado pasa estos criterios, NO uses los resultados. Responde con tu mejor conocimiento pero no inventes fuentes ni cifras.

### Definiciones
1. Para placeholders CON fuentes de calidad: extrae y cita nombres, fechas, instituciones o datos de las fuentes
2. Para placeholders SIN fuentes de calidad: elige el ejemplo, caso o referencia más pertinente y específico que se ajuste al tema. No inventes citas
3. Cada definición: 1-3 oraciones, directamente usable en un párrafo del libro (no una meta-descripción)
4. Alinea cada definición con el tema del proyecto y los content prompts
5. Responde ÚNICAMENTE con JSON válido: {"placeholders": {"NOMBRE": "definición", ...}}

## Ejemplo
Placeholders: ["FUENTE_PRINCIPAL", "ESTUDIO_CLAVE"]
Resultados de búsqueda: un paper de PNAS 2018 por Milkman et al. sobre nudges de vacunación (relevante, específico, académico — cumple los criterios de calidad)
Respuesta: {"placeholders": {"FUENTE_PRINCIPAL": "El estudio de 2018 publicado en PNAS por Katherine Milkman y colegas de la Universidad de Pennsylvania, que demostró que los recordatorios de planificación aumentaron las tasas de vacunación contra la gripe en 4.2 puntos porcentuales entre 37,000 empleados", "ESTUDIO_CLAVE": "Un ensayo controlado aleatorizado publicado en The Lancet Digital Health (2021) que mostró que los recordatorios personalizados por mensaje de texto mejoraron la adherencia a la medicación en un 14% entre pacientes hipertensos durante 12 meses"}}`;

export async function researchPlaceholders(
  placeholderNames: string[],
  projectTopic: string | null,
): Promise<Record<string, SearchResult[]>> {
  if (placeholderNames.length === 0) return {};

  // Phase 1a: Decide which placeholders need research
  const decisionPrompt = `${RESEARCH_DECISION_PROMPT}\n\nProject topic: ${projectTopic || "(none)"}\nPlaceholders: ${JSON.stringify(placeholderNames)}`;

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
    needsResearch = placeholderNames;
  }

  // Phase 1b: Execute searches
  if (needsResearch.length === 0) return {};

  const queryToName = new Map<string, string>();
  const searchQueries = needsResearch.map((name) => {
    const readable = name.replace(/_/g, " ").toLowerCase();
    const query = `${readable} ${projectTopic || ""}`.trim();
    queryToName.set(query, name);
    return query;
  });

  // Sequential searches to avoid rate limits
  const results: Record<string, SearchResult[]> = {};
  for (const query of searchQueries) {
    const name = queryToName.get(query);
    if (!name) continue;
    try {
      results[name] = await webSearch(query);
    } catch (err) {
      console.warn(`[web-search] Failed for {${name}}:`, (err as Error).message);
      results[name] = [];
    }
  }

  return results;
}

export async function researchPlaceholdersWithRag(
  placeholderNames: string[],
  projectTopic: string | null,
  projectId: string,
  placeholderFunctions: Record<string, { function?: string | null; notes?: string | null }>,
): Promise<{
  searchResults: Record<string, SearchResult[]>;
  ragContexts: Record<string, string>;
}> {
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

  const ragContexts: Record<string, string> = {};
  for (const name of ragNames) {
    try {
      const query = `${name.replace(/_/g, " ")} ${projectTopic ?? ""}`;
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

  const searchResults = webNames.length > 0
    ? await researchPlaceholders(webNames, projectTopic)
    : {};

  return { searchResults, ragContexts };
}

export async function* fillPlaceholders(
  placeholderNames: string[],
  promptContents: string[],
  searchResults: Record<string, SearchResult[]>,
  model: string = DEFAULT_MODEL,
  customSystemPrompt?: string,
  effort?: ReasoningEffort,
  temperature?: number,
  ragContexts?: Record<string, string>,
): AsyncGenerator<PlaceholderFillEvent> {
  const systemPrompt = customSystemPrompt || FILL_SYSTEM_PROMPT;

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

  let ragContext = "";
  if (ragContexts && Object.keys(ragContexts).length > 0) {
    ragContext = "\n\n## Source Material (from your documents)\n";
    for (const [name, ctx] of Object.entries(ragContexts)) {
      ragContext += `\n### ${name.replace(/_/g, " ")}\n${ctx}\n`;
    }
  }

  const userPrompt = `## Content Prompts (for context)
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
  projectTopic: string | null,
  promptContents: string[],
  existingDefinitions: Record<string, string>,
  model: string = DEFAULT_MODEL,
  customSystemPrompt?: string,
  effort?: ReasoningEffort,
  temperature?: number,
): Promise<{ definition: string; sources: SearchResult[] }> {
  const query = `${name.replace(/_/g, " ")} ${projectTopic || ""}`.trim();
  let sources: SearchResult[] = [];
  try {
    sources = await webSearch(query);
  } catch (err) {
    console.warn(`[web-search] Failed for single {${name}}:`, (err as Error).message);
  }

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
- Evalúa los resultados de búsqueda: ¿tratan directamente el tema del placeholder? ¿Son específicos o genéricos? ¿La fuente es confiable?
- Si los resultados son relevantes y específicos, extrae datos, nombres, fechas e instituciones de ellos
- Si ningún resultado es útil, descártalos y responde con tu mejor conocimiento sin inventar fuentes ni cifras

Reglas:
- La definición debe ser de 1-3 oraciones, directamente usable en un párrafo del libro (no una meta-descripción)
- Alinea la definición con el tema del proyecto y los content prompts del capítulo
- Responde ÚNICAMENTE: {"definition": "..."}

Ejemplo:
Placeholder: {CASO_ESTUDIO}
Tema: "La aplicación de los seis principios de persuasión de Cialdini en campañas de salud pública, cubriendo reciprocidad, escasez y prueba social con casos documentados de cambios de comportamiento a escala poblacional"
Resultados de búsqueda: [resultados sobre campañas reales de salud pública]
Respuesta: {"definition": "La campaña 'Truth' antitabaco en Estados Unidos (2000-2014), que aplicó el principio de prueba social al mostrar adolescentes rechazando la manipulación de las tabacaleras, redujo el tabaquismo juvenil del 23% al 7% según un estudio del CDC publicado en 2015 en American Journal of Public Health"}`;

  const userPrompt = `## Existing Placeholder Definitions (for context)
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
