import { generateCompletion, type ReasoningEffort } from "./completion";
import { DEFAULT_GENERATION_MODEL } from "./providers";
import { searchSemanticScholar, type SearchResult } from "./web-search";
import { retrieveContext } from "./rag";
import { inferPlaceholderProvider } from "@/lib/placeholder-research";
import { db } from "@/lib/db";
import { chapterPlaceholders, chapters } from "@/lib/db/schema";
import { eq, and, not, isNotNull } from "drizzle-orm";
import { checkBlocklist, assertOriginalEnough, OriginalityError } from "./originality-check";
import type { EditorialBundle } from "@/lib/editorial-brief/schema";

export type { SearchResult };

/** Escape user-generated text for safe insertion inside XML-like prompt tags.
 *  Prevents RAG/snippet content containing `</content>` or `</research_results>`
 *  from breaking prompt framing or injecting instructions into downstream LLM calls. */
function escapeXmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export interface PlaceholderFillEvent {
  type: "placeholder" | "done" | "error" | "cancelled";
  name?: string;
  definition?: string;
  sources?: SearchResult[];
  ragChunks?: number;
  /** Research provider used: "rag" | "semantic-scholar" | "llm" | "direct" | "reused" */
  provider?: string;
  error?: string;
  /** Index of current placeholder being filled (0-based) */
  current?: number;
  /** Total placeholders to fill */
  total?: number;
}

// Default model for generation if none specified
const DEFAULT_MODEL = DEFAULT_GENERATION_MODEL;

export function extractJson(text: string): unknown {
  // Phase 1: Direct parse — works for well-formed JSON
  try {
    return JSON.parse(text.trim());
  } catch {}

  // Phase 2: JSON in fenced code blocks (```json ... ``` or ``` ... ```)
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {}
  }

  // Phase 3: Find the outermost JSON object with string-aware brace counting.
  // Handles nested braces, text before/after JSON, and concatenated JSON objects
  // (takes the first valid one). Skips braces inside JSON strings to avoid
  // false depth from string content like "use {placeholder} here".
  let depth = 0;
  let start = -1;
  let inString = false;
  let escapeNext = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") { escapeNext = true; }
      else if (ch === "\"") { inString = false; }
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        const candidate = text.slice(start, i + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          // Try to salvage: fix common JSON issues in the extracted block
          const salvaged = candidate
            .replace(/,\s*}/g, "}")
            .replace(/,\s*\]/g, "]");
          try {
            return JSON.parse(salvaged);
          } catch {
            // Continue searching for another JSON block
            start = -1;
            continue;
          }
        }
      }
    }
  }

  // Phase 4: Last resort — fix common issues globally, then try lazy match
  // (first complete JSON object, not greedy which would span multiple objects)
  const cleaned = text
    .replace(/,\s*}/g, "}")
    .replace(/,\s*\]/g, "]")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  const objMatch = cleaned.match(/\{[\s\S]*?\}/);
  if (objMatch) {
    try {
      return JSON.parse(objMatch[0]);
    } catch {}
  }

  throw new Error("Could not parse JSON from response");
}

