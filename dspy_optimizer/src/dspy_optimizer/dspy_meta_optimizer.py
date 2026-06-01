"""DSPy + MIPROv2 optimization of the meta-prompt.

Optimizes the instruction text of the meta-prompt that converts source chapters
into modular prompt templates. The metric evaluates downstream fragment quality.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from dataclasses import dataclass

import dspy
from dotenv import load_dotenv
from openai import AsyncOpenAI

from dspy_optimizer.meta_prompt import (
    META_PROMPT,
    FRAGMENT_SYSTEM_PROMPT,
    TEST_TOPICS,
    PromptTemplate,
    MetaPromptOutput,
    parse_meta_prompt_output,
    resolve_placeholders,
    load_chapters,
)
from dspy_optimizer.judge import JudgeVerdict, _parse_verdict, JUDGE_SYSTEM_PROMPT

# Load env
_project_root = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
load_dotenv(os.path.join(_project_root, "..", ".env"))

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")

# Models — all DeepSeek after OpenAI credits exhausted
META_MODEL = "deepseek-v4-pro"
FRAGMENT_MODEL = "deepseek-v4-pro"
JUDGE_MODEL = "deepseek-v4-pro"
DEEPSEEK_BASE = "https://api.deepseek.com"

# Use 1 topic per chapter for metric (keep optimization fast)
METRIC_TOPIC = TEST_TOPICS[0]
MAX_TEMPLATES_PER_CHAPTER = 4  # Evaluate first 4 templates per chapter


# ── DSPy Signature ────────────────────────────────────────────────


class ChapterToTemplates(dspy.Signature):
    """Convierte un capítulo fuente en una biblioteca de prompts modulares.

    El output debe ser un JSON con 'templates': una lista de objetos con
    'name', 'function', 'content', 'placeholders', 'notes'.

    Cada template es un prompt independiente que genera una sección del capítulo.
    Los templates en secuencia deben reconstruir el capítulo completo.

    ⚠️ Entrega exactamente entre 6 y 10 templates. Apunta a 8.
    Cada content debe producir máximo 4 párrafos.
    Usa {PLACEHOLDERS} para variables reutilizables."""

    source_chapter: str = dspy.InputField(
        desc="Texto completo del capítulo fuente en markdown, del cual extraer la arquitectura"
    )
    templates_json: str = dspy.OutputField(
        desc="JSON con clave 'templates' que contiene el array de prompts modulares"
    )


# ── DSPy Module ────────────────────────────────────────────────────


class MetaPromptGenerator(dspy.Module):
    """DSPy Module that wraps the meta-prompt call.

    MIPROv2 will optimize the instruction of `self.generate`.
    Starts from the carefully crafted META_PROMPT as baseline instruction.
    """

    def __init__(self):
        super().__init__()
        self.generate = dspy.ChainOfThought(ChapterToTemplates)
        # Set the initial instruction to our crafted meta-prompt
        self.generate.predict.signature.instructions = META_PROMPT

    def forward(self, source_chapter: str) -> dspy.Prediction:
        result = self.generate(source_chapter=source_chapter)
        return dspy.Prediction(templates_json=result.templates_json)


# ── Metric (2-hop) ─────────────────────────────────────────────────


def _extract_templates(templates_json: str) -> list[dict]:
    """Parse JSON from DSPy output, with robust error handling including truncated JSON."""
    try:
        data = json.loads(templates_json)
    except json.JSONDecodeError:
        # Try code block extraction
        m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", templates_json, re.DOTALL)
        if m:
            try:
                data = json.loads(m.group(1))
            except json.JSONDecodeError:
                data = None
        else:
            data = None

        if data is None:
            # Try first { to last }
            start = templates_json.find("{")
            end = templates_json.rfind("}")
            if start >= 0 and end > start:
                raw = templates_json[start : end + 1]
                try:
                    data = json.loads(raw)
                except json.JSONDecodeError:
                    # Truncated JSON: try to close it by removing last incomplete template
                    # Find last complete template by looking for "}, {"
                    last_complete = raw.rfind("}, {")
                    if last_complete > 0:
                        closed = raw[: last_complete + 1] + "]}"
                        try:
                            data = json.loads(closed)
                        except json.JSONDecodeError:
                            return []
                    else:
                        return []
            else:
                return []

    if isinstance(data, dict):
        return data.get("templates", [])
    if isinstance(data, list):
        return data
    return []


async def _generate_and_judge(
    deepseek: AsyncOpenAI,
    judge: AsyncOpenAI,
    template: dict,
    topic_overrides: dict[str, str],
) -> float:
    """Generate a fragment from a template and judge it. Returns score 0-10."""
    user_prompt = resolve_placeholders(template.get("content", ""), topic_overrides)

    try:
        # Generate fragment
        response = await deepseek.chat.completions.create(
            model=FRAGMENT_MODEL,
            max_tokens=2048,
            temperature=0.7,
            messages=[
                {"role": "system", "content": FRAGMENT_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
        )
        fragment = response.choices[0].message.content or ""

        # Judge (using DeepSeek as judge)
        from dspy_optimizer.judge import _build_judge_user_prompt

        judge_prompt = _build_judge_user_prompt(
            fragment,
            template.get("content", ""),
            topic_overrides.get("tema", topic_overrides.get("TEMA_DEL_LIBRO", "")),
        )
        response = await judge.chat.completions.create(
            model=JUDGE_MODEL,
            max_tokens=1024,  # DeepSeek uses max_tokens, not max_completion_tokens
            temperature=0.0,
            messages=[
                {"role": "system", "content": JUDGE_SYSTEM_PROMPT},
                {"role": "user", "content": judge_prompt},
            ],
        )
        raw = response.choices[0].message.content or ""
        verdict = _parse_verdict(raw)
        return float(verdict.overall)

    except Exception as e:
        print(f"      [metric error] {e}")
        return 0.0


def meta_prompt_metric(
    example: dspy.Example, pred: dspy.Prediction, trace=None
) -> float:
    """DSPy metric: generate fragments from templates and judge them.

    This is a 2-hop metric:
    1. Parse templates from the meta-prompt output
    2. Generate fragments from templates
    3. Judge fragment quality
    4. Return mean score with count penalty
    """
    templates = _extract_templates(pred.templates_json)

    if not templates:
        return 0.0

    # Count penalty: target 6-10
    count = len(templates)
    if count < 6:
        count_penalty = 0.7
    elif count > 12:
        count_penalty = 0.7
    else:
        count_penalty = 1.0

    # Generate and judge fragments (sync wrapper around async)
    templates_to_use = templates[:MAX_TEMPLATES_PER_CHAPTER]

    async def _evaluate():
        deepseek = AsyncOpenAI(api_key=DEEPSEEK_API_KEY, base_url=DEEPSEEK_BASE)
        judge = AsyncOpenAI(
            api_key=DEEPSEEK_API_KEY, base_url=DEEPSEEK_BASE
        )  # DeepSeek for judging too
        scores = []
        for t in templates_to_use:
            score = await _generate_and_judge(deepseek, judge, t, METRIC_TOPIC)
            scores.append(score)
        return scores

    try:
        scores = asyncio.run(_evaluate())
    except Exception as e:
        print(f"    [metric batch error] {e}")
        return 0.0

    if not scores:
        return 0.0

    mean_score = sum(scores) / len(scores)
    return mean_score * count_penalty


# ── Dataset builder ─────────────────────────────────────────────────


def build_dataset(
    chapters: dict[str, str] | None = None,
) -> tuple[list[dspy.Example], list[dspy.Example]]:
    """Build train/val split from source chapters.

    Returns (trainset, valset) for MIPROv2.
    """
    if chapters is None:
        chapters = load_chapters()

    examples = [
        dspy.Example(source_chapter=text).with_inputs("source_chapter")
        for text in chapters.values()
    ]

    # With 5 examples, use 4 for train, 1 for val
    if len(examples) >= 3:
        split = max(1, len(examples) // 4)
        trainset = examples[:-split]
        valset = examples[-split:]
    else:
        trainset = examples
        valset = examples

    return trainset, valset


# ── Optimizer ───────────────────────────────────────────────────────


def optimize_meta_prompt(
    trainset: list[dspy.Example],
    valset: list[dspy.Example],
    auto_mode: str = "light",
) -> dspy.Module:
    """Run MIPROv2 optimization on the meta-prompt.

    Args:
        trainset: Training examples (source chapters)
        valset: Validation examples
        auto_mode: MIPROv2 preset ("light", "medium", "heavy")

    Returns:
        Optimized DSPy module with improved meta-prompt instruction.
    """
    from dspy.teleprompt import MIPROv2

    # Configure DSPy LM for DeepSeek (OpenAI-compatible endpoint)
    lm = dspy.LM(
        f"openai/{META_MODEL}",
        api_key=DEEPSEEK_API_KEY,
        api_base=DEEPSEEK_BASE,
    )
    dspy.configure(lm=lm)

    # Create the module
    module = MetaPromptGenerator()

    # Set up MIPROv2 optimizer
    optimizer = MIPROv2(
        metric=meta_prompt_metric,
        auto=auto_mode,
        num_threads=1,  # Sequential — metric is already async
        verbose=True,
    )

    print(f"Optimizing with MIPROv2 auto={auto_mode}...")
    print(f"  Trainset: {len(trainset)} examples")
    print(f"  Valset: {len(valset)} examples")

    optimized = optimizer.compile(
        module,
        trainset=trainset,
        valset=valset,
    )

    return optimized


# ── Extract optimized instruction ───────────────────────────────────


def extract_instruction(optimized_module: dspy.Module) -> str:
    """Extract the optimized instruction text from the compiled module."""
    try:
        predictor = optimized_module.generate
        if hasattr(predictor, "predict") and hasattr(predictor.predict, "signature"):
            sig = predictor.predict.signature
            if hasattr(sig, "instructions"):
                return sig.instructions
        # Fallback: try nested
        for attr in dir(predictor):
            obj = getattr(predictor, attr)
            if hasattr(obj, "signature"):
                sig = obj.signature
                if hasattr(sig, "instructions") and sig.instructions:
                    return sig.instructions
    except Exception as e:
        print(f"  [WARN] Could not extract instruction: {e}")
    return ""
