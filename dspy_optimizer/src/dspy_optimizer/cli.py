"""CLI entry point for the DSPy optimizer.

Commands:
    calibrate  Evaluate existing fragments to calibrate the judge
    optimize   Run DSPy optimization on a prompt
    evaluate   A/B compare original vs optimized prompt
    export     Write optimized prompt back to DB
    status     Show optimization status for all prompts in a template
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from uuid import UUID

import click
from rich.console import Console
from rich.table import Table

console = Console()


@click.group()
def main():
    """DSPy + MIPROv2 prompt optimization for redactor-v4."""


# ── calibrate ────────────────────────────────────────────────────


@main.command()
@click.option(
    "--prompt-id", required=True, help="Prompt UUID to evaluate fragments for"
)
@click.option("--limit", default=20, help="Number of fragments to evaluate")
@click.option("--output", default=None, help="Save verdicts to JSON file")
def calibrate(prompt_id: str, limit: int, output: str | None):
    """Evaluate fragments for a prompt and output calibration data."""
    from dspy_optimizer.db import fetch_fragments_for_prompt, fetch_prompt
    from dspy_optimizer.judge import evaluate_fragments_batch

    async def _run():
        pid = UUID(prompt_id)
        prompt = await fetch_prompt(pid)
        if prompt is None:
            console.print(f"[red]Prompt {prompt_id} not found[/red]")
            return

        fragments = await fetch_fragments_for_prompt(pid, limit)
        if not fragments:
            console.print(f"[yellow]No fragments found for prompt {prompt_id}[/yellow]")
            return

        console.print(f"Evaluating {len(fragments)} fragments...")

        # We need (text, instruction, topic) tuples. Topic comes from the prompt title.
        batch = [(f.content, prompt.content, prompt.title) for f in fragments]

        verdicts = await evaluate_fragments_batch(batch)

        table = Table(title=f"Calibration results for prompt {prompt.title}")
        table.add_column("Fragment", style="cyan")
        table.add_column("Clarity")
        table.add_column("Accuracy")
        table.add_column("Cohesion")
        table.add_column("Engagement")
        table.add_column("Completeness")
        table.add_column("Overall", style="bold")

        for i, (frag, v) in enumerate(zip(fragments, verdicts)):
            table.add_row(
                frag.id.hex[:8],
                str(v.clarity),
                str(v.accuracy),
                str(v.cohesion),
                str(v.engagement),
                str(v.completeness),
                str(v.overall),
            )

        console.print(table)

        # Summary stats
        avg = sum(v.overall for v in verdicts) / len(verdicts)
        console.print(f"\n[bold]Average score: {avg:.1f}/10[/bold]")
        console.print(f"High (8-10): {sum(1 for v in verdicts if v.overall >= 8)}")
        console.print(f"Mid (5-7): {sum(1 for v in verdicts if 5 <= v.overall < 8)}")
        console.print(f"Low (1-4): {sum(1 for v in verdicts if v.overall < 5)}")

        if output:
            import json

            results = [
                {
                    "fragment_id": str(f.id),
                    "verdict": {
                        "clarity": v.clarity,
                        "accuracy": v.accuracy,
                        "cohesion": v.cohesion,
                        "engagement": v.engagement,
                        "completeness": v.completeness,
                        "overall": v.overall,
                        "issues": v.issues,
                    },
                }
                for f, v in zip(fragments, verdicts)
            ]
            Path(output).write_text(json.dumps(results, indent=2, ensure_ascii=False))
            console.print(f"[green]Results saved to {output}[/green]")

    asyncio.run(_run())


# ── optimize ─────────────────────────────────────────────────────


@main.command()
@click.option("--prompt-id", required=True, help="Prompt UUID to optimize")
@click.option(
    "--auto-mode", default="light", type=click.Choice(["light", "medium", "heavy"])
)
@click.option("--dry-run", is_flag=True, help="Run without writing to DB")
def optimize(prompt_id: str, auto_mode: str, dry_run: bool):
    """Run DSPy optimization on a single prompt."""
    console.print(
        f"[bold]Optimizing prompt {prompt_id} with MIPROv2 auto={auto_mode}[/bold]"
    )
    console.print("[yellow]Not yet implemented — see Milestone 3[/yellow]")


# ── evaluate ─────────────────────────────────────────────────────


@main.command()
@click.option("--prompt-id", required=True, help="Prompt UUID to evaluate")
@click.option("--num-samples", default=5, help="Number of test topics to generate")
def evaluate(prompt_id: str, num_samples: int):
    """A/B test: original vs optimized prompt."""
    console.print(f"[bold]A/B evaluating prompt {prompt_id}[/bold]")
    console.print("[yellow]Not yet implemented — see Milestone 3[/yellow]")


# ── export ───────────────────────────────────────────────────────


@main.command()
@click.option("--prompt-id", required=True, help="Prompt UUID")
@click.option("--optimized-file", required=True, help="JSON file with optimized prompt")
def export(prompt_id: str, optimized_file: str):
    """Write an optimized prompt from a JSON file to the DB."""
    console.print(f"[bold]Exporting optimized prompt {prompt_id}[/bold]")
    console.print("[yellow]Not yet implemented — see Milestone 3[/yellow]")


# ── status ───────────────────────────────────────────────────────


@main.command()
@click.option("--template-id", required=True, help="Book template UUID")
def status(template_id: str):
    """Show optimization status for all prompts in a template."""
    from dspy_optimizer.db import fetch_template_prompts

    async def _run():
        tid = UUID(template_id)
        prompts = await fetch_template_prompts(tid)

        table = Table(
            title=f"Prompt optimization status for template {template_id[:8]}"
        )
        table.add_column("Prompt", style="cyan")
        table.add_column("Type")
        table.add_column("Optimized", style="green")
        table.add_column("Score")
        table.add_column("Optimized At")

        for p in prompts:
            ptype = "assembly" if p.is_assembly else "content"
            optimized = "✓" if p.optimized_content else "—"
            score = f"{p.optimization_score:.1f}" if p.optimization_score else "—"
            table.add_row(p.title, ptype, optimized, score, "—")

        console.print(table)

    asyncio.run(_run())


if __name__ == "__main__":
    main()
