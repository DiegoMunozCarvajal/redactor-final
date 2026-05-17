type SectionRole = "hook" | "opening" | "mechanism" | "evidence" | "scene" | "turn" | "reflection" | "practice" | "landing";

interface UnitBriefSmallBook {
  coreLesson?: string | null;
}

interface UnitBriefSmallBookEs {
  coreLesson?: string | null;
}
import { z } from "zod";

// ---------------------------------------------------------------------------
// Exa client (primary) — always creates a fresh instance per call
// ---------------------------------------------------------------------------

async function getExaClient() {
  if (!process.env.EXA_API_KEY) return null;
  const Exa = (await import("exa-js")).default;
  return new Exa(process.env.EXA_API_KEY);
}

// ---------------------------------------------------------------------------
// Tavily client (fallback) — always creates a fresh instance per call
// ---------------------------------------------------------------------------

async function getTavilyClient() {
  if (!process.env.TAVILY_API_KEY) return null;
  const { tavily: createClient } = await import("@tavily/core");
  return createClient({ apiKey: process.env.TAVILY_API_KEY });
}

// ---------------------------------------------------------------------------
// Search providers (internal)
// ---------------------------------------------------------------------------

interface SearchResult {
  title: string;
  url: string;
  content: string;
}

async function searchWithExa(query: string, numResults = 3): Promise<string | null> {
  const client = await getExaClient();
  if (!client) throw new Error("Exa not configured");

  const response = await client.search(query, {
    type: "auto",
    numResults,
    contents: { text: { maxCharacters: 1000 } },
  });

  const results = extractExaText(response.results);
  if (results.length === 0) return null;

  return formatSearchResults(results);
}

function extractExaText(
  rawResults: Array<{ title: string | null; url: string; text?: string }>,
): SearchResult[] {
  const results: SearchResult[] = [];
  for (const r of rawResults) {
    if (!r.text) continue;
    const content = r.text.trim();
    if (!content) continue;
    results.push({ title: r.title ?? "Untitled", url: r.url, content });
  }
  return results;
}

async function searchWithTavily(query: string, numResults = 3): Promise<string> {
  const client = await getTavilyClient();
  if (!client) throw new Error("Tavily not configured");

  const response = await client.search(query, {
    searchDepth: "advanced",
    maxResults: numResults,
    topic: "general",
  });

  if (!response.results || response.results.length === 0) return "None.";

  const results: SearchResult[] = response.results.map(
    (r: { title: string; url: string; content: string }) => ({
      title: r.title,
      url: r.url,
      content: r.content,
    }),
  );

  return formatSearchResults(results);
}

function formatSearchResults(results: SearchResult[]): string {
  return results
    .map(
      (r) =>
        `Title: ${r.title}\nURL: ${r.url}\nContent: ${r.content}`,
    )
    .join("\n\n---\n\n");
}

function parseFormattedResults(text: string): SearchResult[] {
  if (text === "None.") return [];
  const blocks = text.split(/\n\n---\n\n/);
  const results: SearchResult[] = [];
  for (const block of blocks) {
    const titleMatch = block.match(/^Title: (.+)$/m);
    const urlMatch = block.match(/^URL: (.+)$/m);
    const contentMatch = block.match(/^Content: ([\s\S]+)$/m);
    if (titleMatch && urlMatch && contentMatch) {
      results.push({
        title: titleMatch[1].trim(),
        url: urlMatch[1].trim(),
        content: contentMatch[1].trim(),
      });
    }
  }
  return results;
}

const REFINE_QUERY_MODEL = "gpt-5.4-mini";
const RANK_MODEL = "gpt-5.4-mini";
const RANK_INDICES_SCHEMA = z.object({
  indices: z.array(z.number().int().min(0)).min(1).max(3),
});

const SECTION_ROLE_PURPOSE: Record<SectionRole, string> = {
  hook: "Provocative grab — stat, quote, question, or bold claim that hooks the reader",
  opening: "Problem + promise. Sets reader expectations for what this chapter delivers",
  mechanism: "How something works — step-by-step theory or framework explanation",
  evidence: "Data, studies, or expert sources backing the claim with empirical weight",
  scene: "Real story or case study illustrating the mechanism in human terms",
  turn: "Perspective shift — reader sees the problem differently after this section",
  reflection: "Pause for the reader to connect ideas to their own life through questions",
  practice: "Actionable steps, exercise, or protocol the reader executes immediately",
  landing: "Chapter closing — summary, resolution, key takeaway, transition out",
};

// ---------------------------------------------------------------------------
// Section role query builder
// ---------------------------------------------------------------------------

