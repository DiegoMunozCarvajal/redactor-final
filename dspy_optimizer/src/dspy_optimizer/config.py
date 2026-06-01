"""Configuration from environment variables."""

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

# Load from project root .env (redactor-v4/.env)
_project_root = Path(__file__).resolve().parents[3]
_env_file = _project_root / ".env"
if _env_file.exists():
    load_dotenv(_env_file)


@dataclass
class Config:
    # ── Database ──────────────────────────────────────────────
    database_url: str = field(default_factory=lambda: os.environ["DATABASE_URL"])

    # ── API Keys ──────────────────────────────────────────────
    anthropic_api_key: str = field(
        default_factory=lambda: os.environ["ANTHROPIC_API_KEY"]
    )
    openai_api_key: str = field(
        default_factory=lambda: os.environ.get("OPENAI_API_KEY", "")
    )
    deepseek_api_key: str = field(
        default_factory=lambda: os.environ.get("DEEPSEEK_API_KEY", "")
    )

    # ── Judge model (evaluates output quality) ────────────────
    # Claude Opus 4.7 — best for Spanish prose evaluation
    judge_model: str = "anthropic/claude-opus-4-7"

    # ── Task model (the model being optimized) ────────────────
    # Default matches redactor-v4 DEFAULT_GENERATION_MODEL
    task_model: str = "deepseek/deepseek-v4-flash"

    # ── Prompt model (proposes new instructions in MIPROv2) ───
    prompt_model: str = "anthropic/claude-opus-4-7"

    # ── Budget ────────────────────────────────────────────────
    max_optimization_cost_usd: float = 5.0

    # ── MIPROv2 preset ────────────────────────────────────────
    auto_mode: str = "light"  # light | medium | heavy

    # ── Paths ─────────────────────────────────────────────────
    @property
    def project_root(self) -> Path:
        return _project_root


cfg = Config()
