"""Generate calibration fragments and evaluate with judge.

Selects diverse topics and prompts, generates fragments using the same
system prompt as the TypeScript pipeline, then evaluates with the judge.
Outputs a JSON file for human rating comparison.

Uses real Anthropic API (not DeepSeek proxy) for both generation and judging.
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

import anthropic

from dotenv import load_dotenv

from dspy_optimizer.judge import evaluate_fragment
from dspy_optimizer.db import close_pool, fetch_prompt

load_dotenv(Path(__file__).resolve().parents[3] / ".env")

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
ANTHROPIC_BASE_URL = "https://api.anthropic.com"

# Same system prompt as lib/generate.ts DEFAULT_SYSTEM_PROMPT
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

# Diverse topics in Spanish
TOPICS = [
    "Inversión en criptomonedas para principiantes",
    "Nutrición basada en plantas para deportistas",
]

# Prompt IDs from "James Clear - Diego" template
PROMPT_IDS = [
    "f01d764a-1f6c-4787-a1f9-374318be03ac",  # Título y promesa conceptual
    "ade8f026-308a-4808-9d20-10ca220f0cad",  # Historia de estancamiento
    "30fa9c4c-9ec2-4e80-82bc-e827c2bb9af9",  # Modelo de acumulación
    "9082c724-6bb6-4358-ae29-f0a7bd0d2456",  # Resumen operativo
]

PLACEHOLDER_RE = __import__("re").compile(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}")

# Topic-specific placeholder overrides.
# Keys: lowercase placeholder name. Values: topic → resolved text.
TOPIC_PLACEHOLDER_MAP = {
    "Inversión en criptomonedas para principiantes": {
        "tono_del_libro": "profesional pero accesible, sin tecnicismos innecesarios",
        "lector_objetivo": "personas sin experiencia en inversiones que quieren entender criptomonedas desde cero",
        "principio_central_del_capitulo": "la inversión gradual, diversificada y de largo plazo supera consistentemente a la especulación",
        "concepto_central_del_libro": "inversión inteligente y paciente en criptoactivos",
        "caso_o_historia": "un profesional de 35 años que ahorró durante una década pero nunca invirtió por miedo a las criptomonedas, y vio cómo la inflación erosionaba sus ahorros año tras año",
        "resultado_deseado": "un portafolio diversificado, resiliente a la volatilidad y con crecimiento sostenido en el tiempo",
    },
    "Nutrición basada en plantas para deportistas": {
        "tono_del_libro": "científico pero cercano, basado en evidencia sin ser árido",
        "lector_objetivo": "deportistas aficionados y profesionales que quieren optimizar su rendimiento con alimentación vegetal",
        "principio_central_del_capitulo": "la nutrición vegetal bien planificada no solo iguala sino que puede superar a la omnívora en recuperación muscular y energía sostenida",
        "concepto_central_del_libro": "alimentación vegetal estratégica para máximo rendimiento deportivo",
        "caso_o_historia": "un corredor de maratón que estancó sus tiempos durante dos años y descubrió que su alimentación omnívora le generaba inflamación crónica que sabotaba su recuperación",
        "resultado_deseado": "un plan nutricional vegetal que maximiza energía, acelera la recuperación y reduce la inflamación",
    },
}


def resolve_placeholders(content: str, topic: str) -> str:
    """Resolve all {name} placeholders in prompt content.

    - {TEMA_DEL_LIBRO} → the project topic
    - Topic-specific placeholders → from TOPIC_PLACEHOLDER_MAP
    - Unknown placeholders → replaced with reasonable generic text
    """
    overrides = TOPIC_PLACEHOLDER_MAP.get(topic, {})

    def _replacer(match):
        name = match.group(1)
        lower = name.lower()

        # {TEMA_DEL_LIBRO} and variants → use the topic
        if lower in ("tema", "tema_del_libro", "topic"):
            return topic

        # Topic-specific overrides
        if lower in overrides:
            return overrides[lower]

        # Unknown — provide a generic filler to avoid the model stalling
        return f"[{name.replace('_', ' ').title()}]"

    return PLACEHOLDER_RE.sub(_replacer, content)


async def generate_fragment(
    client: anthropic.AsyncAnthropic,
    prompt_content: str,
    topic: str,
) -> str:
    """Generate a fragment using the same system prompt as the pipeline."""
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
    # Use real Anthropic API, not the DeepSeek proxy
    client = anthropic.AsyncAnthropic(
        api_key=ANTHROPIC_API_KEY,
        base_url=ANTHROPIC_BASE_URL,
    )

    # Load prompts from DB
    prompts = []
    for pid in PROMPT_IDS:
        from uuid import UUID

        p = await fetch_prompt(UUID(pid))
        if p:
            prompts.append(p)

    if not prompts:
        print("ERROR: No prompts found")
        return

    print(f"Loaded {len(prompts)} prompts")
    print(f"Topics: {len(TOPICS)}")
    print(f"Total fragments to generate: {len(prompts) * len(TOPICS)}")
    print()

    results = []

    for topic in TOPICS:
        for prompt in prompts:
            print(f"Generating: topic='{topic[:40]}...' prompt='{prompt.title}'")

            fragment_text = await generate_fragment(client, prompt.content, topic)
            print(f"  Generated {len(fragment_text)} chars")

            # Evaluate with judge
            verdict = await evaluate_fragment(
                generated_text=fragment_text,
                instruction=prompt.content,
                topic=topic,
                client=client,
            )
            print(f"  Judge: overall={verdict.overall}/10 issues={verdict.issues}")

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
                    # For human rating
                    "human_rating": None,
                }
            )

            print()

    # Save to JSON
    output_path = Path(__file__).resolve().parent.parent / "calibration_data.json"
    output_path.write_text(json.dumps(results, indent=2, ensure_ascii=False))

    print(f"\nSaved {len(results)} results to {output_path}")
    print()
    print("=== SUMMARY ===")
    for r in results:
        print(f"  [{r['judge']['overall']}/10] {r['topic'][:40]} | {r['prompt_title']}")

    avg = sum(r["judge"]["overall"] for r in results) / len(results)
    print(f"\nAverage judge score: {avg:.1f}/10")

    await close_pool()


if __name__ == "__main__":
    asyncio.run(main())