// Placeholder names that resolve directly from project data (no LLM)
export function resolveDirectly(
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

/** Build a search query from placeholder metadata, not just the placeholder name.
 *  Uses `function` as primary intent descriptor — it explains what content the
 *  placeholder needs, which yields better search results than underscore_names. */
export function buildSearchQuery(ph: PlaceholderDef, projectTopic: string | null): string {
  const topic = projectTopic ?? "";

  if (ph.function && ph.function.length > 0) {
    // Function describes intent: "El esfuerzo para eliminar un mal hábito"
    // Strip leading articles for a cleaner query
    const funcClean = ph.function
      .replace(/^(El |La |Los |Las |Un |Una |Unos |Unas )/, "")
      .trim();
    return `${funcClean} ${topic}`.trim();
  }

  // Fallback: use placeholder name with underscores replaced
  const nameReadable = ph.name.replace(/_/g, " ");
  return `${nameReadable} ${topic}`.trim();
}

const INDIVIDUAL_FILL_SYSTEM_PROMPT = `Eres un investigador experto y escritor fantasma. Tu tarea es definir UN placeholder para el capítulo de un libro.

## Distinción clave entre tipos de entrada

En el prompt del usuario verás varias secciones. Es crítico que distingas su función:

1. **Función y Notas del placeholder**: Definen el PROPÓSITO del placeholder — qué debe contener, tono, extensión, tipo de contenido. Úsalas como guía para formatear y enfocar tu respuesta.

2. **Contexto de los prompts del capítulo**: Proveen el tono, alcance y tema general del capítulo. Úsalos para orientación contextual. NUNCA copies texto directamente de esta sección — es material de referencia, no contenido para insertar.

3. **Research Results (RAG · documentos subidos)**: Material extraído de los documentos que el usuario subió al proyecto. Es la fuente primaria de contenido. DEBES usar este material como inspiración y adaptarlo para crear ejemplos genéricos y transferibles.

4. **Research Results (Web / Semantic Scholar)**: Resultados de búsqueda externa para verificación factual. Evalúa su relevancia y confiabilidad antes de usarlos.

5. **📄 Fuentes originales de los prompts**: Fragmentos del texto fuente que inspiró cada prompt del capítulo. Son material de referencia para entender el dominio y el tono del contenido original. NUNCA copies texto de esta sección. Si la fuente contiene casos o anécdotas, extrae el patrón subyacente y crea uno distinto. Si hay tensión con cualquier otra sección, las fuentes originales tienen la MENOR prioridad — son solo contexto.

## Regla de prioridad

- Si hay tensión entre las NOTAS y los PROMPTS DEL CAPÍTULO → las NOTAS tienen prioridad.
- Si hay tensión entre las NOTAS y los DOCUMENTOS SUBIDOS (RAG) → el RAG tiene prioridad. Las notas solo guían CÓMO adaptar el material, no si debes usarlo.
- Si hay tensión entre las NOTAS y la BÚSQUEDA WEB/Semantic Scholar → las NOTAS tienen prioridad (la búsqueda externa es complementaria).
- Las FUENTES ORIGINALES tienen la menor prioridad en cualquier conflicto. Si contradicen las notas, los prompts o el research, ignóralas.

## 🚫 Prohibición de propiedad intelectual

No reproduzcas elementos creativos distintivos de libros conocidos. Esto incluye:

- **Metáforas insignia**: el bambú de James Clear, el hielo que se derrite, la acumulación de pequeñas mejoras del 1%, el avión que se desvía 1 grado — cualquier metáfora que un lector reconocería como "la metáfora de [autor]".
- **Historias y anécdotas célebres**: el equipo de ciclismo británico, los médicos que se lavan las manos, el malvavisco de Stanford — cualquier historia que esté indisolublemente asociada a un libro o autor específico.
- **Marcos conceptuales con nombre propio**: "las 4 leyes del cambio de conducta", "el círculo dorado", "los 7 hábitos" — cualquier framework que un autor haya bautizado y publicado.
- **Ejemplos que son la firma de un autor**: el experimento de los monos y la escalera, el pez que no descubre el agua, el elefante y el jinete — cualquier ejemplo que identifiques como proveniente de un libro best-seller.

Si detectas que un resultado de búsqueda está parafraseando un libro famoso, NO uses ese material. Crea una ilustración original que comunique la misma idea sin tomar prestada la propiedad creativa de otro autor. Si no se te ocurre una alternativa original, usa una descripción conceptual directa sin metáforas.

## Instrucciones

1. **Primero, entiende la función y las notas**: te dicen el propósito del placeholder, cómo se relaciona con otros placeholders mencionados en el contexto del capítulo, la extensión recomendada, el tono sugerido y el tipo de contenido esperado. Adhiérete estrictamente a ellas en cuanto a formato, tono y extensión, pero nunca permitas que las notas te hagan ignorar el material de documentos subidos (RAG).

2. **Procesa las fuentes originales (si están presentes)**: la sección 📄 Fuentes originales contiene el texto fuente que inspiró los prompts del capítulo. Este material es para entender el dominio, el tono y el tipo de contenido que el autor original manejaba. **NUNCA copies frases textuales, metáforas, ejemplos concretos ni historias de estas fuentes.** **NUNCA incluyas nombres propios, datos personales, ubicaciones ni información identificable de las fuentes originales en tu definición.** Si la fuente contiene un caso o anécdota, generaliza el patrón subyacente y crea uno distinto. El objetivo es que tu definición esté informada por el contexto pero sea completamente original.

3. **Luego, procesa los resultados de búsqueda según su tipo**:

**Si el research es RAG (documentos subidos):**
No apliques los criterios de evaluación estándar. En lugar de evaluar si usar o no el material, ADÁPTALO siguiendo este proceso:
- Identifica el patrón, principio o lección que ilustra el contenido subido
- Extrae la estructura subyacente (ej. "alguien enfrenta un obstáculo → aplica un principio → obtiene un resultado")
- Crea un ejemplo genérico que ilustre ese mismo patrón, pero sin mencionar nombres reales, empresas, fechas concretas ni detalles identificables
- Asegúrate de que el ejemplo funcione en cualquier dominio y para cualquier lector
Usa el siguiente formato para razonar en voz alta:

<evaluacion>
- Patrón identificado en el material subido: [describe el patrón o principio]
- Elementos a preservar: [qué estructura, lección o dinámica es transferible]
- Elementos a descartar o generalizar: [nombres, lugares, fechas, detalles identificables]
- Adaptación: [tu ejemplo genérico basado en el patrón extraído]
</evaluacion>

**Si el research es búsqueda web o Semantic Scholar:**
Evalúa los resultados con estos criterios:
- ¿Tratan directamente el tema del placeholder y del proyecto? Si no, descártalos.
- ¿El contenido es específico (nombres, fechas, datos) o genérico? Solo usa contenido específico.
- ¿La fuente es confiable (paper académico, institución reconocida, publicación verificable)? Prioriza estas.
Usa el siguiente formato:

<evaluacion>
- Resultado 1: ¿Trata directamente el tema? [Sí/No]. ¿Específico? [Sí/No]. ¿Fuente confiable? [Sí/No].
- Resultado 2: [mismo análisis]
- Conclusión: ¿Algún resultado pasa todos los criterios? [Sí/No]. Si sí, ¿cuál?
</evaluacion>

4. **Si ningún resultado pasa los criterios** (para búsqueda web/Semantic Scholar), usa tu mejor conocimiento para responder, pero incluye solo información que puedas verificar. Es preferible una definición precisa sin fuente explícita que una definición con fuentes inventadas. Para placeholders estilísticos o creativos (los que la nota indique que no requieren búsqueda), usa directamente tu conocimiento.

5. **Redacta la definición**: consulta las Notas del placeholder para la extensión esperada. Si las notas especifican un número de párrafos u oraciones, adhiérete a esa indicación. Si no hay guidance de extensión, evalúa el propósito: placeholders narrativos (fábulas, historias, anécdotas, casos de estudio) requieren desarrollo completo con inicio, desarrollo y cierre; placeholders factuales (estudios, papers, referencias) requieren descripción con metodología, resultados y fuente; placeholders estilísticos (tono, enfoque) pueden resolverse en 1-2 oraciones. La definición debe poder insertarse tal cual en el flujo del texto sin edición adicional (no escribas una meta-descripción tipo "este placeholder contiene...").

**🚫 La definición NUNCA debe contener el nombre del placeholder como texto.** Por ejemplo, para {exito_notable}, no escribas "un éxito notable: ..." — eso es name bleeding. La definición debe ser el contenido en sí, no una frase que repita el nombre.

**🚫 No inventes anécdotas, casos de estudio ni estadísticas.** Si los resultados de búsqueda no contienen un caso real y documentado, no fabriques uno. Es preferible una definición conceptual concisa (2-3 oraciones) que una historia falsa presentada como real. Las anécdotas de "un grupo de hombres que se reunían cada martes..." o "un profesional que tras años de evitar..." sin fuente son FABRICACIONES. Si necesitas ilustrar un concepto, usa una descripción abstracta del patrón, no una narrativa con detalles concretos falsos.

**Extensión máxima por tipo:**
- Placeholders factuales (definiciones, conceptos, descripciones): **máximo 250 palabras** (~4-5 oraciones). Sé denso, no expansivo.
- Placeholders narrativos (historias, anécdotas, casos): **máximo 400 palabras** (~8-10 oraciones). Solo si hay fuente real que lo respalde.
- Placeholders estilísticos (tono, perfil): **máximo 100 palabras** (~2-3 oraciones).
- Si las Notas del placeholder especifican una extensión diferente, obedécelas.

6. **Entrega el resultado**: responde ÚNICAMENTE con JSON válido en este formato: {"definition": "tu definición"}

## Ejemplos

Ejemplo 1 — Placeholder con material RAG (documentos subidos):

Placeholder: {CASO_O_HISTORIA_NUEVA}
Función: "Una narrativa concreta que ejemplifique la aplicación exitosa del principio; debe ser genérica y transferible a cualquier dominio."
Notas: "Breve descripción de un escenario prototípico. Ejemplo: 'un profesional que duplicó su productividad...'"
Research: RAG · documentos subidos. El material contiene field reports de alguien que practicó cold approach en bares y cafeterías.

<evaluacion>
- Patrón identificado: Persona enfrenta ansiedad social → se expone repetidamente a situaciones incómodas → gana confianza progresivamente
- Elementos a preservar: La estructura de exposición gradual, el arco de superación personal, la lección de que la práctica vence al miedo
- Elementos a descartar: Nombres (Ashley, Sofia), lugares (Budapest, coffee shop específico), fechas, detalles de venues concretos
- Adaptación: Un profesional que tras una ruptura amorosa se da cuenta de que su ansiedad social le impide conocer gente nueva; se impone el reto de entablar una conversación breve con un desconocido cada día durante un mes, sin otro objetivo que practicar; al cabo de ese mes no solo perdió el miedo al rechazo sino que construyó una red social más amplia y auténtica.
</evaluacion>

{"definition": "Un profesional que, tras años de evitar interacciones sociales por miedo al rechazo, se impuso el reto de iniciar una conversación breve con un desconocido cada día durante un mes; al principio cada intento era torpe e incómodo, pero al cabo de cuatro semanas no solo había perdido el miedo, sino que descubrió que la mayoría de las personas responden con amabilidad cuando das el primer paso."}

Ejemplo 2 — Placeholder con búsqueda web:

Placeholder: {CASO_ESTUDIO}
Función: "Proveer un caso de estudio real y documentado que ilustre el principio de prueba social en campañas de salud"
Notas: "Debe incluir nombre de la campaña, período, resultados cuantitativos y fuente académica. Extensión: 2-3 oraciones."
Research: Web search

<evaluacion>
- Resultado 1 (Estudio CDC sobre campaña Truth): ¿Trata directamente el tema? Sí. ¿Específico? Sí — incluye fechas, porcentajes. ¿Fuente confiable? Sí — CDC + journal académico.
- Resultado 2 (Meta-análisis genérico de prueba social): ¿Trata directamente el tema? Parcialmente. ¿Específico? No — sin datos de campaña concreta. ¿Fuente confiable? Sí, pero demasiado genérico.
- Conclusión: Resultado 1 pasa todos los criterios.
</evaluacion>

{"definition": "La campaña 'Truth' antitabaco en Estados Unidos (2000-2014), que aplicó el principio de prueba social al mostrar adolescentes rechazando la manipulación de las tabacaleras, redujo el tabaquismo juvenil del 23% al 7% según un estudio del CDC publicado en 2015 en American Journal of Public Health"}

Ejemplo 3 — Placeholder estilístico sin búsqueda externa:

Placeholder: {LECTOR_OBJETIVO}
Función: "Definir el perfil del lector ideal para calibrar el tono y profundidad del capítulo"
Notas: "Especificar rol profesional, contexto organizacional y nivel de conocimiento previo. Enfócate en rol, contexto y necesidad práctica; omite datos demográficos genéricos (edad, país). Este placeholder es estilístico. No requiere búsqueda externa."

<evaluacion>
- Placeholder estilístico. No aplica búsqueda. Uso conocimiento directo.
</evaluacion>

{"definition": "Profesionales de comunicación en salud pública y funcionarios de ministerios de salud que diseñan campañas de prevención dirigidas a poblaciones diversas, con experiencia limitada en psicología del comportamiento"}`;

// ── Post-generation validation ──

interface ValidationResult {
  ok: boolean;
  reason?: string;
}

const MIN_DEFINITION_LENGTH = 30;   // catch "arrancar un roble" cases
const MAX_WORDS_FACTUAL = 250;
const MAX_WORDS_NARRATIVE = 400;
export function isNarrativePlaceholder(ph: PlaceholderDef): boolean {
  // Match whole-word/phrase patterns to avoid false positives.
  // "caso" alone is excluded — too broad (appears in "en caso de", "hacer caso", etc.).
  // Use specific phrases: "caso de estudio", "caso real", "caso concreto", etc.
  const narrativePatterns = [
    /\bhistoria\b/,
    /\ban[ée]cdota\b/,
    /\bf[áa]bula\b/,
    /\bnarrativa\b/,
    /\brelato\b/,
    /\bescena\b/,
    /caso\s+(de\s+estudio|real|concreto|documentado|espec[ií]fico|ilustrativo)/,
    /ejemplo\s+concreto/,
    /ilustraci[óo]n/,
  ];
  const text = `${ph.function ?? ""} ${ph.notes ?? ""}`.toLowerCase();
  return narrativePatterns.some((pattern) => pattern.test(text));
}

export function validateDefinition(
  definition: string,
  placeholderName: string,
  ph: PlaceholderDef,
): ValidationResult {
  // 0. Blocklist — fastest check, strongest signal. Must pass before structural checks.
  const blocklistHits = checkBlocklist(definition);
  if (blocklistHits.length > 0) {
    return {
      ok: false,
      reason: `Contenido protegido detectado: ${blocklistHits.slice(0, 3).join(", ")}`,
    };
  }

  // 1. Minimum length — catch truncated extractions
  if (definition.length < MIN_DEFINITION_LENGTH) {
    return { ok: false, reason: `Definition too short (${definition.length} chars, min ${MIN_DEFINITION_LENGTH})` };
  }

  // 2. Name bleeding — definition should not contain the placeholder name verbatim.
  //    Uses Unicode-aware word boundaries (u flag) to handle accented characters.
  const escaped = placeholderName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const namePattern = new RegExp(
    `\\b${escaped.replace(/_/g, String.raw`[_\s]+`)}\\b`,
    "iu",
  );
  if (namePattern.test(definition)) {
    return { ok: false, reason: `Definition contains placeholder name "${placeholderName}" — name bleeding detected` };
  }

  // 3. Maximum length — prevent bloated definitions
  const wordCount = definition.split(/\s+/).length;
  if (isNarrativePlaceholder(ph)) {
    if (wordCount > MAX_WORDS_NARRATIVE) {
      return { ok: false, reason: `Definition too long (${wordCount} words, max ${MAX_WORDS_NARRATIVE} for narrative)` };
    }
  } else {
    if (wordCount > MAX_WORDS_FACTUAL) {
      return { ok: false, reason: `Definition too long (${wordCount} words, max ${MAX_WORDS_FACTUAL} for factual/stylistic)` };
    }
  }

  return { ok: true };
}

/**
 * Thrown when a required evidence need has no matching chunks in approved sources.
 * This prevents the LLM from fabricating data for evidence-critical placeholders.
 */
export class RequiredEvidenceMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequiredEvidenceMissingError";
  }
}

