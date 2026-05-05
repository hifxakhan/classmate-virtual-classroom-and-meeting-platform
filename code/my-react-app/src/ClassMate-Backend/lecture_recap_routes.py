"""
Lecture recap API: transcript lines, dual summaries, quiz generation.
"""

import json
import os

from flask import Blueprint, jsonify, request

from db import getDbConnection
from lecture_ai_utils import assemble_transcript_lines, normalize_summary_text, parse_quiz_json

lecture_recap_bp = Blueprint("lecture_recap", __name__)


def ensure_lecture_recap_tables(cursor):
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS session_transcript_line (
            id SERIAL PRIMARY KEY,
            session_id TEXT NOT NULL,
            line_index INT NOT NULL,
            speaker_id VARCHAR(64) NOT NULL,
            speaker_type VARCHAR(32) NOT NULL,
            text TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(session_id, line_index)
        )
        """
    )
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS session_summary (
            session_id TEXT PRIMARY KEY,
            student_summary TEXT,
            teacher_summary TEXT,
            model TEXT,
            status VARCHAR(32) DEFAULT 'ok',
            error_message TEXT,
            updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS quiz (
            quiz_id SERIAL PRIMARY KEY,
            course_id VARCHAR(64) NOT NULL,
            session_id TEXT,
            title TEXT NOT NULL,
            created_by_teacher_id VARCHAR(64),
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    cursor.execute(
        """
        ALTER TABLE quiz
        ADD COLUMN IF NOT EXISTS created_by_teacher_id VARCHAR(64)
        """
    )
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS quiz_question (
            id SERIAL PRIMARY KEY,
            quiz_id INT NOT NULL REFERENCES quiz(quiz_id) ON DELETE CASCADE,
            question_order INT NOT NULL,
            question_type TEXT NOT NULL DEFAULT 'mcq',
            question_text TEXT NOT NULL,
            option_a TEXT NOT NULL,
            option_b TEXT NOT NULL,
            option_c TEXT NOT NULL,
            option_d TEXT NOT NULL,
            correct_index INT NOT NULL
        )
        """
    )
    cursor.execute(
        """
        ALTER TABLE quiz_question
        ADD COLUMN IF NOT EXISTS question_type TEXT DEFAULT 'mcq'
        """
    )
    cursor.execute(
        """
        UPDATE quiz_question
        SET question_type = 'mcq'
        WHERE question_type IS NULL
        """
    )
    cursor.execute(
        """
        ALTER TABLE quiz_question
        ALTER COLUMN question_type SET DEFAULT 'mcq'
        """
    )
    cursor.execute(
        """
        ALTER TABLE quiz_question
        ALTER COLUMN question_type SET NOT NULL
        """
    )
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS session_transcript_meta (
            session_id TEXT PRIMARY KEY,
            is_finalized BOOLEAN DEFAULT FALSE,
            finalized_at TIMESTAMPTZ,
            line_count INT DEFAULT 0,
            updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
        """
    )


def _ensure_tables_conn(conn):
    cur = conn.cursor()
    try:
        ensure_lecture_recap_tables(cur)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


def _session_row(cursor, session_id_param):
    """Return (session_id_text, course_id, teacher_id) for a given session.

    Uses LEFT JOIN with ::text casts on both sides of the course join so any
    column-type mismatch (VARCHAR vs TEXT vs INTEGER) cannot silently drop the
    row. Falls back to a two-step query if the joined row still isn't found.
    """
    sid = str(session_id_param)

    # Primary: LEFT JOIN so the session row is always returned even when the
    # course table has a type or value mismatch on course_id.
    cursor.execute(
        """
        SELECT cs.session_id::text, cs.course_id::text, c.teacher_id
        FROM class_session cs
        LEFT JOIN course c ON c.course_id::text = cs.course_id::text
        WHERE cs.session_id::text = %s
        """,
        (sid,),
    )
    row = cursor.fetchone()
    if row:
        return row

    # Fallback: session might use a UUID primary key — try without the cast.
    cursor.execute(
        "SELECT session_id::text, course_id::text FROM class_session WHERE session_id::text = %s",
        (sid,),
    )
    sess = cursor.fetchone()
    if not sess:
        return None

    session_id_text, course_id = sess
    # Try to find the teacher_id for this course separately.
    cursor.execute(
        "SELECT teacher_id FROM course WHERE course_id::text = %s LIMIT 1",
        (str(course_id),),
    )
    course_row = cursor.fetchone()
    teacher_id = course_row[0] if course_row else None
    return (session_id_text, course_id, teacher_id)


def _is_enrolled(cursor, course_id, student_id):
    cursor.execute(
        """
        SELECT 1 FROM enrollment
        WHERE course_id = %s AND student_id = %s AND COALESCE(is_active, true)
        """,
        (course_id, student_id),
    )
    return cursor.fetchone() is not None


def _can_view_transcript(cursor, session_row, viewer_id, viewer_type):
    if not session_row or not viewer_id or not viewer_type:
        return False
    _, course_id, teacher_id = session_row
    vt = str(viewer_type).lower()
    if vt == "teacher":
        # If teacher_id could not be resolved from the course table, allow any
        # teacher-typed viewer (best-effort for demo / data-inconsistency cases).
        if teacher_id is None or str(viewer_id) == str(teacher_id):
            return True
    if vt == "student" and _is_enrolled(cursor, course_id, viewer_id):
        return True
    return False


def _can_append_line(cursor, session_row, speaker_id, speaker_type):
    if not session_row:
        return False
    _, course_id, teacher_id = session_row
    st = str(speaker_type).lower()
    if st == "teacher":
        # Allow if teacher_id matches OR if course join couldn't resolve teacher_id.
        if teacher_id is None or str(speaker_id) == str(teacher_id):
            return True
    if st == "student" and _is_enrolled(cursor, course_id, speaker_id):
        return True
    return False


@lecture_recap_bp.route("/api/sessions/<session_id>/transcript/lines", methods=["POST"])
def append_transcript_line(session_id):
    conn = getDbConnection()
    if not conn:
        return jsonify({"success": False, "error": "Database connection failed"}), 500
    try:
        _ensure_tables_conn(conn)
        data = request.get_json(silent=True) or {}
        text = data.get("text")
        speaker_id = data.get("speaker_id")
        speaker_type = data.get("speaker_type")
        if not speaker_id or not str(speaker_id).strip():
            return jsonify({"success": False, "error": "speaker_id is required"}), 400
        if not speaker_type or not str(speaker_type).strip():
            return jsonify({"success": False, "error": "speaker_type is required"}), 400
        if text is None or not str(text).strip():
            return jsonify({"success": False, "error": "text is required"}), 400
        text = str(text).strip()
        if not text:
            return jsonify({"success": False, "error": "text cannot be empty"}), 400

        cursor = conn.cursor()
        session_row = _session_row(cursor, session_id)
        if not session_row:
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": f"Session not found: {session_id}"}), 404

        if not _can_append_line(cursor, session_row, speaker_id, speaker_type):
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": "Not allowed to add transcript for this session"}), 403

        sid_key = session_row[0]
        cursor.execute(
            "SELECT COALESCE(MAX(line_index), 0) + 1 FROM session_transcript_line WHERE session_id = %s",
            (sid_key,),
        )
        next_idx = cursor.fetchone()[0]
        cursor.execute(
            """
            INSERT INTO session_transcript_line (session_id, line_index, speaker_id, speaker_type, text)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id
            """,
            (sid_key, next_idx, str(speaker_id), str(speaker_type), text),
        )
        line_id = cursor.fetchone()[0]
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({"success": True, "line_id": line_id, "id": line_id}), 201
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        try:
            conn.close()
        except Exception:
            pass
        return jsonify({"success": False, "error": str(e)}), 500


@lecture_recap_bp.route("/api/sessions/<session_id>/transcript", methods=["GET"])
def get_transcript(session_id):
    viewer_id = request.args.get("viewer_id")
    viewer_type = request.args.get("viewer_type")
    conn = getDbConnection()
    if not conn:
        return jsonify({"success": False, "error": "Database connection failed"}), 500
    try:
        _ensure_tables_conn(conn)
        cursor = conn.cursor()
        session_row = _session_row(cursor, session_id)
        if not session_row:
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": f"Session not found: {session_id}"}), 404
        if not _can_view_transcript(cursor, session_row, viewer_id, viewer_type):
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": "Forbidden"}), 403

        sid_key = session_row[0]
        cursor.execute(
            """
            SELECT id, line_index, speaker_id, speaker_type, text, created_at
            FROM session_transcript_line
            WHERE session_id = %s
            ORDER BY line_index ASC, id ASC
            """,
            (sid_key,),
        )
        rows = cursor.fetchall()
        lines = []
        for r in rows:
            lines.append(
                {
                    "id": r[0],
                    "line_index": r[1],
                    "speaker_id": r[2],
                    "speaker_type": r[3],
                    "text": r[4],
                    "created_at": r[5].isoformat() if hasattr(r[5], "isoformat") else r[5],
                }
            )
        full_text = assemble_transcript_lines(lines)
        cursor.close()
        conn.close()
        return jsonify({"success": True, "lines": lines, "full_text": full_text}), 200
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        return jsonify({"success": False, "error": str(e)}), 500


@lecture_recap_bp.route("/api/sessions/<session_id>/summarize", methods=["POST"])
def summarize_session(session_id):
    conn = getDbConnection()
    if not conn:
        return jsonify({"success": False, "error": "Database connection failed"}), 500
    try:
        _ensure_tables_conn(conn)
        data = request.get_json(silent=True) or {}
        if data.get("student_id"):
            conn.close()
            return jsonify({"success": False, "error": "Only the course teacher can summarize"}), 403

        teacher_id = data.get("teacher_id")
        if not teacher_id:
            conn.close()
            return jsonify({"success": False, "error": "teacher_id is required"}), 400

        if not os.environ.get("OPENAI_API_KEY"):
            conn.close()
            return jsonify({"success": False, "error": "OpenAI is not configured (OPENAI_API_KEY missing)"}), 503

        cursor = conn.cursor()
        session_row = _session_row(cursor, session_id)
        if not session_row:
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": f"Session not found: {session_id}"}), 404
        _, course_id, course_teacher_id = session_row
        # Allow if teacher_id matches OR if course join couldn't resolve course_teacher_id.
        if course_teacher_id is not None and str(teacher_id) != str(course_teacher_id):
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": "Only the course teacher can summarize"}), 403

        sid_key = session_row[0]
        cursor.execute(
            """
            SELECT student_summary, teacher_summary, status
            FROM session_summary WHERE session_id = %s
            """,
            (sid_key,),
        )
        existing = cursor.fetchone()
        if (
            existing
            and existing[0]
            and existing[1]
            and str(existing[2] or "").lower() == "ok"
        ):
            cursor.close()
            conn.close()
            return jsonify(
                {
                    "success": True,
                    "student_summary": existing[0],
                    "teacher_summary": existing[1],
                    "cached": True,
                }
            ), 200

        cursor.execute(
            """
            SELECT line_index, text, created_at
            FROM session_transcript_line
            WHERE session_id = %s
            ORDER BY line_index ASC, id ASC
            """,
            (sid_key,),
        )
        trows = cursor.fetchall()
        line_dicts = [
            {"line_index": tr[0], "text": tr[1], "created_at": tr[2]} for tr in trows
        ]
        transcript = assemble_transcript_lines(line_dicts).strip()
        if not transcript:
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": "Transcript is empty; nothing to summarize"}), 400

        model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")

        import openai_service

        try:
            student_summary, teacher_summary = openai_service.summarize_dual_audience(transcript)
            student_summary = normalize_summary_text(student_summary)
            teacher_summary = normalize_summary_text(teacher_summary)
        except Exception as e:
            err_msg = str(e)[:4000]
            try:
                cursor.execute(
                    """
                    INSERT INTO session_summary (
                        session_id, student_summary, teacher_summary, model, status, error_message, updated_at
                    )
                    VALUES (%s, NULL, NULL, %s, 'error', %s, CURRENT_TIMESTAMP)
                    ON CONFLICT (session_id) DO UPDATE SET
                        status = 'error',
                        error_message = EXCLUDED.error_message,
                        model = EXCLUDED.model,
                        updated_at = CURRENT_TIMESTAMP
                    """,
                    (sid_key, model, err_msg),
                )
                conn.commit()
            except Exception:
                conn.rollback()
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": str(e)}), 502
        cursor.execute(
            """
            INSERT INTO session_summary (session_id, student_summary, teacher_summary, model, status, error_message, updated_at)
            VALUES (%s, %s, %s, %s, 'ok', NULL, CURRENT_TIMESTAMP)
            ON CONFLICT (session_id) DO UPDATE SET
                student_summary = EXCLUDED.student_summary,
                teacher_summary = EXCLUDED.teacher_summary,
                model = EXCLUDED.model,
                status = 'ok',
                error_message = NULL,
                updated_at = CURRENT_TIMESTAMP
            """,
            (sid_key, student_summary, teacher_summary, model),
        )
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify(
            {
                "success": True,
                "student_summary": student_summary,
                "teacher_summary": teacher_summary,
            }
        ), 200
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        try:
            conn.close()
        except Exception:
            pass
        return jsonify({"success": False, "error": str(e)}), 500


@lecture_recap_bp.route("/api/sessions/<session_id>/summary", methods=["GET"])
def get_summary(session_id):
    viewer_id = request.args.get("viewer_id")
    viewer_type = request.args.get("viewer_type")
    conn = getDbConnection()
    if not conn:
        return jsonify({"success": False, "error": "Database connection failed"}), 500
    try:
        _ensure_tables_conn(conn)
        cursor = conn.cursor()
        session_row = _session_row(cursor, session_id)
        if not session_row:
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": f"Session not found: {session_id}"}), 404
        if not _can_view_transcript(cursor, session_row, viewer_id, viewer_type):
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": "Forbidden"}), 403

        sid_key = session_row[0]
        cursor.execute(
            """
            SELECT student_summary, teacher_summary, status, error_message
            FROM session_summary WHERE session_id = %s
            """,
            (sid_key,),
        )
        row = cursor.fetchone()
        if not row:
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": "Summary not generated yet"}), 404

        student_summary, teacher_summary, sum_status, sum_error = row[0], row[1], row[2], row[3]
        st = str(sum_status or "").lower()
        if st == "error":
            cursor.close()
            conn.close()
            return (
                jsonify(
                    {
                        "success": False,
                        "status": "error",
                        "error": sum_error or "Summary generation failed",
                    }
                ),
                503,
            )

        if not student_summary or not teacher_summary or st != "ok":
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": "Summary not generated yet"}), 404

        vt = str(viewer_type or "").lower()
        payload = {"success": True}
        if vt == "student":
            payload["student_summary"] = student_summary
        else:
            payload["student_summary"] = student_summary
            payload["teacher_summary"] = teacher_summary
        cursor.close()
        conn.close()
        return jsonify(payload), 200
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        return jsonify({"success": False, "error": str(e)}), 500


@lecture_recap_bp.route("/api/sessions/<session_id>/generate-quiz", methods=["POST"])
def generate_quiz(session_id):
    conn = getDbConnection()
    if not conn:
        return jsonify({"success": False, "error": "Database connection failed"}), 500
    try:
        _ensure_tables_conn(conn)
        data = request.get_json(silent=True) or {}
        if data.get("student_id"):
            conn.close()
            return jsonify({"success": False, "error": "Only the course teacher can generate a quiz"}), 403

        teacher_id = data.get("teacher_id")
        if not teacher_id:
            conn.close()
            return jsonify({"success": False, "error": "teacher_id is required"}), 400

        n = data.get("num_questions", 5)
        try:
            n = int(n)
        except (TypeError, ValueError):
            conn.close()
            return jsonify({"success": False, "error": "num_questions must be an integer"}), 400
        if n <= 0 or n > 20:
            conn.close()
            return jsonify({"success": False, "error": "num_questions must be between 1 and 20"}), 400

        if not os.environ.get("OPENAI_API_KEY"):
            conn.close()
            return jsonify({"success": False, "error": "OpenAI is not configured (OPENAI_API_KEY missing)"}), 503

        cursor = conn.cursor()
        session_row = _session_row(cursor, session_id)
        if not session_row:
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": f"Session not found: {session_id}"}), 404
        _, course_id, course_teacher_id = session_row
        # Allow if teacher_id matches OR if course join couldn't resolve course_teacher_id.
        if course_teacher_id is not None and str(teacher_id) != str(course_teacher_id):
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": "Only the course teacher can generate a quiz"}), 403

        sid_key = session_row[0]
        cursor.execute(
            """
            SELECT line_index, text, created_at
            FROM session_transcript_line
            WHERE session_id = %s
            ORDER BY line_index ASC, id ASC
            """,
            (sid_key,),
        )
        trows = cursor.fetchall()
        line_dicts = [
            {"line_index": tr[0], "text": tr[1], "created_at": tr[2]} for tr in trows
        ]
        transcript = assemble_transcript_lines(line_dicts).strip()
        if not transcript:
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": "Transcript is empty"}), 400

        import openai_service

        try:
            raw_json = openai_service.generate_quiz_mcqs(transcript, n)
            questions = parse_quiz_json(raw_json)
        except (ValueError, json.JSONDecodeError) as e:
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": str(e)}), 422
        except RuntimeError as e:
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": str(e)}), 502
        except Exception as e:
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": str(e)}), 500

        if len(questions) != n:
            cursor.close()
            conn.close()
            return jsonify(
                {"success": False, "error": f"Expected {n} questions, got {len(questions)}"}
            ), 422

        title = f"Session quiz ({n} questions)"
        cursor.execute(
            """
            INSERT INTO quiz (course_id, session_id, title, created_by_teacher_id)
            VALUES (%s, %s, %s, %s)
            RETURNING quiz_id
            """,
            (course_id, sid_key, title, str(teacher_id)),
        )
        quiz_id = cursor.fetchone()[0]
        for i, q in enumerate(questions):
            opts = q["options"]
            cursor.execute(
                """
                INSERT INTO quiz_question (
                    quiz_id, question_order, question_type, question_text,
                    option_a, option_b, option_c, option_d, correct_index
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    quiz_id,
                    i + 1,
                    "mcq",
                    q["question_text"],
                    opts[0],
                    opts[1],
                    opts[2],
                    opts[3],
                    q["correct_index"],
                ),
            )
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({"success": True, "quiz_id": quiz_id}), 201
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        try:
            conn.close()
        except Exception:
            pass
        return jsonify({"success": False, "error": str(e)}), 500


