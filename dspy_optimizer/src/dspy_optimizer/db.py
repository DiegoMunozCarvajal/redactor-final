"""PostgreSQL client for reading prompts, fragments, and writing results."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Sequence
from uuid import UUID

import asyncpg

from dspy_optimizer.config import cfg


@dataclass
class PromptRecord:
    """A prompt row from the DB (prompts or project_prompts table)."""

    id: UUID
    chapter_id: UUID
    position: int
    is_assembly: bool
    title: str
    content: str
    optimized_content: str | None
    optimization_score: float | None

    # Style context from parent chapter/template
    style_rules: str | None = None
    knowledge_areas: str | None = None
    suggested_length: str | None = None


@dataclass
class FragmentRecord:
    """A generated fragment from the DB."""

    id: UUID
    chapter_generation_id: UUID
    prompt_id: UUID
    content: str
    created_at: datetime


@dataclass
class EvaluationRecord:
    """Evaluation result to write back."""

    prompt_id: UUID
    prompt_source: str  # 'template' | 'project'
    fragment_id: UUID | None
    judge_model: str
    clarity: int
    accuracy: int
    engagement: int
    cohesion: int
    completeness: int
    overall: int
    issues: list[str]


_pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool:
    """Lazily create and return the connection pool."""
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            cfg.database_url,
            min_size=2,
            max_size=4,
            statement_cache_size=0,  # Disable for Supabase pooler compatibility
        )
    return _pool


async def close_pool() -> None:
    """Close the connection pool."""
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


# ── Read queries ────────────────────────────────────────────────


async def fetch_template_prompts(book_template_id: UUID) -> list[PromptRecord]:
    """Fetch all prompts for a book template, ordered by chapter + position."""
    pool = await get_pool()
    try:
        rows = await pool.fetch(
            """
            SELECT
                p.id, p.chapter_id, p.position, p.is_assembly, p.title, p.content,
                p.optimized_content, p.optimization_score,
                NULL::text AS style_rules, NULL::text AS knowledge_areas, NULL::text AS suggested_length
            FROM prompts p
            JOIN chapters c ON c.id = p.chapter_id
            WHERE c.book_template_id = $1
            ORDER BY c.position, p.position
            """,
            book_template_id,
        )
    except Exception:
        rows = await pool.fetch(
            """
            SELECT
                p.id, p.chapter_id, p.position, p.is_assembly, p.title, p.content,
                NULL::text AS optimized_content, NULL::float8 AS optimization_score,
                NULL::text AS style_rules, NULL::text AS knowledge_areas, NULL::text AS suggested_length
            FROM prompts p
            JOIN chapters c ON c.id = p.chapter_id
            WHERE c.book_template_id = $1
            ORDER BY c.position, p.position
            """,
            book_template_id,
        )
    return [_row_to_prompt(r) for r in rows]


async def fetch_project_prompts(project_id: UUID) -> list[PromptRecord]:
    """Fetch all project-scoped prompts for a project."""
    pool = await get_pool()
    try:
        rows = await pool.fetch(
            """
            SELECT
                pp.id, pp.chapter_id, pp.position, pp.is_assembly, pp.title, pp.content,
                pp.optimized_content, pp.optimization_score,
                NULL::text AS style_rules, NULL::text AS knowledge_areas, NULL::text AS suggested_length
            FROM project_prompts pp
            JOIN chapters c ON c.id = pp.chapter_id
            WHERE c.project_id = $1
            ORDER BY c.position, pp.position
            """,
            project_id,
        )
    except Exception:
        rows = await pool.fetch(
            """
            SELECT
                pp.id, pp.chapter_id, pp.position, pp.is_assembly, pp.title, pp.content,
                NULL::text AS optimized_content, NULL::float8 AS optimization_score,
                NULL::text AS style_rules, NULL::text AS knowledge_areas, NULL::text AS suggested_length
            FROM project_prompts pp
            JOIN chapters c ON c.id = pp.chapter_id
            WHERE c.project_id = $1
            ORDER BY c.position, pp.position
            """,
            project_id,
        )
    return [_row_to_prompt(r) for r in rows]


async def fetch_prompt(prompt_id: UUID) -> PromptRecord | None:
    """Fetch a single prompt by ID (checks both tables)."""
    pool = await get_pool()
    # Use a try/except to handle tables that may not have optimized_* columns yet
    row = await _fetch_prompt_impl(pool, prompt_id)
    return _row_to_prompt(row) if row else None


async def _fetch_prompt_impl(pool, prompt_id: UUID):
    """Internal: tries full schema, falls back to minimal columns."""
    for table in ("prompts", "project_prompts"):
        try:
            row = await pool.fetchrow(
                f"""
                SELECT
                    id, chapter_id, position, is_assembly, title, content,
                    optimized_content, optimization_score,
                    NULL::text AS style_rules,
                    NULL::text AS knowledge_areas,
                    NULL::text AS suggested_length
                FROM {table}
                WHERE id = $1
                """,
                prompt_id,
            )
            if row:
                return row
        except Exception:
            # Column likely missing — fall back to minimal columns
            row = await pool.fetchrow(
                f"""
                SELECT
                    id, chapter_id, position, is_assembly, title, content,
                    NULL::text AS optimized_content,
                    NULL::float8 AS optimization_score,
                    NULL::text AS style_rules,
                    NULL::text AS knowledge_areas,
                    NULL::text AS suggested_length
                FROM {table}
                WHERE id = $1
                """,
                prompt_id,
            )
            if row:
                return row
    return None


async def fetch_fragments_for_prompt(
    prompt_id: UUID,
    limit: int = 100,
) -> list[FragmentRecord]:
    """Fetch generated fragments for a specific prompt, most recent first."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT f.id, f.chapter_generation_id, f.prompt_id, f.content, f.created_at
        FROM fragments f
        WHERE f.prompt_id = $1
        ORDER BY f.created_at DESC
        LIMIT $2
        """,
        prompt_id,
        limit,
    )
    return [
        FragmentRecord(
            id=r["id"],
            chapter_generation_id=r["chapter_generation_id"],
            prompt_id=r["prompt_id"],
            content=r["content"],
            created_at=r["created_at"],
        )
        for r in rows
    ]


async def fetch_project_topic(project_id: UUID) -> str | None:
    """Fetch the topic of a project."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT topic FROM projects WHERE id = $1",
        project_id,
    )
    return row["topic"] if row else None


