"""
HTTP contract tests for lecture recap API (Phase 1 — RED until routes are registered and implemented).

Uses the real Flask app; unregistered routes return 404.
"""

import json
import os
from unittest.mock import patch

import pytest


def _j(resp):
    return resp.get_json(silent=True) or {}


def _sid():
    """Seeded session (see tests/conftest.py); has transcript lines for summarize tests."""
    return os.environ.get("CLASSMATE_RECAP_TEST_SESSION_ID", "sess-1")


def _sid_empty():
    """Seeded session with no transcript lines (summarize-empty tests)."""
    return os.environ.get("CLASSMATE_RECAP_EMPTY_SESSION_ID", "sess-empty-1")


def _sid_idempotent():
    """Session with transcript but no summary yet (isolated summarize / idempotent tests)."""
    return os.environ.get("CLASSMATE_RECAP_IDEMPOTENT_SESSION_ID", _sid())


class TestAppendTranscriptLine:
    def test_missing_text_returns_400(self, client):
        r = client.post(
            f"/api/sessions/{_sid()}/transcript/lines",
            json={"speaker_id": "T1", "speaker_type": "teacher"},
            content_type="application/json",
        )
        assert r.status_code == 400
        body = _j(r)
        assert body.get("success") is False
        assert "error" in body

    def test_whitespace_only_text_returns_400(self, client):
        r = client.post(
            f"/api/sessions/{_sid()}/transcript/lines",
            json={"speaker_id": "T1", "speaker_type": "teacher", "text": "   \n\t  "},
        )
        assert r.status_code == 400

    def test_missing_speaker_id_returns_400(self, client):
        r = client.post(
            f"/api/sessions/{_sid()}/transcript/lines",
            json={"speaker_type": "teacher", "text": "hello"},
        )
        assert r.status_code == 400

    def test_missing_speaker_type_returns_400(self, client):
        r = client.post(
            f"/api/sessions/{_sid()}/transcript/lines",
            json={"speaker_id": "T1", "text": "hello"},
        )
        assert r.status_code == 400

    def test_unknown_session_returns_404(self, client):
        r = client.post(
            "/api/sessions/nonexistent/transcript/lines",
            json={"speaker_id": "T1", "speaker_type": "teacher", "text": "hello"},
        )
        assert r.status_code == 404
        body = _j(r)
        assert body.get("success") is False
        assert "session" in (body.get("error") or "").lower()

    def test_db_failure_returns_500(self, client):
        with patch("lecture_recap_routes.getDbConnection", return_value=None):
            r = client.post(
                f"/api/sessions/{_sid()}/transcript/lines",
                json={"speaker_id": "T1", "speaker_type": "teacher", "text": "hello"},
            )
            assert r.status_code == 500

    def test_happy_path_returns_201_with_line_id(self, client):
        r = client.post(
            f"/api/sessions/{_sid()}/transcript/lines",
            json={"speaker_id": "T1", "speaker_type": "teacher", "text": "hello class"},
        )
        assert r.status_code == 201
        body = _j(r)
        assert body.get("success") is True
        assert "line_id" in body or "id" in body


class TestGetTranscript:
    def test_empty_transcript_returns_200(self, client):
        r = client.get(f"/api/sessions/{_sid_empty()}/transcript?viewer_id=S1&viewer_type=student")
        assert r.status_code == 200
        body = _j(r)
        assert body.get("success") is True
        assert body.get("lines") == []
        assert body.get("full_text") == ""

    def test_ordered_lines_in_full_text(self, client):
        r = client.get(f"/api/sessions/{_sid()}/transcript?viewer_id=T1&viewer_type=teacher")
        assert r.status_code == 200
        body = _j(r)
        if body.get("lines"):
            assert isinstance(body["lines"], list)
            assert "full_text" in body

    def test_session_not_found_returns_404(self, client):
        r = client.get(
            "/api/sessions/bad-session/transcript?viewer_id=S1&viewer_type=student"
        )
        assert r.status_code == 404
        body = _j(r)
        assert body.get("success") is False
        assert "session" in (body.get("error") or "").lower()

    def test_student_not_enrolled_returns_403(self, client):
        r = client.get(
            f"/api/sessions/{_sid()}/transcript?viewer_id=OUTSIDER&viewer_type=student"
        )
        assert r.status_code == 403

    def test_teacher_not_owner_returns_403(self, client):
        r = client.get(
            f"/api/sessions/{_sid()}/transcript?viewer_id=OTHER_T&viewer_type=teacher"
        )
        assert r.status_code == 403


