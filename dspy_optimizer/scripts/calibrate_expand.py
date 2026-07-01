"""Generate 8 more calibration fragments with new topics.

Appends results to calibration_data.json for a total of 16 data points.
"""

from __future__ import annotations

import asyncio
import json
import re
from pathlib import Path
from uuid import UUID

import anthropic

from dotenv import load_dotenv

from dspy_optimizer.judge import evaluate_fragment
from dspy_optimizer.db import close_pool, fetch_prompt

load_dotenv(Path(__file__).resolve().parents[3] / ".env")

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
ANTHROPIC_BASE_URL = "https://api.anthropic.com"

SYSTEM_PROMPT = """Eres un escritor senior de no-ficción en español. Redactas la sección de un capítulo siguiendo las instrucciones que recibirás abajo.

Cómo escribes:
- Español claro y preciso. Oraciones cortas (15-25 palabras) con ritmo variado.
- Un párrafo = una idea. Máximo 5 oraciones por párrafo.
- Voz activa. Usas pasiva solo cuando el sujeto no importa.
- Cada afirmación no obvia la respaldas con un ejemplo, dato o fuente concreta en la oración siguiente.
- Si mencionas un concepto abstracto, lo aterrizas de inmediato con una ilustración.
- Las citas a estudios, papers o fuentes incluyen autor o institución.
- Las transiciones entre párrafos son explícitas: el lector nunca se pregunta "¿y esto qué tiene que ver?".
- Calificas con atributos verificables: no dices "un estudio importante" sino "un estudio de 2023 con 12,000 participantes".

Qué evitas:
- Adjetivos que no informan: "integral", "profundo", "innovador", "revolucionario", "fascinante".
- Relleno: "realmente", "verdaderamente", "básicamente", "simplemente".
- Aperturas que anuncian en vez de enganchar: "En este capítulo...", "A continuación...".

Responde ÚNICAMENTE con el contenido de la sección. Sin títulos, sin etiquetas, sin introducciones meta."""

NEW_TOPICS = {
    "Liderazgo de equipos remotos": {
        "tono_del_libro": "práctico y directo, basado en experiencia real de gestión",
        "lector_objetivo": "gerentes y líderes de equipo que gestionan personas distribuidas en distintas zonas horarias",
        "principio_central_del_capitulo": "la confianza se construye mediante sistemas y rituales, no mediante presencia física",
        "concepto_central_del_libro": "liderazgo efectivo en entornos distribuidos",
        "caso_o_historia": "una gerente de producto en una startup de 40 personas que duplicó el equipo durante la pandemia y vio cómo la productividad se desplomaba cuando intentó replicar las prácticas de oficina en remoto",
        "resultado_deseado": "un equipo remoto que opera con altos niveles de autonomía, alineación y bienestar, sin depender de la supervisión constante",
    },
    "Introducción al estoicismo práctico": {
        "tono_del_libro": "claro y cercano, sin academicismo innecesario pero con rigor conceptual",
        "lector_objetivo": "personas que buscan herramientas filosóficas aplicables a la vida diaria, sin formación previa en filosofía",
        "principio_central_del_capitulo": "la dicotomía del control — distinguir lo que depende de nosotros de lo que no— es la base de la tranquilidad mental",
        "concepto_central_del_libro": "estoicismo aplicado a los desafíos cotidianos",
        "caso_o_historia": "un emprendedor que tras el fracaso de su primer negocio cayó en una espiral de ansiedad y culpa, reviviendo cada error durante meses, hasta que encontró en un texto de Epicteto una distinción que reorganizó por completo su manera de procesar lo ocurrido",
        "resultado_deseado": "una mente más serena frente a lo incontrolable y más enfocada en las decisiones que sí están a su alcance",
    },
}

PLACEHOLDER_RE = re.compile(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}")

PROMPT_IDS = [
    "f01d764a-1f6c-4787-a1f9-374318be03ac",  # Título y promesa conceptual
    "ade8f026-308a-4808-9d20-10ca220f0cad",  # Historia de estancamiento
    "30fa9c4c-9ec2-4e80-82bc-e827c2bb9af9",  # Modelo de acumulación
    "9082c724-6bb6-4358-ae29-f0a7bd0d2456",  # Resumen operativo
]


def resolve_placeholders(content: str, topic: str) -> str:
    overrides = NEW_TOPICS[topic]

    def _replacer(match):
        name = match.group(1)
        lower = name.lower()
        if lower in ("tema", "tema_del_libro", "topic"):
            return topic
        if lower in overrides:
            return overrides[lower]
        return f"[{name.replace('_', ' ').title()}]"

    return PLACEHOLDER_RE.sub(_replacer, content)


async def generate_fragment(
    client: anthropic.AsyncAnthropic,
    prompt_content: str,
    topic: str,
) -> str:
    user_prompt = resolve_placeholders(prompt_content, topic)
    response = await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2048,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_prompt}],
    )
    text_block = next((b for b in response.content if b.type == "text"), None)
    return text_block.text if text_block else ""


async def main():
    client = anthropic.AsyncAnthropic(
        api_key=ANTHROPIC_API_KEY,
        base_url=ANTHROPIC_BASE_URL,
    )

    # Load prompts from DB
    prompts = []
    for pid in PROMPT_IDS:
        p = await fetch_prompt(UUID(pid))
        if p:
            prompts.append(p)

    if not prompts:
        print("ERROR: No prompts found")
        return

    results = []

    for topic, overrides in NEW_TOPICS.items():
        for prompt in prompts:
            print(f"Generating: topic='{topic[:40]}...' prompt='{prompt.title}'")

            fragment_text = await generate_fragment(client, prompt.content, topic)
            print(f"  Generated {len(fragment_text)} chars")

            verdict = await evaluate_fragment(
                generated_text=fragment_text,
                instruction=prompt.content,
                topic=topic,
                client=client,
            )
            print(f"  Judge: overall={verdict.overall}/10 issues={len(verdict.issues)}")

            results.append(
                {
                    "topic": topic,
                    "prompt_title": prompt.title,
                    "prompt_id": str(prompt.id),
                    "prompt_content": prompt.content,
                    "fragment": fragment_text,
                    "judge": {
                        "clarity": verdict.clarity,
                        "accuracy": verdict.accuracy,
                        "cohesion": verdict.cohesion,
                        "engagement": verdict.engagement,
                        "completeness": verdict.completeness,
                        "overall": verdict.overall,
                        "issues": verdict.issues,
                    },
                    "judge_v2": {
                        "clarity": verdict.clarity,
                        "accuracy": verdict.accuracy,
                        "cohesion": verdict.cohesion,
                        "engagement": verdict.engagement,
                        "completeness": verdict.completeness,
                        "overall": verdict.overall,
                        "issues": verdict.issues,
                    },
                    "human_rating": None,
                }
            )
            print()

    # Load existing data and append
    output_path = Path(__file__).resolve().parent.parent / "calibration_data.json"
    existing = json.loads(output_path.read_text()) if output_path.exists() else []
    combined = existing + results
    output_path.write_text(json.dumps(combined, indent=2, ensure_ascii=False))

    print(f"Appended {len(results)} new fragments. Total: {len(combined)}")
    print()
    print("=== NEW SUMMARY ===")
    for r in results:
        print(f"  [{r['judge']['overall']}/10] {r['topic'][:40]} | {r['prompt_title']}")

    await close_pool()


if __name__ == "__main__":
    asyncio.run(main())
