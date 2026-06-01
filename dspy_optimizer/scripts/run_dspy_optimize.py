"""Run DSPy + MIPROv2 optimization on the meta-prompt.

Usage:
    uv run python3 scripts/run_dspy_optimize.py [--auto light|medium|heavy]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import dspy
from dspy_optimizer.dspy_meta_optimizer import (
    build_dataset,
    optimize_meta_prompt,
    extract_instruction,
    load_chapters,
)


def main(auto_mode: str = "light"):
    print("=" * 60)
    print(f"DSPy + MIPROv2 Meta-Prompt Optimization")
    print(f"Auto mode: {auto_mode}")
    print("=" * 60)

    # Load chapters
    chapters = load_chapters()
    print(f"\nLoaded {len(chapters)} source chapters")

    # Build dataset
    trainset, valset = build_dataset(chapters)
    print(f"Trainset: {len(trainset)}, Valset: {len(valset)}")

    # Run optimization
    optimized = optimize_meta_prompt(
        trainset=trainset,
        valset=valset,
        auto_mode=auto_mode,
    )

    # Extract optimized instruction
    instruction = extract_instruction(optimized)
    print(f"\n{'=' * 60}")
    print(f"OPTIMIZED INSTRUCTION ({len(instruction)} chars):")
    print(f"{'=' * 60}")
    print(instruction[:2000])
    if len(instruction) > 2000:
        print(f"... ({len(instruction) - 2000} more chars)")

    # Save
    out = {
        "optimized_instruction": instruction,
        "auto_mode": auto_mode,
    }
    output_path = Path(__file__).resolve().parent.parent / "optimized_meta_prompt.json"
    output_path.write_text(json.dumps(out, indent=2, ensure_ascii=False))
    print(f"\nSaved to {output_path}")

    # Also save the full optimized module
    try:
        optimized.save(
            str(Path(__file__).resolve().parent.parent / "optimized_module.json")
        )
        print("Saved optimized module to optimized_module.json")
    except Exception as e:
        print(f"Could not save module: {e}")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "light"
    main(mode)