# ── Write queries ───────────────────────────────────────────────


async def upsert_optimized_prompt(
    prompt_id: UUID,
    table: str,  # 'prompts' or 'project_prompts'
    optimized_content: str,
    score: float,
    model: str,
    config_snapshot: dict,
) -> None:
    """Write optimized content back to the prompt row."""
    pool = await get_pool()
    await pool.execute(
        f"""
        UPDATE {table}
        SET
            optimized_content = $2,
            optimized_at = $3,
            optimization_score = $4,
            optimization_model = $5,
            optimization_config = $6
        WHERE id = $1
        """,
        prompt_id,
        optimized_content,
        datetime.now(timezone.utc),
        score,
        model,
        config_snapshot,
    )


async def insert_evaluation(ev: EvaluationRecord) -> None:
    """Insert a judge evaluation row."""
    pool = await get_pool()
    await pool.execute(
        """
        INSERT INTO prompt_evaluations
            (prompt_id, prompt_source, fragment_id, judge_model,
             clarity, accuracy, engagement, cohesion, completeness,
             overall, issues)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        """,
        ev.prompt_id,
        ev.prompt_source,
        ev.fragment_id,
        ev.judge_model,
        ev.clarity,
        ev.accuracy,
        ev.engagement,
        ev.cohesion,
        ev.completeness,
        ev.overall,
        ev.issues,
    )


async def clear_optimization(prompt_id: UUID, table: str) -> None:
    """Remove optimized content (rollback to original)."""
    pool = await get_pool()
    await pool.execute(
        f"""
        UPDATE {table}
        SET optimized_content = NULL, optimized_at = NULL,
            optimization_score = NULL, optimization_model = NULL,
            optimization_config = NULL
        WHERE id = $1
        """,
        prompt_id,
    )


# ── Helpers ─────────────────────────────────────────────────────


def _row_to_prompt(row: asyncpg.Record | None) -> PromptRecord | None:
    if row is None:
        return None
    return PromptRecord(
        id=row["id"],
        chapter_id=row["chapter_id"],
        position=row["position"],
        is_assembly=bool(row["is_assembly"]),
        title=row["title"],
        content=row["content"],
        optimized_content=row.get("optimized_content"),
        optimization_score=row.get("optimization_score"),
        style_rules=row.get("style_rules"),
        knowledge_areas=row.get("knowledge_areas"),
        suggested_length=row.get("suggested_length"),
    )
