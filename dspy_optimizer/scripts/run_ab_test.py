"""Quick A/B: zero-shot vs bootstrapped (with demos) on a single chapter.

Minimal, fast, diagnostic. Tests whether few-shot demos improve meta-prompt output.
"""

import asyncio, json, os, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import dspy
from dotenv import load_dotenv
from openai import AsyncOpenAI

from dspy_optimizer.meta_prompt import (
    META_PROMPT,
    FRAGMENT_SYSTEM_PROMPT,
    TEST_TOPICS,
    load_chapters,
    resolve_placeholders,
)
from dspy_optimizer.judge import (
    JUDGE_SYSTEM_PROMPT,
    _parse_verdict,
    _build_judge_user_prompt,
)
from dspy_optimizer.fast_metric import fast_metric
from dspy_optimizer.dspy_meta_optimizer import MetaPromptGenerator, _extract_templates

load_dotenv(Path(__file__).resolve().parents[3] / ".env")

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
DEEPSEEK_API_KEY = os.environ["DEEPSEEK_API_KEY"]
DEEPSEEK_BASE = "https://api.deepseek.com"
# All DeepSeek after OpenAI credits exhausted
META_MODEL = "deepseek-v4-pro"  # DeepSeek for meta-prompt
META_PROVIDER = "deepseek"  # DSPy provider
FRAGMENT_MODEL = "deepseek-v4-pro"  # DeepSeek for fragments
JUDGE_MODEL = "deepseek-v4-pro"  # DeepSeek for judging


async def judge_program_output(
    deepseek: AsyncOpenAI,
    templates_json: str,
    topic: dict,
    max_templates: int = 4,
) -> list[int]:
    """Generate fragments and judge them using DeepSeek. Returns list of scores."""
    templates = _extract_templates(templates_json)
    real = [t for t in templates if len(t.get("content", "").strip()) >= 200][
        :max_templates
    ]
    if not real:
        return []

    scores = []
    for t in real:
        user_prompt = resolve_placeholders(t.get("content", ""), topic)
        try:
            # Generate fragment
            r = await deepseek.chat.completions.create(
                model=FRAGMENT_MODEL,
                max_tokens=2048,
                temperature=0.7,
                messages=[
                    {"role": "system", "content": FRAGMENT_SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
            )
            fragment = r.choices[0].message.content or ""

            # Judge fragment (DeepSeek as judge)
            jp = _build_judge_user_prompt(
                fragment, t.get("content", ""), topic.get("tema", "")
            )
            r = await deepseek.chat.completions.create(
                model=JUDGE_MODEL,
                max_tokens=1024,
                temperature=0.0,
                messages=[
                    {"role": "system", "content": JUDGE_SYSTEM_PROMPT},
                    {"role": "user", "content": jp},
                ],
            )
            verdict = _parse_verdict(r.choices[0].message.content or "")
            scores.append(verdict.overall)
            print(f"    [{verdict.overall}/10] {t.get('name', '?')[:60]}")
        except Exception as e:
            print(f"    [ERR] {e}")
            scores.append(0)
    return scores


async def main():
    chapters = load_chapters()
    keys = list(chapters.keys())
    train_keys = keys[:-1]  # 4 chapters for bootstrap
    test_key = keys[-1]  # 1 chapter for evaluation
    topic = TEST_TOPICS[0]  # 1 topic for speed

    print(f"Train: {train_keys}, Test: {test_key}, Topic: {topic['tema']}")

    # Build trainset
    train_dataset = [
        dspy.Example(source_chapter=chapters[k]).with_inputs("source_chapter")
        for k in train_keys
    ]

    # Configure LM — DeepSeek via OpenAI-compatible endpoint
    lm = dspy.LM(
        f"openai/{META_MODEL}",
        api_key=DEEPSEEK_API_KEY,
        api_base=DEEPSEEK_BASE,
    )
    dspy.configure(lm=lm)

    # ── Bootstrap (collect demos) ──
    print("\n--- Bootstrapping (max 2 demos) ---")
    base = MetaPromptGenerator()
    bootstrap = dspy.BootstrapFewShot(
        metric=fast_metric,
        metric_threshold=0.5,
        max_bootstrapped_demos=2,
        max_labeled_demos=1,
        max_rounds=1,
        max_errors=3,
    )
    with_demos = bootstrap.compile(base, trainset=train_dataset)

    for i, p in enumerate(with_demos.predictors()):
        demos = getattr(p, "demos", [])
        print(f"Predictor {i}: {len(demos)} demos")

    # ── Run both programs on test chapter ──
    print(f"\n--- Running meta-prompt on {test_key} ---")
    test_text = chapters[test_key]

    with dspy.context(lm=lm):
        zero_result = base(source_chapter=test_text)
    zero_templates = len(_extract_templates(zero_result.templates_json))
    print(
        f"Zero-shot: {zero_templates} templates, {len(zero_result.templates_json)} chars"
    )

    with dspy.context(lm=lm):
        demo_result = with_demos(source_chapter=test_text)
    demo_templates = len(_extract_templates(demo_result.templates_json))
    print(
        f"With demos: {demo_templates} templates, {len(demo_result.templates_json)} chars"
    )

    # ── Judge both outputs ──
    print(f"\n--- Judging (topic: {topic['tema']}) ---")
    deepseek = AsyncOpenAI(api_key=DEEPSEEK_API_KEY, base_url=DEEPSEEK_BASE)

    print("\nZero-shot fragments:")
    zero_scores = await judge_program_output(
        deepseek, zero_result.templates_json, topic
    )
    print(
        f"  Mean: {sum(zero_scores) / len(zero_scores):.1f}/10"
        if zero_scores
        else "  No scores"
    )

    print("\nWith-demos fragments:")
    demo_scores = await judge_program_output(
        deepseek, demo_result.templates_json, topic
    )
    print(
        f"  Mean: {sum(demo_scores) / len(demo_scores):.1f}/10"
        if demo_scores
        else "  No scores"
    )

    # ── Summary ──
    print(f"\n{'=' * 50}")
    zero_mean = sum(zero_scores) / len(zero_scores) if zero_scores else 0
    demo_mean = sum(demo_scores) / len(demo_scores) if demo_scores else 0
    print(f"Zero-shot:  {zero_mean:.1f}/10 ({zero_templates} templates)")
    print(f"With demos: {demo_mean:.1f}/10 ({demo_templates} templates)")
    print(f"Delta:      {demo_mean - zero_mean:+.1f}")

    if demo_mean > zero_mean:
        print("\nFew-shot demos IMPROVE meta-prompt output.")
    elif demo_mean < zero_mean:
        print(
            "\nFew-shot demos DEGRADE meta-prompt output (overfitting to train chapters)."
        )
    else:
        print("\nNo significant difference.")


if __name__ == "__main__":
    asyncio.run(main())
