"""Meta-prompt optimization: the prompt that generates prompts.

Pipeline:
  source_chapter → [meta-prompt] → prompt_templates → [each template] → fragments → [judge] → score

The meta-prompt is the highest-leverage point: optimize it once, all downstream prompts improve.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

# The user's current meta-prompt (unchanged)
META_PROMPT = """Actúa como un arquitecto narrativo y prompt engineer. Tu tarea es extraer la arquitectura funcional de un capítulo fuente y convertirla en una biblioteca de prompts modulares y reutilizables.

No copies ni imites literalmente la redacción original. Extrae la estructura, el ritmo, la lógica argumental y el tipo de desarrollo. El resultado debe permitir que otra persona, usando los prompts en orden con un tema diferente, genere un capítulo nuevo equivalente en arquitectura, profundidad y progresión.

## Paso 1 — Diagnóstico breve (3-4 líneas)

Identifica:
- Tipo de capítulo y tesis central
- Secuencia argumental (3-5 etapas)
- Recursos de estilo dominantes y patrón de ejemplos

## Paso 2 — Biblioteca de prompts (JSON)

Entrega exactamente entre 6 y 10 bloques. Cada bloque es un prompt independiente que genera una sección del capítulo. Usa el siguiente formato JSON SIN excepción:

```json
{
  "diagnosis": "breve resumen del diagnóstico en 2-3 frases",
  "templates": [
    {
      "name": "Nombre descriptivo del bloque",
      "function": "Qué produce este bloque y por qué es necesario en la secuencia",
      "content": "Prompt completo listo para usar. Incluye instrucciones de tono, extensión (máx 4 párrafos), transición desde el bloque anterior y preparación del siguiente. Usa {PLACEHOLDERS} para las variables.",
      "placeholders": ["PLACEHOLDER_1", "PLACEHOLDER_2"],
      "notes": "Cómo adaptar este bloque a otros temas o contextos (1-2 frases)"
    }
  ]
}
```

## Reglas

### Regla 1 — Transferibilidad obligatoria
Cada prompt debe funcionar para CUALQUIER tema, no solo para el tema fuente. Si un prompt requiere conocimiento específico del capítulo fuente (un concepto, una anécdota, una herramienta concreta), no es válido. Abstrae al nivel de PATRÓN, no de contenido:

- ✅ "Ilustra un principio de acumulación gradual con ejemplos concretos del {TEMA_DEL_LIBRO}"
- ❌ "Explica el efecto compuesto con ejemplos financieros"
- ✅ "Presenta una herramienta mental que el lector pueda aplicar inmediatamente a {TEMA_DEL_LIBRO}"
- ❌ "Explica los 4 pasos del método Brailsford aplicado a los frenos del ciclismo"

### Regla 2 — Prohibido: plantillas, ejercicios y herramientas ultra-específicas
No generes prompts tipo "planilla", "ejercicio paso a paso", "regla operativa mínima" o "instrucción directa" que dependan de una estructura rígida del capítulo fuente. Estos fallan al transferirse a otros temas porque asumen una analogía exacta que no existe.

En su lugar, convierte esas secciones en prompts más flexibles:
- ❌ "Plantilla de aplicación inmediata con los 3 pasos del método"
- ✅ "Sintetiza el principio en una guía práctica que el {LECTOR_OBJETIVO} pueda aplicar a {TEMA_DEL_LIBRO}"

### Regla 3 — Autoverificación de transferibilidad
Antes de incluir cada bloque, verifica mentalmente: ¿este prompt funcionaría igual de bien para "liderazgo de equipos remotos", "introducción al estoicismo", "finanzas personales" y "nutrición deportiva"? Si la respuesta es no, reformúlalo hasta que funcione para cualquiera de esos temas.

Placeholders globales (prioriza estos):
{TEMA_DEL_LIBRO}, {CONCEPTO_CENTRAL_DEL_LIBRO}, {LECTOR_OBJETIVO}, {RESULTADO_DESEADO}, {TONO_DEL_LIBRO}, {PRINCIPIO_CENTRAL_DEL_CAPITULO}

Placeholders locales (solo si son necesarios):
{CASO_O_HISTORIA}, {EJEMPLO_CONCRETO}, {FUENTE_O_PAPER_BASE}, {OBJECION_DEL_LECTOR}, {IDEA_PUENTE}

Usa placeholders para todo concepto que dependa del tema o del capítulo fuente. Si tu prompt menciona un número específico ("dos minutos", "1%"), una regla concreta ("la regla de X"), una metáfora ("el hielo que se derrite"), o un concepto que solo existe en el capítulo fuente ("efecto compuesto", "meseta del potencial latente"), ese concepto DEBE ser un placeholder o ser reformulado de forma abstracta y transferible. Prefiere un placeholder extra a un concepto hardcodeado.

Cada bloque debe ser una unidad narrativa o explicativa completa. Los bloques en secuencia deben reconstruir el capítulo completo.

