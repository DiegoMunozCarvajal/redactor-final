"""Full evaluation: baseline vs new meta-prompt using Groq judge.

Pipeline: DeepSeek (meta-prompt) → DeepSeek (fragments) → Groq (judge)
Both baseline and v2 use identical pipeline for fair comparison.
"""

import asyncio, json, os, sys, re
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")
from openai import AsyncOpenAI

from dspy_optimizer.meta_prompt import (
    META_PROMPT as NEW_META_PROMPT,
    FRAGMENT_SYSTEM_PROMPT,
    TEST_TOPICS,
    load_chapters,
    resolve_placeholders,
)

DEEPSEEK_KEY = os.environ["DEEPSEEK_API_KEY"]
GROQ_KEY = os.environ["GROQ_API_KEY"]
DS_BASE = "https://api.deepseek.com"
GROQ_BASE = "https://api.groq.com/openai/v1"

DS_MODEL = "deepseek-v4-pro"
GROQ_MODEL = "llama-3.3-70b-versatile"

BASELINE_META_PROMPT = """Actúa como un arquitecto narrativo y prompt engineer. Tu tarea es extraer la arquitectura funcional de un capítulo fuente y convertirla en una biblioteca de prompts modulares y reutilizables.

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

Placeholders globales (prioriza estos):
{TEMA_DEL_LIBRO}, {CONCEPTO_CENTRAL_DEL_LIBRO}, {LECTOR_OBJETIVO}, {RESULTADO_DESEADO}, {TONO_DEL_LIBRO}, {PRINCIPIO_CENTRAL_DEL_CAPITULO}

Placeholders locales (solo si son necesarios):
{CASO_O_HISTORIA}, {EJEMPLO_CONCRETO}, {FUENTE_O_PAPER_BASE}, {OBJECION_DEL_LECTOR}, {IDEA_PUENTE}

Usa la menor cantidad posible de placeholders. Cada bloque debe ser una unidad narrativa o explicativa completa. Los bloques en secuencia deben reconstruir el capítulo completo.

Responde ÚNICAMENTE con el JSON. Sin introducciones, sin notas al editor, sin texto fuera del JSON."""


JUDGE_SYSTEM = """Eres un evaluador experto de prosa de no-ficción en español. Evalúas fragmentos de capítulos de libros. Cada fragmento es parte de un capítulo mayor: conceptos pueden definirse en fragmentos anteriores. No penalices términos no definidos aquí.

⚠️ USA TODA LA ESCALA 1-10. La mayoría de fragmentos deben caer entre 3 y 8. Reserva 9-10 para calidad excepcional. Reserva 1-2 para basura.

Guía de niveles:
- 3: DEFICIENTE — No cumple la instrucción, prosa genérica sin ejemplos
- 5: ACEPTABLE — Cumple mínimamente, prosa correcta pero genérica, lugares comunes
- 7: BUENO — Cumple completamente, ejemplos o datos concretos, buen ritmo
- 9: EXCEPCIONAL — Supera la instrucción, ejemplos vívidos, datos precisos con atribución

Evalúa 5 dimensiones (1-10): clarity, accuracy, cohesion, engagement, completeness.
overall: juicio holístico (NO es el promedio).

Responde ÚNICAMENTE con JSON:
{"clarity": int, "accuracy": int, "cohesion": int, "engagement": int, "completeness": int, "overall": int, "issues": ["problema concreto"]}"""


def parse_templates(output: str) -> list[dict]:
    """Parse JSON from meta-prompt output with truncation handling."""
    try:
        data = json.loads(output)
    except json.JSONDecodeError:
        m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", output, re.DOTALL)
        if m:
            try:
                data = json.loads(m.group(1))
            except:
                data = {"templates": []}
        else:
            start = output.find("{")
            end = output.rfind("}")
            if start >= 0 and end > start:
                raw = output[start : end + 1]
                last = raw.rfind("}, {")
                if last > 0:
                    raw = raw[: last + 1] + "]}"
                try:
                    data = json.loads(raw)
                except:
                    data = {"templates": []}
            else:
                data = {"templates": []}
    return data.get("templates", [])


async def run_meta_prompt(client: AsyncOpenAI, meta_prompt: str, chapter: str) -> str:
    r = await client.chat.completions.create(
        model=DS_MODEL,
        max_tokens=16384,
        timeout=300,
        messages=[
            {"role": "system", "content": meta_prompt},
            {"role": "user", "content": f"Texto fuente:\n\n{chapter}"},
        ],
    )
    return r.choices[0].message.content or ""


async def judge_fragment(
    groq: AsyncOpenAI, fragment: str, instruction: str, topic: str
) -> dict:
    if len(fragment.strip()) < 50:
        return {"overall": 1, "empty": True}

    user_prompt = f"""## Instrucción original
{instruction}

## Tema del proyecto
{topic}

## Texto a evaluar
---
{fragment}
---"""

    r = await groq.chat.completions.create(
        model=GROQ_MODEL,
        max_tokens=512,
        temperature=0.1,
        messages=[
            {"role": "system", "content": JUDGE_SYSTEM},
            {"role": "user", "content": user_prompt},
        ],
    )
    raw = r.choices[0].message.content or ""

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        # Fallback: extract first number as overall
        nums = re.findall(r"\b([1-9]|10)\b", raw)
        return {"overall": int(nums[0]) if nums else 1, "empty": False}


