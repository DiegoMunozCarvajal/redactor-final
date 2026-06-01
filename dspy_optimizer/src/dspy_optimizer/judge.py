"""LLM-as-Judge for Spanish non-fiction prose quality.

Uses Claude Opus 4.7 (via Anthropic SDK) to evaluate generated fragments
on five dimensions. Calibrated against human ratings (target correlation > 0.7).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass

import anthropic

from dspy_optimizer.config import cfg

# ── Judge prompt ─────────────────────────────────────────────────

JUDGE_SYSTEM_PROMPT = """Eres un evaluador experto de prosa de no-ficción en español.
Evalúas fragmentos de capítulos de libros. Cada fragmento es parte de un capítulo mayor:
conceptos pueden definirse en fragmentos anteriores. No penalices términos no definidos aquí.

⚠️ USA TODA LA ESCALA 1-10. La mayoría de fragmentos deben caer entre 3 y 8.
Reserva 9-10 para calidad excepcional. Reserva 1-2 para basura.

Guía de niveles:

NIVEL 3 — DEFICIENTE:
- No cumple la instrucción o la ignora
- Prosa genérica, sin ejemplos ni sustento
- Pide aclaraciones en vez de generar contenido
Ej: "Para escribir sobre este tema necesito saber más detalles sobre el público objetivo..."

NIVEL 5 — ACEPTABLE:
- Cumple la instrucción mínimamente
- Prosa correcta pero genérica: lugares comunes, consejos obvios
- Sin ejemplos concretos o con ejemplos vagos ("muchas personas", "estudios demuestran")
- El lector no aprende nada que no supiera ya
Ej: "Invertir poco a poco reduce el riesgo. Diversificar protege tu cartera. Mantén la calma
ante la volatilidad."

NIVEL 7 — BUENO:
- Cumple la instrucción completamente
- Al menos 1-2 ejemplos o datos concretos con fuente reconocible
- Buen ritmo, transiciones fluidas, voz activa consistente
- El lector aprende algo específico y aplicable
Ej: "Warren Buffett acumuló el 96% de su riqueza después de los 65 años. La razón no fue
que empezara a invertir mejor: fue que llevaba décadas sumando rendimientos sobre rendimientos."

NIVEL 9 — EXCEPCIONAL:
- Supera la instrucción: no solo cumple, sino que ilumina
- Ejemplos vívidos con detalles sensoriales o narrativos
- Datos precisos con atribución verificable (autor, año, institución, metodología)
- El lector termina con una idea que no olvidará
Ej: narrativa con personaje concreto, lugar, cifras exactas, tensión dramática contenida,
y una revelación que reorganiza lo que el lector creía saber.

Para cada fragmento, asigna 1-10 en estas 5 dimensiones:

1. **clarity** (1-10): ¿Oraciones cortas (15-25 palabras) con ritmo variado?
   ¿Se entiende a la primera lectura? ¿Sin ambigüedad?

2. **accuracy** (1-10): ¿Afirmaciones respaldadas con ejemplos, datos o fuentes concretas?
   ¿Atribución verificable? ¿Sin adjetivos vacíos ("importante", "profundo", "innovador")?
   ¿Los datos citados suenan reales o fabricados?

3. **cohesion** (1-10): ¿Transiciones explícitas entre párrafos? ¿Un párrafo = una idea?
   ¿Máximo 5 oraciones por párrafo?

4. **engagement** (1-10): ¿Voz activa? ¿Sin relleno ("realmente", "básicamente")?
   ¿Sin meta-aperturas ("En este capítulo...", "A continuación...")? ¿Sin clichés?

5. **completeness** (1-10): ¿Cubre lo que pide la instrucción? ¿Sin cabos sueltos?

Además:
- **overall**: NO es el promedio. Es tu juicio holístico: ¿qué tan bueno es este fragmento
  como prosa de no-ficción? Usa la guía de niveles (3-5-7-9) como referencia.
- **issues**: problemas concretos (máximo 3). Cita frases problemáticas. Si no hay problemas
  significativos, lista vacía. Sé exigente: "aceptable" no es "sin problemas".

ANTES DE PUNTUAR, pregúntate:
- ¿Este fragmento es nivel 3, 5, 7 o 9?
- ¿Estoy usando todo el rango o comprimiendo en 7-9?
- Si es fluido pero genérico → 5, no 8.

