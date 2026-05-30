export type PlaceholderProvider = "rag" | "semantic-scholar" | "web" | "none" | "direct";

const RAG_KEYWORDS = [
  "ejemplo", "historia", "histórico", "historico", "anécdota",
  "anecdota", "caso", "narrativa", "experiencia", "ilustración",
  "ilustracion", "relato", "testimonio", "vivencia",
];

const SEMANTIC_SCHOLAR_KEYWORDS = [
  "bibliografía", "bibliografia", "paper", "estudio", "investigación",
  "investigacion", "académico", "academico", "artículo", "articulo",
  "publicación", "publicacion", "autor", "evidence", "evidencia",
  "fuente", "fuente principal", "referencia", "cita", "científico",
  "cientifico", "journal", "revista", "paper", "metaanálisis",
  "metanalisis", "revisión sistemática", "revision sistematica",
  "ensayo clínico", "ensayo clinico", "doi",
];

const STYLISTIC_PATTERNS = [
  "lector", "audiencia", "audience", "tono", "tone", "estilo", "style",
  "enfoque", "approach", "perspectiva", "angulo", "ángulo", "nivel",
  "formato", "extensión", "extension",
];

function placeholderText(
  name: string,
  functionStr?: string | null,
  notes?: string | null,
): string {
  return `${name} ${functionStr ?? ""} ${notes ?? ""}`.toLowerCase();
}

export function inferPlaceholderProvider(
  name: string,
  functionStr?: string | null,
  notes?: string | null,
): PlaceholderProvider {
  const lower = name.toLowerCase();
  const segments = lower.split("_");

  if (segments.includes("tema") || segments.includes("topic")) {
    return "direct";
  }

  const text = placeholderText(name, functionStr, notes);
  const needsResearch =
    functionStr?.toLowerCase().includes("investigación") ||
    functionStr?.toLowerCase().includes("búsqueda");

  if (!needsResearch && STYLISTIC_PATTERNS.some((pattern) => lower.includes(pattern))) {
    return "none";
  }

  if (RAG_KEYWORDS.some((keyword) => text.includes(keyword))) {
    return "rag";
  }

  if (SEMANTIC_SCHOLAR_KEYWORDS.some((keyword) => text.includes(keyword))) {
    return "semantic-scholar";
  }

  return "web";
}