Responde ÚNICAMENTE con el JSON. Sin introducciones, sin notas al editor, sin texto fuera del JSON."""


@dataclass
class PromptTemplate:
    """A single prompt template extracted from the meta-prompt output."""

    name: str
    function: str
    content: str  # The actual prompt text with placeholders
    placeholders: list[str] = field(default_factory=list)
    notes: str = ""


@dataclass
class MetaPromptOutput:
    """Structured output from the meta-prompt."""

    raw: str
    templates: list[PromptTemplate] = field(default_factory=list)
    diagnosis: str = ""
    audit: str = ""


def parse_meta_prompt_output(raw: str) -> MetaPromptOutput:
    """Parse the JSON meta-prompt output into structured templates.

    The meta-prompt now outputs a JSON object with 'templates' array.
    """
    result = MetaPromptOutput(raw=raw)

    # Try to extract JSON from the response
    try:
        data = _extract_json(raw)
    except (json.JSONDecodeError, ValueError) as e:
        print(f"  [WARN] JSON parse failed: {e}")
        return result

    if not isinstance(data, dict):
        return result

    result.diagnosis = data.get("diagnosis", "")

    for t_data in data.get("templates", []):
        if not isinstance(t_data, dict):
            continue
        template = PromptTemplate(
            name=t_data.get("name", "Sin nombre"),
            function=t_data.get("function", ""),
            content=t_data.get("content", ""),
            placeholders=t_data.get("placeholders", []),
            notes=t_data.get("notes", ""),
        )
        if template.content.strip():
            result.templates.append(template)

    return result


def _extract_json(raw: str) -> dict:
    """Extract JSON object from raw text, handling markdown code blocks."""
    # Try direct parse first
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    # Try extracting from ```json ... ``` code block
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, re.DOTALL)
    if m:
        return json.loads(m.group(1))

    # Try finding first { to last }
    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        return json.loads(raw[start : end + 1])

    raise ValueError("No JSON object found in output")


def build_meta_prompt_user(source_chapter: str) -> str:
    """Build the full user message for the meta-prompt call."""
    return f"Texto fuente:\n\n{source_chapter}"


# Test topics for fragment generation from extracted templates
TEST_TOPICS = [
    {
        "tema": "Liderazgo de equipos remotos",
        "TEMA_DEL_LIBRO": "Liderazgo de equipos remotos",
        "CONCEPTO_CENTRAL_DEL_LIBRO": "liderazgo efectivo en entornos distribuidos",
        "LECTOR_OBJETIVO": "gerentes y líderes de equipo que gestionan personas en distintas zonas horarias",
        "RESULTADO_DESEADO": "un equipo remoto que opera con autonomía, alineación y bienestar",
        "TONO_DEL_LIBRO": "práctico y directo, basado en experiencia real de gestión",
        "PRINCIPIO_CENTRAL_DEL_CAPITULO": "la confianza se construye mediante sistemas y rituales, no mediante presencia física",
    },
    {
        "tema": "Introducción al estoicismo práctico",
        "TEMA_DEL_LIBRO": "Introducción al estoicismo práctico",
        "CONCEPTO_CENTRAL_DEL_LIBRO": "estoicismo aplicado a los desafíos cotidianos",
        "LECTOR_OBJETIVO": "personas que buscan herramientas filosóficas aplicables a la vida diaria",
        "RESULTADO_DESEADO": "una mente más serena frente a lo incontrolable y más enfocada en lo que sí depende de uno",
        "TONO_DEL_LIBRO": "claro y cercano, sin academicismo pero con rigor conceptual",
        "PRINCIPIO_CENTRAL_DEL_CAPITULO": "la dicotomía del control — distinguir lo que depende de nosotros de lo que no — es la base de la tranquilidad mental",
    },
]

# System prompt for fragment generation (same as the pipeline)
FRAGMENT_SYSTEM_PROMPT = """Eres un escritor senior de no-ficción en español. Redactas la sección de un capítulo siguiendo las instrucciones que recibirás abajo.

Cómo escribes:
- Español claro y preciso. Oraciones cortas (15-25 palabras) con ritmo variado.
- Un párrafo = una idea. Máximo 5 oraciones por párrafo.
- Voz activa. Usas pasiva solo cuando el sujeto no importa.
- Cada afirmación no obvia la respaldas con un ejemplo, dato o fuente concreta en la oración siguiente.
- Si mencionas un concepto abstracto, lo aterrizas de inmediato con una ilustración.
- Las citas a estudios, papers o fuentes incluyen autor o institución.
- Las transiciones entre párrafos son explícitas.
- Calificas con atributos verificables.

Qué evitas:
- Adjetivos que no informan: "integral", "profundo", "innovador", "revolucionario", "fascinante".
- Relleno: "realmente", "verdaderamente", "básicamente", "simplemente".
- Aperturas que anuncian en vez de enganchar: "En este capítulo...", "A continuación...".

Responde ÚNICAMENTE con el contenido de la sección. Sin títulos, sin etiquetas, sin introducciones meta."""


def resolve_placeholders(content: str, topic_overrides: dict[str, str]) -> str:
    """Replace {NAME} placeholders with topic-specific values."""

    def _replacer(match):
        name = match.group(1)
        # Case-insensitive lookup
        for key, value in topic_overrides.items():
            if key.upper() == name.upper():
                return value
        return f"[{name.replace('_', ' ').title()}]"

    return re.sub(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}", _replacer, content)


def load_chapters(data_dir: str | None = None) -> dict[str, str]:
    """Load extracted chapters from the data directory."""
    if data_dir is None:
        data_dir = str(Path(__file__).resolve().parents[2] / "data")
    chapters = {}
    for path in sorted(Path(data_dir).glob("chapter_*.md")):
        key = path.stem  # e.g., "chapter_01"
        chapters[key] = path.read_text()
    return chapters