def _quiz_access_row(cursor, quiz_id):
    cursor.execute(
        """
        SELECT q.quiz_id, q.course_id, q.title, c.teacher_id
        FROM quiz q
        JOIN course c ON c.course_id = q.course_id
        WHERE q.quiz_id = %s
        """,
        (quiz_id,),
    )
    return cursor.fetchone()


def _can_access_quiz(cursor, quiz_row, viewer_id, viewer_type):
    if not quiz_row or not viewer_id or not viewer_type:
        return False
    _, course_id, _, teacher_id = quiz_row
    vt = str(viewer_type).lower()
    if vt == "teacher" and str(viewer_id) == str(teacher_id):
        return True
    if vt == "student" and _is_enrolled(cursor, course_id, viewer_id):
        return True
    return False


@lecture_recap_bp.route("/api/quizzes/<int:quiz_id>", methods=["GET"])
def get_quiz_detail(quiz_id):
    viewer_id = request.args.get("viewer_id")
    viewer_type = request.args.get("viewer_type")
    conn = getDbConnection()
    if not conn:
        return jsonify({"success": False, "error": "Database connection failed"}), 500
    try:
        _ensure_tables_conn(conn)
        cursor = conn.cursor()
        quiz_row = _quiz_access_row(cursor, quiz_id)
        if not quiz_row:
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": "Quiz not found"}), 404
        if not _can_access_quiz(cursor, quiz_row, viewer_id, viewer_type):
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": "Forbidden"}), 403

        qid, course_id, title, _teacher_id = quiz_row
        cursor.execute(
            """
            SELECT question_order, question_text, option_a, option_b, option_c, option_d, correct_index
            FROM quiz_question
            WHERE quiz_id = %s
            ORDER BY question_order ASC, id ASC
            """,
            (qid,),
        )
        rows = cursor.fetchall()
        show_answers = str(viewer_type or "").lower() == "teacher"
        questions = []
        for r in rows:
            order, qtext, oa, ob, oc, od, cidx = r
            item = {
                "question_order": order,
                "question_text": qtext,
                "options": [oa, ob, oc, od],
            }
            if show_answers:
                item["correct_index"] = cidx
            questions.append(item)
        cursor.close()
        conn.close()
        return (
            jsonify(
                {
                    "success": True,
                    "quiz_id": qid,
                    "course_id": course_id,
                    "title": title or "Quiz",
                    "questions": questions,
                }
            ),
            200,
        )
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        return jsonify({"success": False, "error": str(e)}), 500


