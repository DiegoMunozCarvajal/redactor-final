"""Tests for the judge module."""

import pytest
from dspy_optimizer.judge import _parse_verdict, JudgeVerdict


class TestParseVerdict:
    def test_parses_valid_json(self):
        raw = '{"clarity":8,"accuracy":7,"cohesion":6,"engagement":9,"completeness":8,"overall":8,"issues":[]}'
        verdict = _parse_verdict(raw)
        assert verdict.clarity == 8
        assert verdict.accuracy == 7
        assert verdict.cohesion == 6
        assert verdict.engagement == 9
        assert verdict.completeness == 8
        assert verdict.overall == 8
        assert verdict.issues == []

    def test_parses_json_with_issues(self):
        raw = '{"clarity":5,"accuracy":4,"cohesion":6,"engagement":3,"completeness":5,"overall":5,"issues":["Oraciones muy largas","Usa \\"realmente\\" 3 veces"]}'
        verdict = _parse_verdict(raw)
        assert verdict.overall == 5
        assert len(verdict.issues) == 2

    def test_extracts_json_from_markdown(self):
        raw = 'Here is my evaluation:\n```json\n{"clarity":7,"accuracy":8,"cohesion":7,"engagement":6,"completeness":7,"overall":7,"issues":["Párrafo 3 no tiene transición"]}\n```'
        verdict = _parse_verdict(raw)
        assert verdict.overall == 7
        assert len(verdict.issues) == 1

    def test_raises_on_garbage(self):
        with pytest.raises(ValueError):
            _parse_verdict("not json at all")


class TestJudgeVerdict:
    def test_score_normalized(self):
        v = JudgeVerdict(
            clarity=8,
            accuracy=7,
            cohesion=6,
            engagement=9,
            completeness=8,
            overall=8,
            issues=[],
        )
        assert v.score == 0.8

    def test_dimensions_dict(self):
        v = JudgeVerdict(
            clarity=5,
            accuracy=5,
            cohesion=5,
            engagement=5,
            completeness=5,
            overall=5,
            issues=[],
        )
        dims = v.dimensions
        assert dims == {
            "clarity": 5,
            "accuracy": 5,
            "cohesion": 5,
            "engagement": 5,
            "completeness": 5,
        }
