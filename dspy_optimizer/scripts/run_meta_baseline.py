"""Baseline evaluation of the current meta-prompt.

For each source chapter:
1. Run meta-prompt → get prompt templates
2. For first 3 templates + 1 test topic → generate fragments
3. Judge fragments
4. Report scores per chapter

Models:
- Meta-prompt + fragment generation: DeepSeek V4 Pro (matches pipeline default)
- Judge: Claude Opus 4.7 (best for Spanish prose evaluation)
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

import anthropic
from openai import AsyncOpenAI

# Add src to path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from dspy_optimizer.meta_prompt import (
    META_PROMPT,
    FRAGMENT_SYSTEM_PROMPT,
    TEST_TOPICS,
    PromptTemplate,
    build_meta_prompt_user,
    load_chapters,
    parse_meta_prompt_output,
    resolve_placeholders,
)
from dspy_optimizer.judge import evaluate_fragment

# Load .env from project root
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[3] / ".env")

# API keys
ANTHROPIC_API_KEY = "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"
DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = "https://api.deepseek.com"
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")

# Models
META_MODEL = "gpt-5.4"  # OpenAI GPT-5.4 for meta-prompt
FRAGMENT_MODEL = "deepseek-v4-pro"  # DeepSeek for fragment generation
JUDGE_MODEL = "gpt-5.4"  # OpenAI GPT-5.4 for judging (replaces Claude Opus)

# Use only first 2 topics for baseline (keep costs manageable)
BASELINE_TOPICS = TEST_TOPICS[:2]
# Evaluate first 6 templates per chapter (meta-prompt now targets 6-12)
MAX_TEMPLATES = 6


async def run_meta_prompt(
    openai_client: AsyncOpenAI,
    source_chapter: str,
) -> str:
    """Execute the meta-prompt against a source chapter using OpenAI."""
    response = await openai_client.chat.completions.create(
        model=META_MODEL,
        max_completion_tokens=8192,
        messages=[
            {"role": "system", "content": META_PROMPT},
            {"role": "user", "content": build_meta_prompt_user(source_chapter)},
        ],
    )
    return response.choices[0].message.content or ""


async def generate_fragment(
    deepseek: AsyncOpenAI,
    template: PromptTemplate,
    topic_overrides: dict[str, str],
) -> str:
    """Generate a fragment from a prompt template using DeepSeek."""
    user_prompt = resolve_placeholders(template.content, topic_overrides)

    response = await deepseek.chat.completions.create(
        model=FRAGMENT_MODEL,
        max_tokens=2048,
        temperature=0.7,
        messages=[
            {"role": "system", "content": FRAGMENT_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
    )
    return response.choices[0].message.content or ""


async def evaluate_chapter(
    openai_client: AsyncOpenAI,
    deepseek: AsyncOpenAI,
    judge_client: AsyncOpenAI,
    chapter_key: str,
    chapter_text: str,
) -> dict:
    """Run full evaluation for one source chapter."""
    print(f"\n{'=' * 60}")
    print(f"Processing {chapter_key} ({len(chapter_text)} chars)")
    print(f"{'=' * 60}")

    # Step 1: Run meta-prompt
    print("  [1/3] Running meta-prompt...")
    raw_output = await run_meta_prompt(openai_client, chapter_text)
    print(f"        Output: {len(raw_output)} chars")

    # Step 2: Parse templates
    print("  [2/3] Parsing templates...")
    parsed = parse_meta_prompt_output(raw_output)
    print(f"        Found {len(parsed.templates)} prompt templates")

    if not parsed.templates:
        print("  ⚠ No templates extracted — saving raw output for inspection")
        return {
            "chapter": chapter_key,
            "raw_output": raw_output[:5000],
            "templates_found": 0,
            "fragments": [],
            "scores": [],
            "mean_score": 0,
            "error": "No templates parsed",
        }

    # Show templates found
    for t in parsed.templates:
        print(
            f"        - {t.name[:60]} | {len(t.placeholders)} placeholders | {len(t.content)} chars"
        )

    # Step 3: Generate + judge fragments
    # Filter out non-template blocks: diagnosis, phase headers, audit sections
    def _is_real_template(t):
        name_lower = t.name.lower()
        content_lower = t.content.lower()
        # Skip phase headers and diagnostic blocks
        if any(
            kw in name_lower
            for kw in ("fase", "diagnóstico", "diagnostico", "auditoría", "auditoria")
        ):
            return False
        # Skip blocks whose content is clearly diagnostic (not a prompt)
        if any(
            kw in content_lower[:500]
            for kw in (
                "tesis o propósito",
                "tipo de texto:",
                "secuencia argumental",
                "patrón de apertura",
                "riesgos de pérdida",
            )
        ):
            return False
        # Must have reasonable content
        if len(t.content.strip()) < 200:
            return False
        # Must contain placeholders or look like a prompt (have instructions)
        if (
            "{" not in t.content
            and "escribe" not in content_lower[:300]
            and "redacta" not in content_lower[:300]
        ):
            return False
        return True

    real_templates = [t for t in parsed.templates if _is_real_template(t)]
    print(
        f"        Real templates: {len(real_templates)} (filtered from {len(parsed.templates)})"
    )
    print(
        f"  [3/3] Generating fragments (first {MAX_TEMPLATES} templates x {len(BASELINE_TOPICS)} topics)..."
    )
    results = []
    templates_to_use = real_templates[:MAX_TEMPLATES]

    for template in templates_to_use:
        for topic in BASELINE_TOPICS:
            topic_name = topic["tema"]
            try:
                fragment = await generate_fragment(deepseek, template, topic)
                verdict = await evaluate_fragment(
                    generated_text=fragment,
                    instruction=template.content,
                    topic=topic_name,
                    openai_client=judge_client,
                    judge_model=JUDGE_MODEL,
                )
                results.append(
                    {
                        "template": template.name,
                        "topic": topic_name,
                        "fragment_chars": len(fragment),
                        "score": verdict.overall,
                        "issues": verdict.issues,
                    }
                )
                print(
                    f"        [{verdict.overall}/10] {template.name[:40]} → {topic_name[:30]}"
                )
            except Exception as e:
                print(f"        [ERR] {template.name[:40]}: {e}")
                results.append(
                    {
                        "template": template.name,
                        "topic": topic_name,
                        "error": str(e),
                        "score": 0,
                    }
                )

    scores = [r["score"] for r in results if "score" in r]
    mean_score = sum(scores) / len(scores) if scores else 0

    # Composite score: quality * count penalty
    real_count = len(real_templates)
    if real_count < 6:
        count_penalty = 0.7  # Too few prompts = incomplete architecture
    elif real_count > 12:
        count_penalty = 0.7  # Too many prompts = over-fragmentation
    else:
        count_penalty = 1.0  # Sweet spot

    composite_score = mean_score * count_penalty

    print(
        f"\n  → Mean score: {mean_score:.1f}/10 | Templates: {real_count} | Penalty: {count_penalty} | Composite: {composite_score:.1f}/10"
    )

    return {
        "chapter": chapter_key,
        "templates_found": len(parsed.templates),
        "templates_real": real_count,
        "templates_used": len(templates_to_use),
        "count_penalty": count_penalty,
        "fragments": results,
        "scores": scores,
        "mean_score": mean_score,
        "composite_score": composite_score,
    }


async def main():
    openai_client = AsyncOpenAI(api_key=OPENAI_API_KEY)
    deepseek = AsyncOpenAI(api_key=DEEPSEEK_API_KEY, base_url=DEEPSEEK_BASE_URL)
    judge_client = AsyncOpenAI(api_key=OPENAI_API_KEY)  # OpenAI for judging too

    chapters = load_chapters()
    if not chapters:
        print("ERROR: No chapters found in data/ directory")
        return

    # Use all 5 chapters for baseline
    selected = chapters

    print(f"Loaded {len(selected)} chapters: {list(selected.keys())}")
    print(f"Test topics: {[t['tema'] for t in BASELINE_TOPICS]}")
    print(f"Meta model: {META_MODEL}")
    print(f"Fragment model: {FRAGMENT_MODEL}")
    print(f"Judge model: claude-opus-4-7")

    all_results = []
    for key, text in selected.items():
        result = await evaluate_chapter(
            openai_client, deepseek, judge_client, key, text
        )
        all_results.append(result)

    # Summary
    print(f"\n{'=' * 60}")
    print("BASELINE SUMMARY")
    print(f"{'=' * 60}")
    for r in all_results:
        print(
            f"  {r['chapter']}: {r['mean_score']:.1f}/10 ({r['templates_found']} templates, {len(r.get('scores', []))} fragments)"
        )

    overall = (
        sum(r["mean_score"] for r in all_results) / len(all_results)
        if all_results
        else 0
    )
    overall_composite = (
        sum(r["composite_score"] for r in all_results) / len(all_results)
        if all_results
        else 0
    )
    print(
        f"\n  OVERALL BASELINE: {overall:.1f}/10 (composite: {overall_composite:.1f}/10)"
    )

    for r in all_results:
        print(
            f"  {r['chapter']}: {r['mean_score']:.1f}/10 | {r['templates_real']} templates | penalty={r['count_penalty']} | composite={r['composite_score']:.1f}"
        )

    # Save
    output_path = Path(__file__).resolve().parent.parent / "meta_baseline.json"
    output_path.write_text(
        json.dumps(
            {
                "overall_mean": overall,
                "results": all_results,
            },
            indent=2,
            ensure_ascii=False,
        )
    )
    print(f"\nSaved to {output_path}")


if __name__ == "__main__":
    asyncio.run(main())