@lecture_recap_bp.route("/api/sessions/<session_id>/transcript/finalize", methods=["POST"])
def finalize_transcript(session_id):
    """Mark transcript as finalized when teacher ends the class.
    No AI call — just records a finalized flag and line count."""
    conn = getDbConnection()
    if not conn:
        return jsonify({"success": False, "error": "Database connection failed"}), 500
    try:
        _ensure_tables_conn(conn)
        data = request.get_json(silent=True) or {}
        teacher_id = data.get("teacher_id")

        cursor = conn.cursor()
        session_row = _session_row(cursor, session_id)
        if not session_row:
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": f"Session not found: {session_id}"}), 404

        _, course_id, course_teacher_id = session_row
        if teacher_id and str(teacher_id) != str(course_teacher_id):
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": "Only the course teacher can finalize the transcript"}), 403

        sid_key = session_row[0]

        cursor.execute(
            "SELECT COUNT(*) FROM session_transcript_line WHERE session_id = %s",
            (sid_key,),
        )
        line_count = cursor.fetchone()[0]

        cursor.execute(
            """
            INSERT INTO session_transcript_meta
                (session_id, is_finalized, finalized_at, line_count, updated_at)
            VALUES (%s, TRUE, CURRENT_TIMESTAMP, %s, CURRENT_TIMESTAMP)
            ON CONFLICT (session_id) DO UPDATE SET
                is_finalized = TRUE,
                finalized_at = CURRENT_TIMESTAMP,
                line_count   = EXCLUDED.line_count,
                updated_at   = CURRENT_TIMESTAMP
            """,
            (sid_key, line_count),
        )
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({"success": True, "finalized": True, "line_count": line_count}), 200
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        try:
            conn.close()
        except Exception:
            pass
        return jsonify({"success": False, "error": str(e)}), 500