class TestSummarize:
    def test_no_openai_key_returns_503(self, client, monkeypatch):
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        r = client.post(
            f"/api/sessions/{_sid()}/summarize",
            json={"teacher_id": "T1"},
            content_type="application/json",
        )
        assert r.status_code == 503
        body = _j(r)
        assert body.get("success") is False
        assert "error" in body

    def test_openai_error_returns_502(self, client, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test-dummy")
        with patch(
            "openai_service.summarize_dual_audience",
            side_effect=RuntimeError("OpenAI down"),
        ):
            r = client.post(
                f"/api/sessions/{_sid()}/summarize",
                json={"teacher_id": "T1"},
            )
            assert r.status_code == 502

    def test_empty_transcript_returns_400(self, client, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test-dummy")
        r = client.post(
            f"/api/sessions/{_sid_empty()}/summarize",
            json={"teacher_id": "T1"},
        )
        assert r.status_code == 400
        body = _j(r)
        assert "error" in body

    def test_success_returns_both_summaries(self, client, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test-dummy")
        with patch(
            "openai_service.summarize_dual_audience",
            return_value=("student view", "teacher view"),
        ):
            r = client.post(
                f"/api/sessions/{_sid()}/summarize",
                json={"teacher_id": "T1"},
            )
            assert r.status_code == 200
            body = _j(r)
            assert body.get("success") is True
            assert body.get("student_summary")
            assert body.get("teacher_summary")

    def test_idempotent_second_post_no_extra_openai_call(self, client, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test-dummy")
        with patch(
            "openai_service.summarize_dual_audience",
            return_value=("s", "t"),
        ) as mock_ai:
            client.post(f"/api/sessions/{_sid_idempotent()}/summarize", json={"teacher_id": "T1"})
            client.post(f"/api/sessions/{_sid_idempotent()}/summarize", json={"teacher_id": "T1"})
            assert mock_ai.call_count == 1


class TestGetSummary:
    def test_not_generated_yet_returns_404(self, client):
        r = client.get(
            f"/api/sessions/{_sid_empty()}/summary?viewer_id=S1&viewer_type=student"
        )
        assert r.status_code == 404
        body = _j(r)
        assert body.get("success") is False

    def test_after_summarize_get_returns_200(self, client, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test-dummy")
        with patch(
            "openai_service.summarize_dual_audience",
            return_value=("for student", "for teacher"),
        ):
            client.post(f"/api/sessions/{_sid()}/summarize", json={"teacher_id": "T1"})
        r = client.get(
            f"/api/sessions/{_sid()}/summary?viewer_id=S1&viewer_type=student"
        )
        assert r.status_code == 200
        body = _j(r)
        assert body.get("success") is True


class TestGenerateQuiz:
    def test_invalid_num_questions_zero(self, client):
        r = client.post(
            f"/api/sessions/{_sid()}/generate-quiz",
            json={"teacher_id": "T1", "num_questions": 0},
        )
        assert r.status_code == 400

    def test_invalid_num_questions_negative(self, client):
        r = client.post(
            f"/api/sessions/{_sid()}/generate-quiz",
            json={"teacher_id": "T1", "num_questions": -1},
        )
        assert r.status_code == 400

    def test_invalid_num_questions_over_cap(self, client):
        r = client.post(
            f"/api/sessions/{_sid()}/generate-quiz",
            json={"teacher_id": "T1", "num_questions": 99},
        )
        assert r.status_code == 400

    def test_bad_openai_json_returns_422(self, client, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test-dummy")
        with patch(
            "openai_service.generate_quiz_mcqs",
            return_value="not valid json array",
        ):
            r = client.post(
                f"/api/sessions/{_sid()}/generate-quiz",
                json={"teacher_id": "T1", "num_questions": 3},
            )
            assert r.status_code in (422, 500)
            body = _j(r)
            assert body.get("success") is False

    def test_student_cannot_generate_quiz(self, client, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test-dummy")
        r = client.post(
            f"/api/sessions/{_sid()}/generate-quiz",
            json={"student_id": "S1", "num_questions": 3},
        )
        assert r.status_code == 403

    def test_success_creates_quiz(self, client, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test-dummy")
        payload = [
            {
                "question_text": "Q1",
                "options": ["a", "b", "c", "d"],
                "correct_index": 0,
            }
        ]
        with patch(
            "openai_service.generate_quiz_mcqs",
            return_value=json.dumps(payload),
        ):
            r = client.post(
                f"/api/sessions/{_sid()}/generate-quiz",
                json={"teacher_id": "T1", "num_questions": 1},
            )
            assert r.status_code == 201
            body = _j(r)
            assert body.get("success") is True
            assert "quiz_id" in body


class TestEnrollmentRules:
    def test_student_can_read_transcript_when_enrolled(self, client):
        r = client.get(
            f"/api/sessions/{_sid()}/transcript?viewer_id=ENROLLED_S&viewer_type=student"
        )
        assert r.status_code == 200
        body = _j(r)
        assert body.get("success") is True

    def test_student_cannot_summarize(self, client, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test-dummy")
        r = client.post(
            f"/api/sessions/{_sid()}/summarize",
            json={"student_id": "S1"},
        )
        assert r.status_code == 403