Responde ÚNICAMENTE con un objeto JSON con este formato exacto:
{
  "clarity": <int 1-10>,
  "accuracy": <int 1-10>,
  "cohesion": <int 1-10>,
  "engagement": <int 1-10>,
  "completeness": <int 1-10>,
  "overall": <int 1-10>,
  "issues": ["<problema concreto 1>", "<problema concreto 2>"]
}"""


@dataclass
class JudgeVerdict:
    clarity: int
    accuracy: int
    cohesion: int
    engagement: int
    completeness: int
    overall: int
    issues: list[str]

    @property
    def score(self) -> float:
        """Normalized 0-1 score."""
        return self.overall / 10.0

    @property
    def dimensions(self) -> dict[str, int]:
        return {
            "clarity": self.clarity,
            "accuracy": self.accuracy,
            "cohesion": self.cohesion,
            "engagement": self.engagement,
            "completeness": self.completeness,
        }


def _build_judge_user_prompt(
    generated_text: str,
    instruction: str,
    topic: str,
    style_rules: str | None = None,
) -> str:
    """Build the user prompt for the judge."""
    parts = [
        "## Instrucción original",
        instruction,
        "",
        "## Tema del proyecto",
        topic,
    ]
    if style_rules:
        parts.extend(["", "## Reglas de estilo esperadas", style_rules])
    parts.extend(
        [
            "",
            "## Texto a evaluar",
            "---",
            generated_text,
            "---",
        ]
    )
    return "\n".join(parts)


def _parse_verdict(raw: str) -> JudgeVerdict:
    """Parse the judge's JSON response, with fallback for DeepSeek's text output."""
    if not raw or not raw.strip():
        raise ValueError("Empty judge output")

    # Try direct JSON parse first
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        # Try to extract JSON block from markdown or surrounding text
        match = re.search(r"\{[^{}]*\"clarity\"[^{}]*\}", raw, re.DOTALL)
        if match:
            try:
                data = json.loads(match.group())
            except json.JSONDecodeError:
                data = None
        else:
            data = None

        if data is None:
            # Fallback for DeepSeek: extract first number as overall score
            # DeepSeek often replies with "7\nExplanation text..." or just "7"
            numbers = re.findall(r"\b([1-9]|10)\b", raw)
            if numbers:
                score = int(numbers[0])
                return JudgeVerdict(
                    clarity=score,
                    accuracy=score,
                    cohesion=score,
                    engagement=score,
                    completeness=score,
                    overall=score,
                    issues=[],
                )
            raise ValueError(f"Could not parse judge output: {raw[:200]}")

    return JudgeVerdict(
        clarity=int(data["clarity"]),
        accuracy=int(data["accuracy"]),
        cohesion=int(data["cohesion"]),
        engagement=int(data["engagement"]),
        completeness=int(data["completeness"]),
        overall=int(data["overall"]),
        issues=data.get("issues", []),
    )


async def evaluate_fragment(
    generated_text: str,
    instruction: str,
    topic: str,
    style_rules: str | None = None,
    client: anthropic.AsyncAnthropic | None = None,
    openai_client: "AsyncOpenAI | None" = None,
    judge_model: str = "gpt-5.4",
) -> JudgeVerdict:
    """Evaluate a single generated fragment.

    Uses Anthropic if client is provided, otherwise falls back to OpenAI.
    """
    user_prompt = _build_judge_user_prompt(
        generated_text, instruction, topic, style_rules
    )

    if client is not None:
        response = await client.messages.create(
            model="claude-opus-4-7",
            max_tokens=1024,
            system=JUDGE_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )
        raw = response.content[0].text if response.content else ""
    elif openai_client is not None:
        from openai import AsyncOpenAI

        response = await openai_client.chat.completions.create(
            model=judge_model,
            max_tokens=1024,  # DeepSeek uses max_tokens, not max_completion_tokens
            temperature=0.7,  # DeepSeek needs >0 to output reliably
            messages=[
                {"role": "system", "content": JUDGE_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
        )
        raw = response.choices[0].message.content or ""
    else:
        raise ValueError("Either client (Anthropic) or openai_client must be provided")

    return _parse_verdict(raw)


async def evaluate_fragments_batch(
    fragments: list[tuple[str, str, str]],
    style_rules: str | None = None,
    concurrency: int = 5,
) -> list[JudgeVerdict]:
    """Evaluate multiple fragments concurrently.

    Args:
        fragments: List of (generated_text, instruction, topic) tuples.
        style_rules: Optional style rules shared across all evaluations.
        concurrency: Max concurrent judge calls.

    Returns:
        List of verdicts in the same order as input fragments.
    """
    import asyncio

    client = anthropic.AsyncAnthropic(api_key=cfg.anthropic_api_key)
    semaphore = asyncio.Semaphore(concurrency)

    async def _eval_one(text: str, instruction: str, topic: str) -> JudgeVerdict:
        async with semaphore:
            return await evaluate_fragment(
                text, instruction, topic, style_rules, client
            )

    tasks = [
        _eval_one(text, instruction, topic) for text, instruction, topic in fragments
    ]
    return await asyncio.gather(*tasks)