// Roles where web search adds no value — the model already writes these better
// from the chapter brief than from random internet text.
export const SKIP_SEARCH_ROLES: Set<SectionRole> = new Set([
  "opening",
  "mechanism",
  "turn",
  "reflection",
  "practice",
  "landing",
]);

// Queries search for real human-written content — structure, voice, and craft
// that the model can observe before writing in THIS book's voice.
const ROLE_QUERY_TEMPLATES: Record<SectionRole, (topic: string, coreLesson: string, audience: string) => string> = {
  hook: (_topic, coreLesson, audience) =>
    `real firsthand story or surprising statistic about ${coreLesson} for ${audience}`,

  opening: () => "",

  mechanism: () => "",

  evidence: (_topic, coreLesson, _audience) =>
    `real data actual research finding empirical evidence about ${coreLesson}`,

  scene: (_topic, coreLesson, audience) =>
    `personal transformation story before and after about ${audience} who experienced ${coreLesson}`,

  turn: () => "",

  reflection: () => "",

  practice: () => "",

  landing: () => "",
};

export const SEARCH_PARAMS_PER_ROLE: Record<SectionRole, { numResults: number }> = {
  hook:       { numResults: 4 },
  opening:    { numResults: 3 },
  mechanism:  { numResults: 4 },
  evidence:   { numResults: 5 },
  scene:      { numResults: 4 },
  turn:       { numResults: 3 },
  reflection: { numResults: 2 },
  practice:   { numResults: 4 },
  landing:    { numResults: 2 },
};

export function buildSectionWebQuery(
  role: SectionRole,
  topic: string,
  coreLesson: string,
  audience: string,
): string {
  const builder = ROLE_QUERY_TEMPLATES[role];
  return builder(topic, coreLesson, audience);
}

// ---------------------------------------------------------------------------
// Query refinement
// ---------------------------------------------------------------------------

export async function refineSearchQuery(
  rawQuery: string,
  chapterBrief: UnitBriefSmallBook,
  sectionRole: SectionRole,
): Promise<string> {
  const coreLesson = chapterBrief.coreLesson ?? "";
  const rolePurpose = SECTION_ROLE_PURPOSE[sectionRole];

  const systemPrompt = [
    "You are a search query engineer for a nonfiction book writing system.",
    "Your job is to rewrite a base search query to find the most specific, high-quality sources for a book section.",
    "",
    "Rules:",
    "- Add concrete terms from the chapter's core lesson.",
    "- Use 2-3 variant phrasings or synonyms. Don't overfit to exact wording.",
    "- Remove generic filler words like 'nonfiction', 'writing examples', 'psychological explanation'.",
    "- Keep the query under 500 characters.",
    "- Output ONLY the refined query string. No explanation, no quotes, no markdown.",
  ].join("\n");

  const userPrompt = [
    `SECTION ROLE: ${sectionRole}`,
    `ROLE PURPOSE: ${rolePurpose}`,
    `CORE LESSON: ${coreLesson}`,
    "",
    `BASE QUERY: ${rawQuery}`,
  ].join("\n");

  try {
    const { generateCompletion } = await import("@/lib/ai/completion");
    const result = await generateCompletion({
      model: REFINE_QUERY_MODEL,
      systemPrompt,
      userPrompt,
      temperature: 0.3,
      maxTokens: 200,
    });

    const refined = result.data.trim();
    if (!refined || refined.length < 10) return rawQuery;
    return refined.length > 500 ? refined.slice(0, 500) : refined;
  } catch (error) {
    console.warn(`[web-search] Query refinement failed, using raw query:`, error);
    return rawQuery;
  }
}

// ---------------------------------------------------------------------------
// Deterministic pre-ranker — skip LLM ranking when top results are clearly separated
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "can", "shall", "to", "of", "in", "for",
  "on", "with", "at", "by", "from", "as", "into", "through", "during",
  "before", "after", "above", "below", "between", "under", "again",
  "further", "then", "once", "here", "there", "when", "where", "why",
  "how", "all", "both", "each", "few", "more", "most", "other", "some",
  "such", "no", "nor", "not", "only", "own", "same", "so", "than",
  "too", "very", "just", "because", "about", "what", "which", "who",
  "this", "that", "these", "those", "and", "but", "or", "if", "while",
  // Spanish stop words — shared tokenizer used for both languages
  "de", "la", "que", "el", "en", "los", "las", "un", "una", "del",
  "por", "con", "para", "como", "más", "pero", "entre", "hay", "muy",
  "todo", "cada", "sin", "su", "sus", "al", "lo", "le", "les", "se",
  "han", "fue", "era", "son", "ser", "estar", "está", "están",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}0-9\s]/gu, "")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

