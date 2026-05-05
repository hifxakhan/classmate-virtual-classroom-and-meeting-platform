"""Ensure recap routes are wired into the main app (Phase 3 registers blueprint)."""


def test_lecture_recap_transcript_routes_exist(flask_app):
    rules = [str(r.rule) for r in flask_app.url_map.iter_rules()]
    assert any("/api/sessions/" in r and "transcript" in r for r in rules), (
        "Expected recap transcript routes under /api/sessions/.../transcript"
    )


def test_lecture_recap_summarize_route_exists(flask_app):
    rules = [str(r.rule) for r in flask_app.url_map.iter_rules()]
    assert any("summarize" in r for r in rules), "Expected POST .../summarize"


def test_lecture_recap_generate_quiz_route_exists(flask_app):
    rules = [str(r.rule) for r in flask_app.url_map.iter_rules()]
    assert any("generate-quiz" in r for r in rules), "Expected POST .../generate-quiz"