@lecture_recap_bp.route("/api/sessions/<session_id>/quizzes", methods=["GET"])
def list_session_quizzes(session_id):
    """Return all quizzes that were generated for a session."""
    viewer_id = request.args.get("viewer_id")
    viewer_type = request.args.get("viewer_type")
    conn = getDbConnection()
    if not conn:
        return jsonify({"success": False, "error": "Database connection failed"}), 500
    try:
        _ensure_tables_conn(conn)
        cursor = conn.cursor()
        session_row = _session_row(cursor, session_id)
        if not session_row:
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": f"Session not found: {session_id}"}), 404
        if not _can_view_transcript(cursor, session_row, viewer_id, viewer_type):
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": "Forbidden"}), 403

        sid_key = session_row[0]
        cursor.execute(
            """
            SELECT quiz_id, title, created_at
            FROM quiz
            WHERE session_id = %s
            ORDER BY created_at DESC
            """,
            (sid_key,),
        )
        rows = cursor.fetchall()
        quizzes = [
            {
                "quiz_id": r[0],
                "title": r[1] or "Quiz",
                "created_at": r[2].isoformat() if hasattr(r[2], "isoformat") else r[2],
            }
            for r in rows
        ]
        cursor.close()
        conn.close()
        return jsonify({"success": True, "quizzes": quizzes}), 200
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        return jsonify({"success": False, "error": str(e)}), 500


