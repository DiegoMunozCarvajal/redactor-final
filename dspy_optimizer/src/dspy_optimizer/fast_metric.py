"""Fast structural metric for meta-prompt output quality.

Evaluates template structure without generating fragments or calling judge LLMs.
Used for bootstrapping — fast enough for DSPy optimizers that need many metric calls.

Score 0-1 based on:
- Valid JSON parse
- Template count in range (6-10 optimal)
- All required fields present (name, function, content)
- Placeholder validity (only known placeholders, reasonable count)
- Content has sufficient length and instruction-like patterns
"""

from __future__ import annotations

import json
import re


# Known valid placeholders
KNOWN_GLOBAL = {
    "TEMA_DEL_LIBRO",
    "CONCEPTO_CENTRAL_DEL_LIBRO",
    "LECTOR_OBJETIVO",
    "RESULTADO_DESEADO",
    "TONO_DEL_LIBRO",
    "PRINCIPIO_CENTRAL_DEL_CAPITULO",
}
KNOWN_LOCAL = {
    "CASO_O_HISTORIA",
    "EJEMPLO_CONCRETO",
    "FUENTE_O_PAPER_BASE",
    "OBJECION_DEL_LECTOR",
    "IDEA_PUENTE",
}
KNOWN_PLACEHOLDERS = KNOWN_GLOBAL | KNOWN_LOCAL

# Required template fields
REQUIRED_FIELDS = {"name", "function", "content"}

# Minimum content length for a real template
MIN_CONTENT_LENGTH = 200

# Optimal template count range
OPTIMAL_MIN = 6
OPTIMAL_MAX = 10
ABSOLUTE_MIN = 3
ABSOLUTE_MAX = 15


def _extract_templates_json(raw_output: str) -> list[dict]:
    """Parse templates from raw meta-prompt output. Returns list of template dicts."""
    # Try direct JSON parse
    try:
        data = json.loads(raw_output)
    except json.JSONDecodeError:
        # Try code block extraction
        m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw_output, re.DOTALL)
        if m:
            try:
                data = json.loads(m.group(1))
            except json.JSONDecodeError:
                return []
        else:
            # Try first { to last }
            start = raw_output.find("{")
            end = raw_output.rfind("}")
            if start >= 0 and end > start:
                try:
                    data = json.loads(raw_output[start : end + 1])
                except json.JSONDecodeError:
                    return []
            else:
                return []

    if isinstance(data, dict):
        return data.get("templates", [])
    if isinstance(data, list):
        return data
    return []


def _check_placeholder_validity(content: str) -> tuple[int, int, list[str]]:
    """Count placeholders and check if they're valid. Returns (valid, invalid, invalid_names)."""
    placeholders = re.findall(r"\{([A-Z_][A-Z0-9_]*)\}", content)
    valid = 0
    invalid = 0
    invalid_names = []
    for p in placeholders:
        if p in KNOWN_PLACEHOLDERS:
            valid += 1
        else:
            invalid += 1
            invalid_names.append(p)
    # Allow up to 2 unknown placeholders (could be legitimate new ones)
    if invalid <= 2:
        valid += invalid
        invalid = 0
        invalid_names = []
    return valid, invalid, invalid_names


def _content_has_instructions(content: str) -> bool:
    """Check if content looks like an actual prompt (has instructional language)."""
    instruction_markers = [
        "escribe",
        "redacta",
        "genera",
        "crea",
        "desarrolla",
        "explica",
        "describe",
        "analiza",
        "presenta",
        "introduce",
        "conecta",
        "cierra",
        "elabora",
        "construye",
        "narra",
        "argumenta",
        "sintetiza",
    ]
    content_lower = content.lower()
    return any(marker in content_lower for marker in instruction_markers)


def structural_metric_score(raw_output: str) -> float:
    """Score meta-prompt output on structural quality. 0.0 to 1.0.

    This is a fast, deterministic metric for DSPy bootstrapping.
    It does NOT evaluate content quality — only structure.
    """
    templates = _extract_templates_json(raw_output)

    if not templates:
        return 0.0

    score = 0.0
    count = len(templates)

    # 1. Template count (30% of score)
    if OPTIMAL_MIN <= count <= OPTIMAL_MAX:
        score += 0.30
    elif ABSOLUTE_MIN <= count <= ABSOLUTE_MAX:
        # Linear interpolation toward optimal range
        if count < OPTIMAL_MIN:
            score += (
                0.30 * (count - ABSOLUTE_MIN + 1) / (OPTIMAL_MIN - ABSOLUTE_MIN + 1)
            )
        else:
            score += (
                0.30 * (ABSOLUTE_MAX - count + 1) / (ABSOLUTE_MAX - OPTIMAL_MAX + 1)
            )
    else:
        score += 0.0  # Too few or too many

    # 2. Field completeness (25% of score)
    field_scores = []
    for t in templates:
        if not isinstance(t, dict):
            field_scores.append(0.0)
            continue
        present = sum(1 for f in REQUIRED_FIELDS if f in t and t[f])
        field_scores.append(present / len(REQUIRED_FIELDS))
    if field_scores:
        score += 0.25 * (sum(field_scores) / len(field_scores))

    # 3. Content quality signals (25% of score)
    content_scores = []
    for t in templates:
        if not isinstance(t, dict):
            content_scores.append(0.0)
            continue
        content = t.get("content", "")
        if not content:
            content_scores.append(0.0)
            continue
        cs = 0.0
        # Length check
        if len(content) >= MIN_CONTENT_LENGTH:
            cs += 0.4
        elif len(content) >= 100:
            cs += 0.2
        # Has instructions
        if _content_has_instructions(content):
            cs += 0.3
        # Has placeholders (prompts should have some)
        if "{" in content and "}" in content:
            cs += 0.3
        content_scores.append(cs)
    if content_scores:
        score += 0.25 * (sum(content_scores) / len(content_scores))

    # 4. Placeholder validity (20% of score)
    placeholder_scores = []
    for t in templates:
        if not isinstance(t, dict):
            placeholder_scores.append(0.0)
            continue
        content = t.get("content", "")
        declared = t.get("placeholders", [])
        if not content:
            placeholder_scores.append(1.0)  # No content = no placeholder issues
            continue
        valid, invalid, _ = _check_placeholder_validity(content)
        total = valid + invalid
        if total == 0:
            placeholder_scores.append(1.0)  # No placeholders = fine
        else:
            placeholder_scores.append(valid / total)
    if placeholder_scores:
        score += 0.20 * (sum(placeholder_scores) / len(placeholder_scores))

    return min(1.0, score)


def fast_metric(example, pred, trace=None) -> float:
    """DSPy-compatible metric function. Returns score 0-1."""
    raw = pred.templates_json if hasattr(pred, "templates_json") else str(pred)
    if not raw:
        return 0.0
    return structural_metric_score(raw)


def fast_metric_with_threshold(
    example, pred, trace=None, threshold: float = 0.5
) -> bool:
    """Boolean metric for bootstrapping. Returns True if score >= threshold."""
    return fast_metric(example, pred, trace) >= threshold