function scoreResult(result: SearchResult, keywords: string[]): number {
  const titleTokens = new Set(tokenize(result.title));
  const contentTokens = tokenize(result.content);
  const allTokens = new Set([...titleTokens, ...contentTokens]);

  let matches = 0;
  for (const kw of keywords) {
    if (allTokens.has(kw)) matches += 1;
    else {
      const partialMatch = [...allTokens].some(
        (t) => t.includes(kw) || kw.includes(t),
      );
      if (partialMatch) matches += 0.5;
    }
  }

  return keywords.length > 0 ? matches / keywords.length : 0;
}

function deterministicRank(
  results: SearchResult[],
  coreLesson: string,
): { ranked: SearchResult[]; skipLLM: boolean } {
  const keywords = tokenize(coreLesson);
  if (keywords.length === 0 || results.length <= 2) {
    return { ranked: results.slice(0, 3), skipLLM: true };
  }

  const scored = results.map((r, i) => ({ result: r, score: scoreResult(r, keywords), index: i }));
  scored.sort((a, b) => b.score - a.score);

  const top3 = scored.slice(0, 3);
  const rest = scored.slice(3);

  const skipLLM =
    results.length <= 3 ||
    (rest.length > 0 && top3[top3.length - 1].score > rest[0].score * 1.5);

  return {
    ranked: top3.map((s) => s.result),
    skipLLM,
  };
}

// ---------------------------------------------------------------------------
// LLM-based result ranking (fallback)
// ---------------------------------------------------------------------------

