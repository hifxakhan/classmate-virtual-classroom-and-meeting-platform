"""Unit tests for lecture_ai_utils (Phase 1 — expect RED until Phase 3 fixes stubs)."""

import json

import pytest

from lecture_ai_utils import (
    assemble_transcript_lines,
    normalize_summary_text,
    parse_quiz_json,
    truncate_for_model,
)


class TestAssembleTranscriptLines:
    def test_empty_yields_empty_string(self):
        assert assemble_transcript_lines([]) == ""

    def test_sorts_by_line_index(self):
        lines = [
            {"line_index": 3, "text": " third", "created_at": "2025-01-01T00:00:03"},
            {"line_index": 1, "text": " first ", "created_at": "2025-01-01T00:00:01"},
            {"line_index": 2, "text": "second", "created_at": "2025-01-01T00:00:02"},
        ]
        assert assemble_transcript_lines(lines) == "first\nsecond\nthird"

    def test_tiebreak_by_created_at_when_line_index_equal(self):
        lines = [
            {"line_index": 1, "text": "b", "created_at": "2025-01-01T00:00:02"},
            {"line_index": 1, "text": "a", "created_at": "2025-01-01T00:00:01"},
        ]
        assert assemble_transcript_lines(lines) == "a\nb"

    def test_strips_whitespace_per_line(self):
        lines = [{"line_index": 1, "text": "  hello  "}]
        assert assemble_transcript_lines(lines) == "hello"

    def test_missing_line_index_treated_as_zero(self):
        lines = [
            {"line_index": 2, "text": "second"},
            {"text": "first missing index defaults to 0"},
        ]
        assert assemble_transcript_lines(lines) == "first missing index defaults to 0\nsecond"


class TestTruncateForModel:
    def test_no_truncation_when_shorter_than_limit(self):
        assert truncate_for_model("short", 100) == "short"

    def test_head_policy_keeps_prefix(self):
        text = "A" * 100
        assert truncate_for_model(text, 40) == "A" * 40

    def test_none_returns_empty(self):
        assert truncate_for_model(None, 100) == ""

    def test_non_positive_limit_returns_empty(self):
        assert truncate_for_model("hello", 0) == ""
        assert truncate_for_model("hello", -5) == ""


class TestParseQuizJson:
    def test_valid_minimal_mcq_normalized(self):
        raw = json.dumps(
            [
                {
                    "question": "What is 2+2?",
                    "options": ["3", "4", "5", "6"],
                    "correct_index": 1,
                }
            ]
        )
        items = parse_quiz_json(raw)
        assert len(items) == 1
        q = items[0]
        assert q.get("question_text") == "What is 2+2?"
        assert q["options"] == ["3", "4", "5", "6"]
        assert q["correct_index"] == 1

    def test_correct_answer_letter_b_maps_to_index_1(self):
        raw = json.dumps(
            [
                {
                    "question_text": "Pick B",
                    "options": ["a", "b", "c", "d"],
                    "correct_answer": "B",
                }
            ]
        )
        items = parse_quiz_json(raw)
        assert items[0]["correct_index"] == 1

    def test_malformed_json_raises(self):
        with pytest.raises((json.JSONDecodeError, ValueError)):
            parse_quiz_json("{not json")

    def test_empty_string_raises(self):
        with pytest.raises(ValueError):
            parse_quiz_json("   ")

    def test_non_array_raises(self):
        with pytest.raises(ValueError):
            parse_quiz_json('{"quiz": []}')

    def test_empty_array_ok(self):
        assert parse_quiz_json("[]") == []

    def test_missing_question_raises(self):
        raw = json.dumps([{"options": ["a", "b", "c", "d"], "correct_index": 0}])
        with pytest.raises(ValueError):
            parse_quiz_json(raw)

    def test_wrong_options_length_raises(self):
        raw = json.dumps([{"question": "Q", "options": ["a", "b"], "correct_index": 0}])
        with pytest.raises(ValueError):
            parse_quiz_json(raw)


class TestNormalizeSummaryText:
    def test_none_raises(self):
        with pytest.raises(ValueError):
            normalize_summary_text(None)

    def test_strips_whitespace(self):
        assert normalize_summary_text("  hi  ") == "hi"

    def test_strips_script_tag_minimal(self):
        text = '<script>alert(1)</script>Hello'
        out = normalize_summary_text(text)
        assert "<script>" not in out.lower()
        assert "Hello" in out
