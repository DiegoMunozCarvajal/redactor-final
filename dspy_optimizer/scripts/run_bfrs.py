"""BootstrapFewShotWithRandomSearch: optimize few-shot demos for the meta-prompt.

Uses a fast structural metric during bootstrapping (no API calls for validation).
The full judge metric is used only for final evaluation.

Strategy:
  - Structural metric → bootstrap collects traces with well-formed output
  - These traces become few-shot examples showing the LM how to structure templates
  - The meta-prompt instruction (META_PROMPT) remains unchanged
  - Final evaluation with full judge metric to measure real improvement

Usage:
    uv run python3 scripts/run_bfrs.py [--num-candidates 10] [--max-demos 3]
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

# Add src to path
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
    build_meta_prompt_user,
    parse_meta_prompt_output,
    resolve_placeholders,
)
from dspy_optimizer.judge import (
    JUDGE_SYSTEM_PROMPT,
    _parse_verdict,
    _build_judge_user_prompt,
)
from dspy_optimizer.fast_metric import fast_metric, structural_metric_score
from dspy_optimizer.dspy_meta_optimizer import MetaPromptGenerator, _extract_templates

# Load env
load_dotenv(_project_dir.parent / ".env")

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")

# Models
META_MODEL = "gpt-5.4"
FRAGMENT_MODEL = "deepseek-v4-pro"
JUDGE_MODEL = "gpt-5.4"

# Evaluation settings
EVAL_TEMPLATES_PER_CHAPTER = 6
EVAL_TOPICS = TEST_TOPICS[:2]  # 2 topics for evaluation


def build_chapter_dataset(chapters: dict[str, str]) -> list[dspy.Example]:
    """Build dataset for DSPy optimization from source chapters."""
    return [
        dspy.Example(source_chapter=text).with_inputs("source_chapter")
        for text in chapters.values()
    ]


# ── Final evaluation (full judge metric) ──────────────────────────


async def evaluate_with_judge(
    openai_client: AsyncOpenAI,
    deepseek: AsyncOpenAI,
    judge_client: AsyncOpenAI,
    program,
    chapters: dict[str, str],
) -> dict:
    """Evaluate optimized program using the full 2-hop judge metric."""
    print("\n" + "=" * 60)
    print("FINAL EVALUATION (Full Judge Metric)")
    print("=" * 60)

    all_results = []
    all_scores = []

    for chapter_key, chapter_text in chapters.items():
        print(f"\n--- {chapter_key} ({len(chapter_text)} chars) ---")

        # Run optimized program
        try:
            with dspy.context(
                lm=dspy.LM(f"openai/{META_MODEL}", api_key=OPENAI_API_KEY)
            ):
                result = program(source_chapter=chapter_text)
        except Exception as e:
            print(f"  ERROR running program: {e}")
            continue

        raw_output = result.templates_json
        templates = _extract_templates(raw_output)
        print(f"  Templates: {len(templates)}")

        # Filter real templates
        def _is_real(t):
            if len(t.get("content", "").strip()) < 200:
                return False
            if "{" not in t.get("content", "") and "{" not in t.get("name", ""):
                return False
            name_lower = t.get("name", "").lower()
            if any(kw in name_lower for kw in ("fase", "diagnóstico", "diagnostico")):
                return False
            return True

        real_templates = [t for t in templates if _is_real(t)]
        templates_to_use = real_templates[:EVAL_TEMPLATES_PER_CHAPTER]

        chapter_scores = []

        for template in templates_to_use:
            for topic in EVAL_TOPICS:
                try:
                    # Generate fragment
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

                    # Judge
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
            print(f"  Chapter mean: {mean:.1f}/10 ({len(chapter_scores)} fragments)")
            all_results.append(
                {"chapter": chapter_key, "mean": mean, "n": len(chapter_scores)}
            )

    overall = sum(all_scores) / len(all_scores) if all_scores else 0
    print(f"\n{'=' * 60}")
    print(f"OVERALL: {overall:.2f}/10")
    print(f"{'=' * 60}")

    return {
        "overall": overall,
        "chapters": all_results,
        "all_scores": all_scores,
    }


# ── Main ───────────────────────────────────────────────────────────


def main(num_candidates: int = 10, max_demos: int = 3):
    print("=" * 60)
    print("BootstrapFewShotWithRandomSearch — Meta-Prompt Optimization")
    print(f"Candidates: {num_candidates}, Max demos: {max_demos}")
    print("=" * 60)

    # Load data
    chapters = load_chapters()
    print(f"\nLoaded {len(chapters)} source chapters: {list(chapters.keys())}")

    # Build dataset — use all chapters for both train and val (small dataset)
    dataset = build_chapter_dataset(chapters)
    print(f"Dataset: {len(dataset)} examples (using all for train + val)")

    # Configure DSPy LM
    lm = dspy.LM(f"openai/{META_MODEL}", api_key=OPENAI_API_KEY)
    dspy.configure(lm=lm)

    # Create the module (keeps original META_PROMPT instruction)
    module = MetaPromptGenerator()

    # ── Step 1: Bootstrap Few-Shot Examples ──
    print(f"\n{'=' * 60}")
    print("STEP 1: Bootstrapping few-shot examples with structural metric")
    print(f"{'=' * 60}")

    optimizer = dspy.BootstrapFewShotWithRandomSearch(
        metric=fast_metric,
        max_bootstrapped_demos=max_demos,
        max_labeled_demos=2,
        num_candidate_programs=num_candidates,
        num_threads=1,  # API calls are sequential
        max_errors=5,
        metric_threshold=0.5,  # Structural score >= 0.5 passes
    )

    print(f"  Metric: fast_metric (structural, no API calls)")
    print(f"  Threshold: 0.5")
    print(f"  Max bootstrapped demos: {max_demos}")
    print(f"  Candidate programs: {num_candidates}")
    print()

    optimized = optimizer.compile(
        module,
        trainset=dataset,
        valset=dataset,  # Same set for small dataset
    )

    # ── Step 2: Show what we got ──
    print(f"\n{'=' * 60}")
    print("OPTIMIZATION COMPLETE")
    print(f"{'=' * 60}")

    # Check demos collected
    for i, predictor in enumerate(optimized.predictors()):
        demos = getattr(predictor, "demos", [])
        print(f"\nPredictor {i}: {len(demos)} few-shot demos")
        for j, demo in enumerate(demos):
            ch_len = len(getattr(demo, "source_chapter", ""))
            out_len = len(getattr(demo, "templates_json", ""))
            print(
                f"  Demo {j}: source_chapter={ch_len} chars, templates_json={out_len} chars"
            )

    # Show candidate program scores
    if hasattr(optimized, "candidate_programs"):
        print(f"\nTop candidate programs:")
        for cp in optimized.candidate_programs[:5]:
            print(f"  seed={cp['seed']}: score={cp['score']:.3f}")

    # Save optimized module
    out_path = _project_dir / "bfrs_optimized_module.json"
    try:
        optimized.save(str(out_path))
        print(f"\nSaved optimized module to {out_path}")
    except Exception as e:
        print(f"Could not save module: {e}")

    # ── Step 3: Final evaluation with judge ──
    print(f"\n{'=' * 60}")
    print("STEP 2: Final evaluation with full judge metric")
    print(f"{'=' * 60}")

    openai_client = AsyncOpenAI(api_key=OPENAI_API_KEY)
    deepseek = AsyncOpenAI(
        api_key=DEEPSEEK_API_KEY, base_url="https://api.deepseek.com"
    )
    judge_client = AsyncOpenAI(api_key=OPENAI_API_KEY)

    result = asyncio.run(
        evaluate_with_judge(openai_client, deepseek, judge_client, optimized, chapters)
    )

    # Save final results
    results_path = _project_dir / "bfrs_results.json"
    results_path.write_text(json.dumps(result, indent=2, ensure_ascii=False))
    print(f"\nSaved results to {results_path}")

    return optimized, result


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--num-candidates", type=int, default=10)
    parser.add_argument("--max-demos", type=int, default=3)
    args = parser.parse_args()
    main(num_candidates=args.num_candidates, max_demos=args.max_demos)
