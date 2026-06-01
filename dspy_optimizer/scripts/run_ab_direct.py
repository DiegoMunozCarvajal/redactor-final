"""Direct A/B test: manually add demos, compare with judge.

Bypasses DSPy's BootstrapFewShot (which hangs). Tests the core hypothesis:
do few-shot demos improve meta-prompt output?
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
from dspy_optimizer.dspy_meta_optimizer import _extract_templates

load_dotenv(Path(__file__).resolve().parents[3] / ".env")

DEEPSEEK_API_KEY = os.environ["DEEPSEEK_API_KEY"]
DEEPSEEK_BASE = "https://api.deepseek.com"
MODEL = "deepseek-v4-pro"


async def run_meta_prompt(client: AsyncOpenAI, chapter: str) -> str:
    """Run the meta-prompt directly (no DSPy overhead)."""
    r = await client.chat.completions.create(
        model=MODEL,
        max_tokens=16384,
        timeout=300,  # Need high limit for 8+ templates
        messages=[
            {"role": "system", "content": META_PROMPT},
            {"role": "user", "content": f"Texto fuente:\n\n{chapter}"},
        ],
    )
    return r.choices[0].message.content or ""


async def judge_output(
    client: AsyncOpenAI,
    templates_json: str,
    topic: dict,
    max_templates: int = 4,
) -> list[int]:
    """Generate fragments and judge. Returns list of 0-10 scores."""
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
            r = await client.chat.completions.create(
                model=MODEL,
                max_tokens=2048,
                temperature=0.7,
                messages=[
                    {"role": "system", "content": FRAGMENT_SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
            )
            fragment = r.choices[0].message.content or ""

            # Judge
            jp = _build_judge_user_prompt(
                fragment, t.get("content", ""), topic.get("tema", "")
            )
            r = await client.chat.completions.create(
                model=MODEL,
                max_tokens=1024,
                temperature=0.7,  # DeepSeek needs temp > 0
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
    # Use first 2 chapters for demos, chapter_13 for testing
    demo_keys = keys[:2]  # chapter_01, chapter_02
    test_key = keys[-1]  # chapter_13
    topic = TEST_TOPICS[0]
    client = AsyncOpenAI(api_key=DEEPSEEK_API_KEY, base_url=DEEPSEEK_BASE)

    print(f"Demo chapters: {demo_keys}")
    print(f"Test chapter: {test_key}")
    print(f"Topic: {topic['tema']}")

    # ── Step 1: Generate demos manually ──
    print("\n--- Generating demos ---")
    demos = []
    for key in demo_keys:
        print(f"  Running meta-prompt on {key} ({len(chapters[key])} chars)...")
        output = await run_meta_prompt(client, chapters[key])
        templates = _extract_templates(output)
        real = len([t for t in templates if len(t.get("content", "").strip()) >= 200])
        print(f"    {len(templates)} templates ({real} real), {len(output)} chars")
        demos.append(
            dspy.Example(
                source_chapter=chapters[key],
                templates_json=output,
            ).with_inputs("source_chapter")
        )

    print(f"  Collected {len(demos)} demos")

    # ── Step 2: Build zero-shot and few-shot programs ──
    from dspy_optimizer.dspy_meta_optimizer import MetaPromptGenerator

    lm = dspy.LM(f"openai/{MODEL}", api_key=DEEPSEEK_API_KEY, api_base=DEEPSEEK_BASE)
    dspy.configure(lm=lm)

    # Zero-shot
    zero_shot = MetaPromptGenerator()

    # Few-shot: manually add demos
    few_shot = MetaPromptGenerator()
    few_shot.generate.demos = demos

    print(f"\nZero-shot demos: {len(getattr(zero_shot.generate, 'demos', []))}")
    print(f"Few-shot demos: {len(getattr(few_shot.generate, 'demos', []))}")

    # ── Step 3: Run both on test chapter ──
    print(f"\n--- Running meta-prompt on {test_key} ---")
    test_text = chapters[test_key]

    with dspy.context(lm=lm):
        zero_result = zero_shot(source_chapter=test_text)
    zero_n = len(_extract_templates(zero_result.templates_json))
    print(f"Zero-shot: {zero_n} templates, {len(zero_result.templates_json)} chars")

    with dspy.context(lm=lm):
        few_result = few_shot(source_chapter=test_text)
    few_n = len(_extract_templates(few_result.templates_json))
    print(f"Few-shot:  {few_n} templates, {len(few_result.templates_json)} chars")

    # ── Step 4: Judge ──
    print(f"\n--- Judging (topic: {topic['tema']}) ---")

    print("\nZero-shot fragments:")
    zero_scores = await judge_output(client, zero_result.templates_json, topic)
    z_mean = sum(zero_scores) / len(zero_scores) if zero_scores else 0
    print(f"  Mean: {z_mean:.1f}/10")

    print("\nFew-shot fragments:")
    few_scores = await judge_output(client, few_result.templates_json, topic)
    f_mean = sum(few_scores) / len(few_scores) if few_scores else 0
    print(f"  Mean: {f_mean:.1f}/10")

    # ── Summary ──
    print(f"\n{'=' * 50}")
    print(f"Zero-shot:  {z_mean:.1f}/10 ({zero_n} templates)")
    print(f"Few-shot:   {f_mean:.1f}/10 ({few_n} templates)")
    print(f"Delta:      {f_mean - z_mean:+.1f}")
    if f_mean > z_mean:
        print("✅ Few-shot demos IMPROVE meta-prompt output.")
    elif f_mean < z_mean:
        print("⚠️  Few-shot demos DEGRADE output (possible overfitting).")
    else:
        print("➡️  No significant difference.")
    print(f"{'=' * 50}")


if __name__ == "__main__":
    asyncio.run(main())