export async function rankSearchResults(
  formattedText: string,
  sectionRole: SectionRole,
  chapterBrief: UnitBriefSmallBook,
): Promise<string> {
  if (formattedText === "None.") return formattedText;

  const results = parseFormattedResults(formattedText);
  if (results.length <= 2) return formattedText;

  const coreLesson = chapterBrief.coreLesson ?? "";

  const { ranked, skipLLM } = deterministicRank(results, coreLesson);
  if (skipLLM) {
    return formatSearchResults(ranked);
  }

  const rolePurpose = SECTION_ROLE_PURPOSE[sectionRole];

  const systemPrompt = [
    "You rank search results by relevance to a nonfiction book section.",
    "For each result, evaluate:",
    "1. Does it contain concrete examples, stories, or data (not generic fluff)?",
    "2. Does it match the section role's purpose?",
    "3. Is it credible and specific?",
    "",
    `SECTION ROLE: ${sectionRole} — ${rolePurpose}`,
    `CORE LESSON: ${coreLesson}`,
    "",
    "Output ONLY a JSON object with an indices array (0-based, max 3), ordered best-first. Example: {\"indices\": [2, 0, 4]}",
    "Include indices that point to genuinely useful results. Skip irrelevant ones.",
    "Do NOT include indices that don't exist in the input.",
  ].join("\n");

  const resultsList = results
    .map((r, i) => `[${i}] Title: ${r.title}\n    Snippet: ${r.content.slice(0, 300)}`)
    .join("\n\n");

  const userPrompt = `Results to rank:\n\n${resultsList}`;

  try {
    const { generateCompletion } = await import("@/lib/ai/completion");
    const { data } = await generateCompletion({
      model: RANK_MODEL,
      systemPrompt,
      userPrompt,
      schema: RANK_INDICES_SCHEMA,
      temperature: 0.2,
      maxTokens: 100,
    });

    const { indices } = data;
    const validIndices = results.map((_, i) => i);
    const cleanIndices = indices.filter((i) => validIndices.includes(i));
    if (cleanIndices.length === 0) {
      return formatSearchResults(results.slice(0, 3));
    }

    const llmRanked = cleanIndices
      .slice(0, 3)
      .map((i) => results[i])
      .filter(Boolean);

    return formatSearchResults(llmRanked);
  } catch (error) {
    console.warn(`[web-search] Result ranking failed, using deterministic top 3:`, error);
    return formatSearchResults(ranked);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function searchWeb(
  query: string,
  cache?: Map<string, string>,
  opts?: { numResults?: number },
): Promise<string> {
  const numResults = opts?.numResults ?? 3;
  const cached = cache?.get(query);
  if (cached !== undefined) return cached;

  let result: string | null = null;

  // Try Exa first
  try {
    result = await searchWithExa(query, numResults);
  } catch (error) {
    const hasExaKey = Boolean(process.env.EXA_API_KEY);
    if (hasExaKey) {
      console.warn(`[web-search] Exa search failed, falling back to Tavily:`, error);
    }
  }

  // Fallback to Tavily
  if (result === null) {
    try {
      result = await searchWithTavily(query, numResults);
    } catch (error) {
      const hasTavilyKey = Boolean(process.env.TAVILY_API_KEY);
      if (hasTavilyKey) {
        console.warn(`[web-search] Tavily search failed for query "${query}":`, error);
      }
    }
  }

  if (result === null) {
    result = "None.";
  }

  cache?.set(query, result);
  return result;
}

// ---------------------------------------------------------------------------
// Bilingual search — Spanish first, English fallback when Spanish web has
// sparse results for niche nonfiction queries
// ---------------------------------------------------------------------------

// Simplified English fallback templates — use only topic + audience (not coreLesson,
// which is Spanish text that garbles English queries). These are intentionally broader
// than the Spanish role templates; Exa/Tavily handle broad English queries well.
const FALLBACK_QUERY_TEMPLATES: Record<SectionRole, (topic: string, audience: string) => string> = {
  hook: (topic, audience) =>
    `real story or surprising fact about ${topic} for ${audience}`,
  opening: () => "",
  mechanism: () => "",
  evidence: (topic, _audience) =>
    `research data statistics study about ${topic}`,
  scene: (topic, audience) =>
    `personal story transformation about ${audience} ${topic}`,
  turn: () => "",
  reflection: () => "",
  practice: () => "",
  landing: () => "",
};

export async function searchWebBilingualEs(
  spanishQuery: string,
  topic: string,
  coreLesson: string,
  audience: string,
  sectionRole: SectionRole,
  cache?: Map<string, string>,
  opts?: { numResults?: number },
): Promise<string> {
  const numResults = opts?.numResults ?? 3;

  const spanishResult = await searchWeb(spanishQuery, cache, { numResults });
  if (spanishResult !== "None.") return spanishResult;

  // Spanish web returned nothing — fall back to English query.
  // Use simplified template without coreLesson (Spanish text garbles English queries).
  const fallbackBuilder = FALLBACK_QUERY_TEMPLATES[sectionRole];
  const englishQuery = fallbackBuilder(topic, audience);
  if (!englishQuery) return "None.";

  console.warn(`[web-search] Spanish query returned no results, trying English fallback for role "${sectionRole}"`);
  const englishResult = await searchWeb(englishQuery, cache, { numResults });
  return englishResult;
}

// ---------------------------------------------------------------------------
// Spanish query templates and functions
// ---------------------------------------------------------------------------

const ROLE_QUERY_TEMPLATES_ES: Record<SectionRole, (topic: string, coreLesson: string, audience: string) => string> = {
  hook: (_topic, coreLesson, audience) =>
    `historia real en primera persona o estadística sorprendente sobre ${coreLesson} para ${audience}`,

  opening: () => "",

  mechanism: () => "",

  evidence: (_topic, coreLesson, _audience) =>
    `datos reales investigación empírica hallazgos científicos sobre ${coreLesson}`,

  scene: (_topic, coreLesson, audience) =>
    `historia de transformación personal antes y después sobre ${audience} que vivió ${coreLesson}`,

  turn: () => "",

  reflection: () => "",

  practice: () => "",

  landing: () => "",
};

export function buildSectionWebQueryEs(
  role: SectionRole,
  topic: string,
  coreLesson: string,
  audience: string,
): string {
  const builder = ROLE_QUERY_TEMPLATES_ES[role];
  return builder(topic, coreLesson, audience);
}

export async function refineSearchQueryEs(
  rawQuery: string,
  chapterBrief: UnitBriefSmallBookEs,
  sectionRole: SectionRole,
): Promise<string> {
  const coreLesson = chapterBrief.coreLesson ?? "";
  const rolePurpose = SECTION_ROLE_PURPOSE_ES[sectionRole];

  const systemPrompt = [
    "Eres un ingeniero de consultas de búsqueda para un sistema de escritura de",
    "libros de no ficción. Tu trabajo es reescribir una consulta base para encontrar",
    "las fuentes más específicas y de mayor calidad para una sección del libro.",
    "",
    "Reglas:",
    "- Añade términos concretos de la lección central del capítulo.",
    "- Usa 2-3 variantes de redacción o sinónimos. No sobreajustes a la redacción",
    "  exacta.",
    "- Elimina palabras de relleno genéricas como 'no ficción', 'ejemplos de",
    "  escritura', 'explicación psicológica'.",
    "- Mantén la consulta por debajo de 500 caracteres.",
    "- Devuelve SOLO la consulta refinada. Sin explicación, sin comillas, sin",
    "  markdown.",
  ].join("\n");

  const userPrompt = [
    `ROL DE SECCIÓN: ${sectionRole}`,
    `PROPÓSITO DEL ROL: ${rolePurpose}`,
    `LECCIÓN CENTRAL: ${coreLesson}`,
    "",
    `CONSULTA BASE: ${rawQuery}`,
  ].join("\n");

  try {
    const { generateCompletion } = await import("@/lib/ai/completion");
    const result = await generateCompletion({
      model: REFINE_QUERY_MODEL,
      systemPrompt,
      userPrompt,
      temperature: 0.3,
      maxTokens: 200,
    });

    const refined = result.data.trim();
    if (!refined || refined.length < 10) return rawQuery;
    return refined.length > 500 ? refined.slice(0, 500) : refined;
  } catch (error) {
    console.warn(`[web-search] Refinamiento de consulta fallido, usando consulta base:`, error);
    return rawQuery;
  }
}

const SECTION_ROLE_PURPOSE_ES: Record<SectionRole, string> = {
  hook: "Gancho provocador — estadística, cita, pregunta o afirmación audaz que atrapa al lector",
  opening: "Problema + promesa. Establece las expectativas del lector sobre lo que el capítulo entrega",
  mechanism: "Cómo funciona algo — teoría o marco paso a paso",
  evidence: "Datos, estudios o fuentes expertas que respaldan la afirmación con peso empírico",
  scene: "Historia real o caso de estudio que ilustra el mecanismo en términos humanos",
  turn: "Giro de perspectiva — el lector ve el problema de forma distinta después de esta sección",
  reflection: "Pausa para que el lector conecte ideas con su propia vida a través de preguntas",
  practice: "Pasos accionables, ejercicio o protocolo que el lector ejecuta de inmediato",
  landing: "Cierre de capítulo — resumen, resolución, conclusión clave, transición de salida",
};

export async function rankSearchResultsEs(
  formattedText: string,
  sectionRole: SectionRole,
  chapterBrief: UnitBriefSmallBookEs,
): Promise<string> {
  if (formattedText === "None." || formattedText === "Ninguno.") return formattedText;

  const results = parseFormattedResults(formattedText);
  if (results.length <= 2) return formattedText;

  const coreLesson = chapterBrief.coreLesson ?? "";

  const { ranked, skipLLM } = deterministicRank(results, coreLesson);
  if (skipLLM) {
    return formatSearchResults(ranked);
  }

  const rolePurpose = SECTION_ROLE_PURPOSE_ES[sectionRole];

  const systemPrompt = [
    "Clasificas resultados de búsqueda por relevancia para una sección de libro",
    "de no ficción.",
    "Para cada resultado, evalúa:",
    "1. ¿Contiene ejemplos concretos, historias o datos (no paja genérica)?",
    "2. ¿Coincide con el propósito del rol de la sección?",
    "3. ¿Es creíble y específico?",
    "",
    `ROL DE SECCIÓN: ${sectionRole} — ${rolePurpose}`,
    `LECCIÓN CENTRAL: ${coreLesson}`,
    "",
    "Devuelve SOLO un objeto JSON con un array indices (base 0, máx 3), ordenado",
    'mejor primero. Ejemplo: {"indices": [2, 0, 4]}',
    "Incluye índices que apunten a resultados genuinamente útiles. Omite los",
    "irrelevantes. No incluyas índices que no existan en la entrada.",
  ].join("\n");

  const resultsList = results
    .map((r, i) => `[${i}] Título: ${r.title}\n    Fragmento: ${r.content.slice(0, 300)}`)
    .join("\n\n");

  const userPrompt = `Resultados a clasificar:\n\n${resultsList}`;

  try {
    const { generateCompletion } = await import("@/lib/ai/completion");
    const { data } = await generateCompletion({
      model: RANK_MODEL,
      systemPrompt,
      userPrompt,
      schema: RANK_INDICES_SCHEMA,
      temperature: 0.2,
      maxTokens: 100,
    });

    const { indices } = data;
    const validIndices = results.map((_, i) => i);
    const cleanIndices = indices.filter((i) => validIndices.includes(i));
    if (cleanIndices.length === 0) {
      return formatSearchResults(results.slice(0, 3));
    }

    const llmRanked = cleanIndices
      .slice(0, 3)
      .map((i) => results[i])
      .filter(Boolean);

    return formatSearchResults(llmRanked);
  } catch (error) {
    console.warn(`[web-search] Clasificación de resultados fallida, usando top 3 determinístico:`, error);
    return formatSearchResults(ranked);
  }
}