async def evaluate_meta_prompt(
    ds: AsyncOpenAI,
    groq: AsyncOpenAI,
    meta_prompt: str,
    label: str,
    chapters: dict,
    topics: list,
) -> dict:
    print(f"\n{'=' * 60}")
    print(f"EVALUATING: {label}")
    print(f"{'=' * 60}")

    all_scores = []
    all_dimensions = {
        "clarity": [],
        "accuracy": [],
        "cohesion": [],
        "engagement": [],
        "completeness": [],
    }
    total_empty = 0
    total_frags = 0

    for key, ch_text in chapters.items():
        print(f"\n--- {key} ({len(ch_text)} chars) ---")

        output = await run_meta_prompt(ds, meta_prompt, ch_text)
        templates = parse_templates(output)
        real = [t for t in templates if len(t.get("content", "").strip()) >= 200][:6]

        ch_scores = []
        for t in real:
            for topic in topics:
                total_frags += 1
                user_prompt = resolve_placeholders(t.get("content", ""), topic)
                try:
                    fr = await ds.chat.completions.create(
                        model=DS_MODEL,
                        max_tokens=2048,
                        temperature=0.7,
                        messages=[
                            {"role": "system", "content": FRAGMENT_SYSTEM_PROMPT},
                            {"role": "user", "content": user_prompt},
                        ],
                    )
                    fragment = fr.choices[0].message.content or ""
                except Exception as e:
                    fragment = ""

                verdict = await judge_fragment(
                    groq, fragment, t.get("content", ""), topic.get("tema", "")
                )

                score = verdict.get("overall", 1)
                if verdict.get("empty"):
                    total_empty += 1

                ch_scores.append(score)
                for dim in all_dimensions:
                    if dim in verdict:
                        all_dimensions[dim].append(verdict[dim])

                status = "[VACÍO]" if verdict.get("empty") else f"[{score}/10]"
                print(f"  {status} {t.get('name', '?')[:60]} → {topic['tema'][:25]}")

        if ch_scores:
            mean = sum(ch_scores) / len(ch_scores)
            all_scores.extend(ch_scores)
            print(f"  Chapter mean: {mean:.1f}/10 ({len(ch_scores)} frags)")

    overall = sum(all_scores) / len(all_scores) if all_scores else 0
    dim_means = {d: sum(v) / len(v) for d, v in all_dimensions.items() if v}
    empty_rate = total_empty / total_frags * 100 if total_frags else 0

    print(f"\n  {label} OVERALL: {overall:.2f}/10")
    print(f"  Dimensions: {', '.join(f'{k}={v:.1f}' for k, v in dim_means.items())}")
    print(f"  Empty rate: {total_empty}/{total_frags} ({empty_rate:.0f}%)")

    return {
        "label": label,
        "overall": overall,
        "dimensions": dim_means,
        "empty_rate": empty_rate,
        "total_empty": total_empty,
        "scores": all_scores,
    }


async def main():
    chapters = load_chapters()
    topics = TEST_TOPICS[:2]
    print(f"Chapters: {list(chapters.keys())}")
    print(f"Topics: {[t['tema'][:40] for t in topics]}")

    ds = AsyncOpenAI(api_key=DEEPSEEK_KEY, base_url=DS_BASE)
    groq = AsyncOpenAI(api_key=GROQ_KEY, base_url=GROQ_BASE)

    # Run both evaluations
    baseline = await evaluate_meta_prompt(
        ds, groq, BASELINE_META_PROMPT, "BASELINE", chapters, topics
    )
    new = await evaluate_meta_prompt(
        ds, groq, NEW_META_PROMPT, "NEW v2", chapters, topics
    )

    # Summary
    print(f"\n{'=' * 60}")
    print("FINAL COMPARISON")
    print(f"{'=' * 60}")
    print(
        f"Baseline:  {baseline['overall']:.2f}/10 | empty={baseline['empty_rate']:.0f}%"
    )
    print(f"New v2:    {new['overall']:.2f}/10 | empty={new['empty_rate']:.0f}%")
    delta = new["overall"] - baseline["overall"]
    print(f"Delta:     {delta:+.2f}/10")
    print(f"Empty reduction: {baseline['empty_rate']:.0f}% → {new['empty_rate']:.0f}%")

    # Save
    out = {"baseline": baseline, "new": new, "delta": delta}
    out_path = Path(__file__).resolve().parent.parent / "groq_eval_results.json"
    out_path.write_text(json.dumps(out, indent=2, ensure_ascii=False))
    print(f"\nSaved to {out_path}")


if __name__ == "__main__":
    asyncio.run(main())
