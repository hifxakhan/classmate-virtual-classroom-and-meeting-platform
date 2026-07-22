"""
Contract for GET /api/courses/<course_id>/quizzes — matches studentCourseProfile.jsx expectations.
"""

import pytest


def test_quizzes_response_shape(client):
    course_id = "course-uuid-1"
    r = client.get(f"/api/courses/{course_id}/quizzes")
    assert r.status_code == 200
    data = r.get_json()
    assert isinstance(data, dict)
    assert "success" in data
    assert data["success"] is True
    assert "quizzes" in data
    assert isinstance(data["quizzes"], list)
    for q in data["quizzes"]:
        assert "id" in q or "quiz_id" in q
        key = "id" if "id" in q else "quiz_id"
        assert q[key] is not None
        assert "title" in q