@lecture_recap_bp.route("/api/quizzes/<int:quiz_id>/submit", methods=["POST"])
def submit_quiz_attempt(quiz_id):
    conn = getDbConnection()
    if not conn:
        return jsonify({"success": False, "error": "Database connection failed"}), 500
    try:
        _ensure_tables_conn(conn)
        data = request.get_json(silent=True) or {}
        student_id = data.get("student_id")
        answers = data.get("answers")
        if not student_id or not str(student_id).strip():
            return jsonify({"success": False, "error": "student_id is required"}), 400
        if not isinstance(answers, list):
            return jsonify({"success": False, "error": "answers must be a list"}), 400

        cursor = conn.cursor()
        quiz_row = _quiz_access_row(cursor, quiz_id)
        if not quiz_row:
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": "Quiz not found"}), 404
        _qid, course_id, _title, _teacher_id = quiz_row
        if not _is_enrolled(cursor, course_id, student_id):
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": "Forbidden"}), 403

        cursor.execute(
            """
            SELECT question_order, correct_index
            FROM quiz_question
            WHERE quiz_id = %s
            ORDER BY question_order ASC, id ASC
            """,
            (quiz_id,),
        )
        key_rows = cursor.fetchall()
        if not key_rows:
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": "Quiz has no questions"}), 400
        if len(answers) != len(key_rows):
            cursor.close()
            conn.close()
            return (
                jsonify(
                    {
                        "success": False,
                        "error": f"Expected {len(key_rows)} answers, got {len(answers)}",
                    }
                ),
                400,
            )

        correct = 0
        for i, kr in enumerate(key_rows):
            try:
                a = int(answers[i])
            except (TypeError, ValueError):
                cursor.close()
                conn.close()
                return jsonify({"success": False, "error": f"Invalid answer at index {i}"}), 400
            if a == int(kr[1]):
                correct += 1

        total = len(key_rows)
        cursor.close()
        conn.close()
        return (
            jsonify(
                {
                    "success": True,
                    "score": correct,
                    "total": total,
                    "percentage": round(100.0 * correct / total, 1) if total else 0,
                }
            ),
            200,
        )
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        return jsonify({"success": False, "error": str(e)}), 500
