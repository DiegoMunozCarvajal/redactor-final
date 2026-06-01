"""Direct bootstrap + judge evaluation.

Simple approach: BootstrapFewShot to collect demos, then evaluate with judge.
No random search — just test whether few-shot demos improve meta-prompt quality.

Usage:
    uv run python3 scripts/run_bootstrap_direct.py
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

_project_dir = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_project_dir / "src"))

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

load_dotenv(_project_dir.parent / ".env")

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")

META_MODEL = "gpt-5.4"
FRAGMENT_MODEL = "deepseek-v4-pro"
JUDGE_MODEL = "gpt-5.4"

EVAL_TOPICS = TEST_TOPICS[:2]
MAX_TEMPLATES = 6


async def evaluate_program(
    deepseek: AsyncOpenAI,
    judge_client: AsyncOpenAI,
    program,
    chapters: dict[str, str],
    label: str,
) -> dict:
    """Evaluate a compiled DSPy program using the full 2-hop judge metric."""
    print(f"\n{'=' * 60}")
    print(f"EVALUATING: {label}")
    print(f"{'=' * 60}")

    lm = dspy.LM(f"openai/{META_MODEL}", api_key=OPENAI_API_KEY)

    all_scores = []
    chapter_results = []

    for chapter_key, chapter_text in chapters.items():
        print(f"\n--- {chapter_key} ({len(chapter_text)} chars) ---")

        with dspy.context(lm=lm):
            try:
                result = program(source_chapter=chapter_text)
            except Exception as e:
                print(f"  ERROR: {e}")
                continue

        templates = _extract_templates(result.templates_json)
        print(f"  Templates: {len(templates)}")

        # Filter real templates
        def _is_real(t):
            content = t.get("content", "")
            if len(content.strip()) < 200:
                return False
            name_lower = t.get("name", "").lower()
            if any(kw in name_lower for kw in ("fase", "diagnóstico", "diagnostico")):
                return False
            return True

        real_templates = [t for t in templates if _is_real(t)]
        templates_to_use = real_templates[:MAX_TEMPLATES]

        chapter_scores = []

        for template in templates_to_use:
            for topic in EVAL_TOPICS:
                try:
                    user_prompt = resolve_placeholders(
                        template.get("content", ""), topic
                    )
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

                    judge_prompt = _build_judge_user_prompt(
                        fragment,
                        template.get("content", ""),
                        topic.get("tema", ""),
                    )
                    response = await judge_client.chat.completions.create(
                        model=JUDGE_MODEL,
                        max_completion_tokens=1024,
                        messages=[
                            {"role": "system", "content": JUDGE_SYSTEM_PROMPT},
                            {"role": "user", "content": judge_prompt},
                        ],
                    )
                    raw = response.choices[0].message.content or ""
                    verdict = _parse_verdict(raw)
                    chapter_scores.append(verdict.overall)
                    print(
                        f"  [{verdict.overall}/10] {template.get('name', '?')[:50]} → {topic['tema'][:30]}"
                    )

                except Exception as e:
                    print(f"  [ERR] {template.get('name', '?')[:40]}: {e}")

        if chapter_scores:
            mean = sum(chapter_scores) / len(chapter_scores)
            all_scores.extend(chapter_scores)
            print(f"  Mean: {mean:.1f}/10 ({len(chapter_scores)} fragments)")
            chapter_results.append(
                {"chapter": chapter_key, "mean": mean, "n": len(chapter_scores)}
            )

    overall = sum(all_scores) / len(all_scores) if all_scores else 0
    print(f"\n  {label} OVERALL: {overall:.2f}/10")
    return {
        "label": label,
        "overall": overall,
        "chapters": chapter_results,
        "scores": all_scores,
    }


async def main():
    chapters = load_chapters()
    print(f"Loaded {len(chapters)} chapters: {list(chapters.keys())}")

    # Split: last chapter for val, rest for train
    chapter_keys = list(chapters.keys())
    train_keys = chapter_keys[:-1]
    val_keys = [chapter_keys[-1]]
    train_chapters = {k: chapters[k] for k in train_keys}
    val_chapters = {k: chapters[k] for k in val_keys}
    print(f"Train: {train_keys}, Val: {val_keys}")

    # Build datasets
    train_dataset = [
        dspy.Example(source_chapter=chapters[k]).with_inputs("source_chapter")
        for k in train_keys
    ]
    val_dataset = [
        dspy.Example(source_chapter=chapters[k]).with_inputs("source_chapter")
        for k in val_keys
    ]

    # Configure LM
    lm = dspy.LM(f"openai/{META_MODEL}", api_key=OPENAI_API_KEY)
    dspy.configure(lm=lm)

    # ── Baseline: zero-shot (no demos) ──
    print(f"\n{'=' * 60}")
    print("BASELINE: Zero-shot (original META_PROMPT, no demos)")
    print(f"{'=' * 60}")
    baseline_program = MetaPromptGenerator()

    # ── Optimized: BootstrapFewShot with demos ──
    print(f"\n{'=' * 60}")
    print("BOOTSTRAP: Collecting few-shot demos")
    print(f"{'=' * 60}")

    bootstrap = dspy.BootstrapFewShot(
        metric=fast_metric,
        metric_threshold=0.5,
        max_bootstrapped_demos=3,
        max_labeled_demos=2,
        max_rounds=1,
        max_errors=5,
    )

    bootstrapped_program = bootstrap.compile(
        baseline_program,
        trainset=train_dataset,
    )

    # Show demos
    for i, predictor in enumerate(bootstrapped_program.predictors()):
        demos = getattr(predictor, "demos", [])
        print(f"Predictor {i}: {len(demos)} demos collected")
        for j, demo in enumerate(demos):
            ch_len = len(getattr(demo, "source_chapter", ""))
            out_len = len(getattr(demo, "templates_json", ""))
            print(f"  Demo {j}: chapter={ch_len} chars, output={out_len} chars")

    # ── Evaluate both ──
    deepseek = AsyncOpenAI(
        api_key=DEEPSEEK_API_KEY, base_url="https://api.deepseek.com"
    )
    judge_client = AsyncOpenAI(api_key=OPENAI_API_KEY)

    # Use all chapters for evaluation (consistent with baseline)
    all_chapters = chapters

    baseline_result = await evaluate_program(
        deepseek, judge_client, baseline_program, all_chapters, "BASELINE (zero-shot)"
    )
    bootstrapped_result = await evaluate_program(
        deepseek,
        judge_client,
        bootstrapped_program,
        all_chapters,
        "BOOTSTRAPPED (3-demo)",
    )

    # ── Summary ──
    print(f"\n{'=' * 60}")
    print("SUMMARY")
    print(f"{'=' * 60}")
    print(f"Baseline:     {baseline_result['overall']:.2f}/10")
    print(f"Bootstrapped: {bootstrapped_result['overall']:.2f}/10")
    delta = bootstrapped_result["overall"] - baseline_result["overall"]
    print(f"Delta:        {delta:+.2f}/10")

    # Save
    results = {
        "baseline": baseline_result,
        "bootstrapped": bootstrapped_result,
        "delta": delta,
        "demos_count": len(bootstrapped_program.predictors()[0].demos),
    }
    out_path = _project_dir / "bootstrap_direct_results.json"
    out_path.write_text(json.dumps(results, indent=2, ensure_ascii=False))
    print(f"\nSaved to {out_path}")


if __name__ == "__main__":
    asyncio.run(main())
