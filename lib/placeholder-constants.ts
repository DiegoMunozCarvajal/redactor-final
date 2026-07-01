// Shared keyword constants for placeholder provider classification.
// Used by both inferPlaceholderProvider and the fill system prompt.

export const RAG_KEYWORDS = [
  "ejemplo", "historia", "histórico", "historico", "anécdota",
  "anecdota", "caso", "narrativa", "experiencia", "ilustración",
  "ilustracion", "relato", "testimonio", "vivencia",
] as const;

export const SEMANTIC_SCHOLAR_KEYWORDS = [
  "bibliografía", "bibliografia", "paper", "estudio", "investigación",
  "investigacion", "académico", "academico", "artículo", "articulo",
  "publicación", "publicacion", "autor", "evidence", "evidencia",
  "fuente", "referencia", "cita", "científico",
  "cientifico", "journal", "revista", "metaanálisis",
  "metanalisis", "revisión", "revision",
  "ensayo", "doi",
] as const;

export const STYLISTIC_PATTERNS = [
  "lector", "audiencia", "audience", "tono", "tone", "estilo", "style",
  "enfoque", "approach", "perspectiva", "angulo", "ángulo", "nivel",
  "formato", "extensión", "extension",
  "concepto", "creencia", "principio", "resultado", "pregunta",
  "objecion", "objeción", "cierre", "idea", "sintesis", "síntesis",
  // Definitional — the LLM defines these directly, no external research
  "sujeto", "objeto", "campo", "area", "ámbito", "ambito",
  "alcance", "definición", "definicion", "propósito", "proposito",
  "dominio", "disciplina", "marco", "contexto",
] as const;