async function generateAndValidate(
  model: string,
  userPrompt: string,
  ph: PlaceholderDef,
  effort?: ReasoningEffort,
  temperature?: number,
  signal?: AbortSignal,
): Promise<string> {
  // First attempt
  const result = await generateCompletion({
    model,
    systemPrompt: INDIVIDUAL_FILL_SYSTEM_PROMPT,
    userPrompt,
    ...(effort !== undefined ? { effort } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(signal ? { signal } : {}),
  });

  const parsed = extractJson(result.data as string) as Record<string, unknown>;
  const definition = String(parsed.definition ?? "");

  if (!definition) {
    throw new Error(`No definition generated for {${ph.name}}`);
  }

  // Single validation path: structure + blocklist (unified in validateDefinition)
  const validation = validateDefinition(definition, ph.name, ph);
  if (validation.ok) {
    try {
      assertOriginalEnough(definition, { stage: "placeholder-def", throwOnFail: true });
      return definition;
    } catch (err) {
      if (err instanceof OriginalityError) {
        console.warn(
          `[placeholder-fill] Corpus check failed for {${ph.name}}: ${err.message}. Retrying.`,
        );
        // Fall through to retry with contamination hint
      } else {
        throw err;
      }
    }
  }

  // Retry once with message adapted to failure type.
  // When validation.ok is true but we're here → corpus check failed → contamination.
  const reason = validation.ok
    ? "Contenido protegido detectado en verificación de corpus"
    : (validation.reason ?? "validación");
  const isContamination = validation.ok || reason.includes("Contenido protegido");
  console.warn(
    `[placeholder-fill] Validation failed for {${ph.name}}: ${reason}. Retrying.`,
  );

  const retryHint = isContamination
    ? `Debes crear una definición completamente original. NO uses conceptos, metáforas ni ejemplos de obras protegidas. Usa ejemplos y analogías propias.`
    : `Corrige el problema y responde de nuevo.`;

  const retryUserPrompt = userPrompt +
    `\n\n⚠️ TU RESPUESTA ANTERIOR FUE RECHAZADA. Razón: ${reason}. ${retryHint} Responde ÚNICAMENTE con JSON: {"definition": "..."}`;

  const retryResult = await generateCompletion({
    model,
    systemPrompt: INDIVIDUAL_FILL_SYSTEM_PROMPT,
    userPrompt: retryUserPrompt,
    ...(effort !== undefined ? { effort } : {}),
    ...(signal ? { signal } : {}),
    temperature: 0.2,
  });

  const retryParsed = extractJson(retryResult.data as string) as Record<string, unknown>;
  const retryDefinition = String(retryParsed.definition ?? "");

  if (!retryDefinition) {
    console.warn(`[placeholder-fill] No definition on retry for {${ph.name}}. Blocking.`);
    return "";
  }

  const retryValidation = validateDefinition(retryDefinition, ph.name, ph);
  if (!retryValidation.ok) {
    console.warn(
      `[placeholder-fill] ⛔ Retry also failed for {${ph.name}}: ${retryValidation.reason}. Blocking definition.`,
    );
    return "";
  }

  try {
    assertOriginalEnough(retryDefinition, { stage: "placeholder-def", throwOnFail: true });
  } catch (err) {
    if (err instanceof OriginalityError) {
      console.warn(
        `[placeholder-fill] ⛔ Retry corpus check also failed for {${ph.name}}: ${err.message}. Blocking definition.`,
      );
      return "";
    }
    throw err;
  }

  return retryDefinition;
}

export interface PlaceholderDef {
  name: string;
  function?: string | null;
  notes?: string | null;
}

export interface FillOneResult {
  name: string;
  definition: string;
  sources: SearchResult[];
  ragChunks?: number;
  provider: string;
  /** Evidence query from the editorial brief contract, if applicable */
  evidenceQuery?: string;
  /** Source IDs searched for evidence (from approved brief) */
  evidenceSourceIds?: string[];
}

export interface FillOnePlaceholderParams {
  /** Placeholder definition with name, function, and notes */
  placeholder: PlaceholderDef;
  /** Project topic (used for query construction and direct resolution) */
  projectTopic: string | null;
  /** Project ID for DB-scoped operations */
  projectId: string;
  /** Current chapter ID (for cross-chapter reuse and editorial contract matching) */
  chapterId?: string;
  /** Prompt contents for context */
  promptContents: string[];
  /** Source contexts for each prompt (same index as promptContents). Null entries allowed. */
  sourceContexts?: Array<string | null>;
  /** Existing definitions for other placeholders (for context and reuse) */
  existingDefinitions: Record<string, string>;
  /** Optional editorial bundle for evidence-driven RAG overrides */
  editorialBundle?: EditorialBundle | null;
  /** Model override */
  model?: string;
  /** Reasoning effort */
  effort?: ReasoningEffort;
  /** Temperature for LLM generation */
  temperature?: number;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

/**
 * Fill a single placeholder with the full research pipeline:
 * direct resolution → cross-chapter reuse (if eligible) → provider classification →
 * research (RAG/Semantic Scholar/web) → prompt construction → LLM generation.
 *
 * Used by both the sequential batch fill and the single-placeholder API endpoint.
 */
export async function fillOnePlaceholder(
  params: FillOnePlaceholderParams,
): Promise<FillOneResult> {
  const {
    placeholder: ph,
    projectTopic,
    projectId,
    promptContents,
    existingDefinitions: existingDefs,
    model = DEFAULT_MODEL,
    effort,
    temperature,
    chapterId: currentChapterId,
    sourceContexts,
    signal,
    editorialBundle,
  } = params;
  // Phase 0: Direct resolution
  const direct = resolveDirectly(ph.name, projectTopic);
  if (direct) {
    return { name: ph.name, definition: direct, sources: [], provider: "direct" };
  }

  // Classify once for Phase 0.5 + Phase 1.
  // May be overridden by editorial brief evidence contracts below.
  let provider = inferPlaceholderProvider(ph.name, ph.function);

  // Phase 0.5: Cross-chapter reuse
  // Only for non-RAG, non-direct placeholders — examples/anecdotes are chapter-specific
  if (currentChapterId) {
    if (provider !== "rag" && provider !== "direct") {
      const otherDefs = await db
        .select({ definition: chapterPlaceholders.definition })
        .from(chapterPlaceholders)
        .innerJoin(chapters, eq(chapters.id, chapterPlaceholders.chapterId))
        .where(
          and(
            eq(chapters.projectId, projectId),
            eq(chapterPlaceholders.name, ph.name),
            isNotNull(chapterPlaceholders.definition),
            not(eq(chapterPlaceholders.chapterId, currentChapterId)),
          ),
        )
        .limit(1);

      if (otherDefs.length > 0 && otherDefs[0].definition) {
        return {
          name: ph.name,
          definition: otherDefs[0].definition,
          sources: [],
          provider: "reused",
        };
      }
    }
  }

  // Evidence-driven override from editorial brief contract.
  // When an editorial brief exists and the current chapter has an evidence need
  // for this placeholder, the contract overrides both provider and query.
  let evidenceQuery: string | undefined;
  let isRequiredEvidence = false;
  let evidenceSourceIds: string[] | undefined;

  if (editorialBundle && currentChapterId) {
    const contract = editorialBundle.contracts.find(
      (c) => c.chapterId === currentChapterId,
    );
    if (contract) {
      const evidenceNeed = contract.evidenceNeeds.find(
        (en) => en.placeholderName === ph.name,
      );
      if (evidenceNeed) {
        evidenceQuery = evidenceNeed.query;
        isRequiredEvidence = evidenceNeed.required;
        evidenceSourceIds = editorialBundle.evidenceSourceIds;

        if (evidenceNeed.required) {
          // Required evidence: force RAG and use the contract query
          provider = "rag";
        }
        // For both required and optional evidence with RAG, use the contract query
        // (the query from the evidence need is more targeted than auto-generated)
      }
    }
  }

  const promptContext = promptContents
    .map((c, i) => `Prompt ${i + 1}: ${c.slice(0, 10000)}${c.length > 10000 ? "..." : ""}`)
    .join("\n\n");

  // Build source context section from the original material that inspired each prompt.
  // Only included for RAG and Semantic Scholar providers (where external research context
  // benefits from domain orientation). Omitted for "llm" provider — showing the LLM what
  // NOT to copy forces it to process the copyrighted text, contaminating its output.
  let sourceContextSection = "";
  const includeSourceContext = provider === "rag" || provider === "semantic-scholar";
  const hasSourceContext = includeSourceContext && sourceContexts && sourceContexts.some((s) => s?.trim());
  if (hasSourceContext) {
    const entries = sourceContexts!
      .map((s, i) => {
        if (!s?.trim()) return null;
        return `Fuente original del Prompt ${i + 1}:\n${s.slice(0, 300)}${s.length > 300 ? "..." : ""}`;
      })
      .filter(Boolean);
    if (entries.length > 0) {
      sourceContextSection = `\n## 📄 Contexto de dominio (no copies — solo para entender el tema)\n\n${entries.join("\n\n---\n\n")}`;
    }
  }

  // Phase 1: Research — only for RAG and Semantic Scholar providers.
  // Web search removed: LLM-only fills produce higher quality definitions than
  // scraping generic SEO articles that dominate web results for these queries.
  let sources: SearchResult[] = [];
  let ragContext = "";
  let ragChunks = 0;
  let optionalEvidenceEmpty = false;

  const skipResearch = provider === "llm" || provider === "direct";

  if (!skipResearch) {
    const query = evidenceQuery ?? buildSearchQuery(ph, projectTopic);
    if (process.env.NODE_ENV !== "production") {
      console.log(`[placeholder-fill] {${ph.name}} provider=${provider} query="${query}"${evidenceQuery ? " (evidence override)" : ""}`);
    }

    if (provider === "rag") {
      const ragOptions: { topK: number; tokenBudget: number; sourceIds?: string[] } = {
        topK: 5,
        tokenBudget: 15000,
      };
      // When evidence source IDs are available, restrict RAG to approved sources only
      if (evidenceSourceIds) {
        ragOptions.sourceIds = evidenceSourceIds;
      }
      const result = await retrieveContext(query, projectId, ragOptions);
      if (result.contextText) {
        ragContext = result.contextText;
        ragChunks = result.chunks.length;
      } else {
        console.warn(`[placeholder-fill] {${ph.name}} RAG empty for query "${query}"`);
      }
      // Check required evidence: throw if no chunks found in approved sources
      if (isRequiredEvidence && ragChunks === 0) {
        throw new RequiredEvidenceMissingError(
          `Required evidence "${ph.name}" has no matching chunks in approved sources`,
        );
      }
      // Track optional evidence with empty results for prompt-level warning
      if (ragChunks === 0 && evidenceQuery && !isRequiredEvidence) {
        optionalEvidenceEmpty = true;
      }
      // Fall through — empty RAG uses LLM fallback below
    } else if (provider === "semantic-scholar") {
      sources = await searchSemanticScholar(query);
      if (sources.length === 0) {
        console.warn(`[placeholder-fill] {${ph.name}} Semantic Scholar empty for query "${query}"`);
      }
      // Fall through — empty results use LLM fallback below
    }
  }

  // Phase 2: Build research context for the prompt
  let researchSection = "";
  if (ragContext) {
    const strippedRag = ragContext.replace(/^## (?:Source Material|Documentos subidos)\n?\n?/, "");
    researchSection = `\n## Research Results (RAG · documentos subidos)\n\n<research_results source="rag">\n<result id="1">\n<content>${escapeXmlText(strippedRag)}</content>\n</result>\n</research_results>\n\n⚠️ **Instrucción para este material**: ADAPTA el contenido de tus documentos subidos. Extrae el patrón o principio subyacente y transfórmalo en un ejemplo genérico y transferible a cualquier dominio. No copies nombres reales, empresas, fechas concretas ni detalles identificables.`;
  } else if (sources.length > 0) {
    researchSection = `\n## Research Results (Semantic Scholar · papers académicos)\n\n<research_results source="${provider}">`;
    for (let idx = 0; idx < sources.length; idx++) {
      const s = sources[idx];
      researchSection += `\n<result id="${idx + 1}">\n<content>${escapeXmlText(s.title)}\n${escapeXmlText(s.snippet)}</content>`;
      if (s.url) {
        researchSection += `\n<url>${escapeXmlText(s.url)}</url>`;
      }
      researchSection += "\n</result>";
    }
    researchSection += "\n</research_results>";
  } else if (skipResearch) {
    researchSection = "\n## Nota\n\nEste placeholder no requiere búsqueda externa. Usa tu conocimiento para dar una definición pertinente, específica y alineada con el tema del proyecto.";
  } else if (optionalEvidenceEmpty) {
    const providerLabel = provider === "rag" ? "RAG" : provider === "semantic-scholar" ? "Semantic Scholar" : provider;
    researchSection = `\n## Nota\n\nLa búsqueda en ${providerLabel || "fuentes externas"} no arrojó resultados para el contenido esperado. No inventes estadísticas, citas ni casos de estudio. Si no hay material de investigación disponible, elabora una definición conceptual concisa basada en principios generales.`;
  } else {
    const providerLabel = provider === "rag" ? "RAG" : provider === "semantic-scholar" ? "Semantic Scholar" : provider;
    researchSection = `\n## Nota\n\nLa búsqueda en ${providerLabel || "fuentes externas"} no arrojó resultados. Usa tu mejor conocimiento para elaborar una definición pertinente y alineada con el tema del proyecto.`;
  }

  // Phase 3: Build individual prompt
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
(tono, alcance y orientación — NO copies este texto directamente)

${promptContext}
${sourceContextSection}
${existingDefsSection}
${researchSection}

Responde ÚNICAMENTE con JSON: {"definition": "tu definición (extensión según las notas del placeholder)"}`;

  // Phase 4: Generate (with single retry on validation failure)
  const definition = await generateAndValidate(
    model,
    userPrompt,
    ph,
    effort,
    temperature,
    signal,
  );

  return {
    name: ph.name,
    definition,
    sources,
    ragChunks: ragChunks || undefined,
    provider,
    ...(evidenceQuery ? { evidenceQuery } : {}),
    ...(evidenceSourceIds ? { evidenceSourceIds } : {}),
  };
}
export async function* fillPlaceholdersSequential(
  placeholders: PlaceholderDef[],
  promptContents: string[],
  projectTopic: string | null,
  projectId: string,
  model: string = DEFAULT_MODEL,
  effort?: ReasoningEffort,
  temperature?: number,
  currentChapterId?: string,
  sourceContexts?: (string | null)[],
  signal?: AbortSignal,
  editorialBundle?: EditorialBundle | null,
): AsyncGenerator<PlaceholderFillEvent> {
  const total = placeholders.length;
  const existingDefs: Record<string, string> = {};

  for (let i = 0; i < placeholders.length; i++) {
    if (signal?.aborted) {
      yield { type: "cancelled" as const, current: i, total };
      return;
    }

    const ph = placeholders[i];

    try {
      const result = await fillOnePlaceholder({
        placeholder: ph,
        projectTopic,
        projectId,
        promptContents,
        existingDefinitions: existingDefs,
        model,
        effort,
        temperature,
        chapterId: currentChapterId,
        sourceContexts,
        signal,
        editorialBundle,
      });

      if (result.definition) {
        existingDefs[ph.name] = result.definition;
        yield {
          type: "placeholder",
          name: result.name,
          definition: result.definition,
          sources: result.sources,
          ragChunks: result.ragChunks,
          provider: result.provider,
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
