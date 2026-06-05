"""
Lecture recap API: transcript lines, dual summaries, quiz generation.
"""

import json
import os

from flask import Blueprint, jsonify, request

from db import getDbConnection
from lecture_ai_utils import assemble_transcript_lines, normalize_summary_text, parse_quiz_json
from openai_service import (
    summarize_dual_audience,
    generate_exam_questions,
    translate_transcript,
    evaluate_short_answers,
)

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
            question_type TEXT NOT NULL DEFAULT 'multiple_choice',
            question_text TEXT NOT NULL,
            option_a TEXT,
            option_b TEXT,
            option_c TEXT,
            option_d TEXT,
            correct_index INT,
            correct_text TEXT
        )
        """
    )
    # Phase 2: make MCQ columns nullable for non-MCQ question types (safe for existing DBs)
    for col in ("option_a", "option_b", "option_c", "option_d", "correct_index"):
        try:
            cursor.execute(f"ALTER TABLE quiz_question ALTER COLUMN {col} DROP NOT NULL")
        except Exception:
            pass
    cursor.execute(
        """
        ALTER TABLE quiz_question
        ADD COLUMN IF NOT EXISTS correct_text TEXT
        """
    )
    # Drop the old CHECK constraint (if it exists) and add the updated one
    try:
        cursor.execute(
            """
            ALTER TABLE quiz_question
            DROP CONSTRAINT IF EXISTS quiz_question_question_type_check
            """
        )
    except Exception:
        pass
    cursor.execute(
        """
        ALTER TABLE quiz_question
        ADD COLUMN IF NOT EXISTS question_type TEXT DEFAULT 'multiple_choice'
        """
    )
    cursor.execute(
        """
        UPDATE quiz_question
        SET question_type = 'multiple_choice'
        WHERE question_type IS NULL
        """
    )
    cursor.execute(
        """
        ALTER TABLE quiz_question
        ALTER COLUMN question_type SET DEFAULT 'multiple_choice'
        """
    )
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS quiz_attempt (
            attempt_id SERIAL PRIMARY KEY,
            quiz_id INT NOT NULL REFERENCES quiz(quiz_id) ON DELETE CASCADE,
            student_id VARCHAR(50) NOT NULL,
            attempt_number INT NOT NULL,
            started_at TIMESTAMPTZ,
            completed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            time_taken_seconds INT,
            score NUMERIC(8,2),
            percentage NUMERIC(5,2),
            passed BOOLEAN,
            answers JSONB,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    # Phase 3: add grade letter + full answers_data JSON to quiz_attempt
    cursor.execute(
        """
        ALTER TABLE quiz_attempt
        ADD COLUMN IF NOT EXISTS grade VARCHAR(2)
        """
    )
    cursor.execute(
        """
        ALTER TABLE quiz_attempt
        ADD COLUMN IF NOT EXISTS answers_data TEXT
        """
    )
    cursor.execute(
        """
        ALTER TABLE quiz_attempt
        ADD COLUMN IF NOT EXISTS total INT
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
    # Phase 1: add translated_text column to existing tables (safe for repeated runs)
    cursor.execute(
        """
        ALTER TABLE session_transcript_meta
        ADD COLUMN IF NOT EXISTS translated_text TEXT
        """
    )
    cursor.execute(
        """
        ALTER TABLE session_transcript_meta
        ADD COLUMN IF NOT EXISTS translation_status VARCHAR(32) DEFAULT 'pending'
        """
    )


def _compute_grade(percentage: float) -> str:
    if percentage >= 90:
        return 'A'
    elif percentage >= 80:
        return 'B'
    elif percentage >= 70:
        return 'C'
    elif percentage >= 60:
        return 'D'
    return 'F'


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


@lecture_recap_bp.route("/api/sessions/<session_id>/transcript/transcribe", methods=["POST"])
def transcribe_transcript_audio(session_id):
    conn = getDbConnection()
    if not conn:
        return jsonify({"success": False, "error": "Database connection failed"}), 500
    try:
        _ensure_tables_conn(conn)

        if not os.environ.get("OPENAI_API_KEY"):
            conn.close()
            return jsonify({"success": False, "error": "OpenAI is not configured (OPENAI_API_KEY missing)"}), 503

        if "file" not in request.files:
            conn.close()
            return jsonify({"success": False, "error": "audio file is required"}), 400
        audio_file = request.files.get("file")
        if not audio_file or not getattr(audio_file, "filename", ""):
            conn.close()
            return jsonify({"success": False, "error": "audio file is required"}), 400

        cursor = conn.cursor()
        session_row = _session_row(cursor, session_id)
        if not session_row:
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": f"Session not found: {session_id}"}), 404

        import openai_service

        try:
            text = str(openai_service.transcribe_audio_file(audio_file) or "").strip()
        except Exception as e:
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": str(e)}), 502

        if not text:
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": "No speech detected in the audio"}), 422

        cursor.close()
        conn.close()
        return jsonify({"text": text}), 200
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


@lecture_recap_bp.route("/api/sessions/<session_id>/transcript/translate", methods=["POST"])
def translate_transcript_endpoint(session_id):
    """Translate the assembled Hinglish transcript to English using OpenAI.

    Only the course teacher may trigger this. The result is stored in
    session_transcript_meta.translated_text and returned immediately.
    Re-running will overwrite the previous translation.
    """
    conn = getDbConnection()
    if not conn:
        return jsonify({"success": False, "error": "Database connection failed"}), 500
    try:
        _ensure_tables_conn(conn)
        data = request.get_json(silent=True) or {}
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
        if course_teacher_id is not None and str(teacher_id) != str(course_teacher_id):
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": "Only the course teacher can translate the transcript"}), 403

        sid_key = session_row[0]

        # Assemble the original transcript lines
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
            return jsonify({"success": False, "error": "Transcript is empty; nothing to translate"}), 400

        import openai_service

        try:
            translated = openai_service.translate_transcript(transcript)
        except Exception as e:
            err_msg = str(e)[:4000]
            # Mark translation as failed so UI can surface it
            try:
                cursor.execute(
                    """
                    INSERT INTO session_transcript_meta
                        (session_id, translation_status, updated_at)
                    VALUES (%s, 'error', CURRENT_TIMESTAMP)
                    ON CONFLICT (session_id) DO UPDATE SET
                        translation_status = 'error',
                        updated_at = CURRENT_TIMESTAMP
                    """,
                    (sid_key,),
                )
                conn.commit()
            except Exception:
                conn.rollback()
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": err_msg}), 502

        # Persist the translation
        cursor.execute(
            """
            INSERT INTO session_transcript_meta
                (session_id, translated_text, translation_status, updated_at)
            VALUES (%s, %s, 'done', CURRENT_TIMESTAMP)
            ON CONFLICT (session_id) DO UPDATE SET
                translated_text = EXCLUDED.translated_text,
                translation_status = 'done',
                updated_at = CURRENT_TIMESTAMP
            """,
            (sid_key, translated),
        )
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({"success": True, "translated_text": translated, "translation_status": "done"}), 200
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

        # Phase 1: also fetch the English translation if it exists
        cursor.execute(
            """
            SELECT translated_text, translation_status
            FROM session_transcript_meta
            WHERE session_id = %s
            """,
            (sid_key,),
        )
        meta_row = cursor.fetchone()
        translated_text = None
        translation_status = "pending"
        if meta_row:
            translated_text = meta_row[0]
            translation_status = meta_row[1] or "pending"

        cursor.close()
        conn.close()
        return jsonify({
            "success": True,
            "lines": lines,
            "full_text": full_text,
            "translated_text": translated_text,
            "translation_status": translation_status,
        }), 200
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        return jsonify({"success": False, "error": str(e)}), 500


@lecture_recap_bp.route('/api/student/<student_id>/grades', methods=['GET'])
def get_student_grades(student_id):
    conn = getDbConnection()
    if not conn:
        return jsonify({"success": False, "error": "Database connection failed"}), 500
    try:
        _ensure_tables_conn(conn)
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT qa.attempt_id, qa.quiz_id, qa.attempt_number, qa.started_at, qa.completed_at,
                   qa.time_taken_seconds, qa.score, qa.percentage, qa.passed, qa.answers,
                   q.title as quiz_title, q.session_id, q.course_id,
                   c.course_code, c.title as course_title, cs.title as session_title, t.name as teacher_name
            FROM quiz_attempt qa
            JOIN quiz q ON q.quiz_id = qa.quiz_id
            LEFT JOIN course c ON c.course_id::text = q.course_id::text
            LEFT JOIN class_session cs ON cs.session_id::text = q.session_id::text
            LEFT JOIN teacher t ON t.teacher_id = c.teacher_id
            WHERE qa.student_id = %s
            ORDER BY qa.completed_at DESC
            LIMIT 200
            """,
            (student_id,),
        )
        rows = cursor.fetchall()
        out = []
        for r in rows:
            out.append(
                {
                    "attempt_id": r[0],
                    "quiz_id": r[1],
                    "attempt_number": r[2],
                    "started_at": r[3].isoformat() if r[3] else None,
                    "completed_at": r[4].isoformat() if r[4] else None,
                    "time_taken_seconds": r[5],
                    "score": float(r[6]) if r[6] is not None else None,
                    "percentage": float(r[7]) if r[7] is not None else None,
                    "passed": bool(r[8]),
                    "answers": r[9],
                    "quiz_title": r[10],
                    "session_id": r[11],
                    "course_id": r[12],
                    "course_code": r[13],
                    "course_title": r[14],
                    "session_title": r[15],
                    "teacher_name": r[16],
                }
            )
        cursor.close()
        conn.close()
        return jsonify({"success": True, "grades": out}), 200
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
            return jsonify({"success": False, "error": "Only the course teacher can generate an exam"}), 403

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
        if course_teacher_id is not None and str(teacher_id) != str(course_teacher_id):
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": "Only the course teacher can generate an exam"}), 403

        sid_key = session_row[0]

        # Phase 2: require English translation as the exam source
        cursor.execute(
            """
            SELECT translated_text, translation_status
            FROM session_transcript_meta
            WHERE session_id = %s
            """,
            (sid_key,),
        )
        meta = cursor.fetchone()
        if not meta or meta[1] != "done" or not meta[0]:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": "Translate the transcript to English first before generating the exam."
            }), 400

        translated_text = meta[0].strip()

        import openai_service

        try:
            questions = openai_service.generate_exam_questions(translated_text)
        except RuntimeError as e:
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": str(e)}), 502
        except Exception as e:
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": str(e)}), 500

        # Compute total marks: MCQ/TF/FITB = 1 mark each, short_answer = 2 marks each
        total_marks = sum(2 if q["type"] == "short_answer" else 1 for q in questions)

        title = f"Session Exam ({len(questions)} questions · {total_marks} marks)"
        # Phase 2: add total_marks column to quiz if not present
        try:
            cursor.execute("ALTER TABLE quiz ADD COLUMN IF NOT EXISTS total_marks INT DEFAULT 0")
            conn.commit()
        except Exception:
            conn.rollback()

        cursor.execute(
            """
            INSERT INTO quiz (course_id, session_id, title, created_by_teacher_id)
            VALUES (%s, %s, %s, %s)
            RETURNING quiz_id
            """,
            (course_id, sid_key, title, str(teacher_id)),
        )
        quiz_id = cursor.fetchone()[0]

        # Update total_marks after insert
        cursor.execute(
            "UPDATE quiz SET total_marks = %s WHERE quiz_id = %s",
            (total_marks, quiz_id),
        )

        for i, q in enumerate(questions):
            qtype = q["type"]
            opts = q["options"] or []
            cursor.execute(
                """
                INSERT INTO quiz_question (
                    quiz_id, question_order, question_type, question_text,
                    option_a, option_b, option_c, option_d,
                    correct_index, correct_text
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    quiz_id,
                    i + 1,
                    qtype,
                    q["question_text"],
                    opts[0] if len(opts) > 0 else None,
                    opts[1] if len(opts) > 1 else None,
                    opts[2] if len(opts) > 2 else None,
                    opts[3] if len(opts) > 3 else None,
                    q["correct_index"],
                    q["correct_text"],
                ),
            )
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({
            "success": True,
            "quiz_id": quiz_id,
            "question_count": len(questions),
            "total_marks": total_marks,
        }), 201
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

        # Fetch total_marks from quiz row (may be NULL for old quizzes)
        cursor.execute("SELECT COALESCE(total_marks, 0) FROM quiz WHERE quiz_id = %s", (qid,))
        total_marks_row = cursor.fetchone()
        total_marks = total_marks_row[0] if total_marks_row else 0

        cursor.execute(
            """
            SELECT question_order, question_type, question_text,
                   option_a, option_b, option_c, option_d,
                   correct_index, correct_text
            FROM quiz_question
            WHERE quiz_id = %s
            ORDER BY question_order ASC
            """,
            (qid,),
        )
        rows = cursor.fetchall()
        is_teacher = str(viewer_type or "").lower() == "teacher"
        questions = []
        for r in rows:
            order, qtype, qtext, oa, ob, oc, od, cidx, ctxt = r
            item = {
                "question_order": order,
                "question_type": qtype or "multiple_choice",
                "question_text": qtext,
            }
            # Build options list only for types that have them
            if qtype in ("multiple_choice", "true_false", None, "mcq"):
                item["options"] = [x for x in [oa, ob, oc, od] if x is not None]
            else:
                item["options"] = None

            # Teachers always see the full answer key
            if is_teacher:
                item["correct_index"] = cidx
                item["correct_text"] = ctxt
            # Students: never expose answer key in GET (evaluated on submit)

            questions.append(item)

        # If total_marks was 0 (old exam), recompute it
        if total_marks == 0 and questions:
            total_marks = sum(2 if q["question_type"] == "short_answer" else 1 for q in questions)

        cursor.close()
        conn.close()
        return (
            jsonify(
                {
                    "success": True,
                    "quiz_id": qid,
                    "course_id": course_id,
                    "title": title or "Exam",
                    "total_marks": total_marks,
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
        answers = data.get("answers")  # list of {question_order, answer} dicts
        if not student_id or not str(student_id).strip():
            return jsonify({"success": False, "error": "student_id is required"}), 400
        if not isinstance(answers, list) or not answers:
            return jsonify({"success": False, "error": "answers must be a non-empty list"}), 400

        cursor = conn.cursor()
        quiz_row = _quiz_access_row(cursor, quiz_id)
        if not quiz_row:
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": "Exam not found"}), 404
        _qid, course_id, _title, _teacher_id = quiz_row
        if not _is_enrolled(cursor, course_id, student_id):
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": "Forbidden"}), 403

        cursor.execute(
            """
            SELECT question_order, question_type, correct_index, correct_text, question_text,
                   option_a, option_b, option_c, option_d
            FROM quiz_question
            WHERE quiz_id = %s
            ORDER BY question_order ASC
            """,
            (quiz_id,),
        )
        key_rows = cursor.fetchall()
        if not key_rows:
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": "Exam has no questions"}), 400

        # Build answer map: question_order -> student answer
        answer_map = {}
        for a in answers:
            if isinstance(a, dict):
                try:
                    answer_map[int(a["question_order"])] = a.get("answer")
                except (KeyError, TypeError, ValueError):
                    pass

        if len(answer_map) < len(key_rows):
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": f"Expected {len(key_rows)} answers, got {len(answer_map)}"
            }), 400


        score = 0
        max_marks = 0
        details = []
        sa_to_grade = []

        for kr in key_rows:
            qorder, qtype, cidx, ctxt, qtext, oa, ob, oc, od = kr
            student_answer = answer_map.get(qorder)

            if qtype in ("multiple_choice", "true_false", "mcq"):
                q_max = 1
                max_marks += q_max
                try:
                    selected = int(student_answer)
                except (TypeError, ValueError):
                    selected = -1
                is_correct = (selected == int(cidx)) if cidx is not None else False
                marks_awarded = q_max if is_correct else 0
                score += marks_awarded
                options_list = [x for x in [oa, ob, oc, od] if x is not None]
                correct_display = options_list[cidx] if (cidx is not None and cidx < len(options_list)) else ""
                details.append({
                    "question_order": qorder,
                    "question_type": qtype,
                    "question_text": qtext,
                    "options": options_list,
                    "selected_index": selected if selected >= 0 else None,
                    "correct_index": cidx,
                    "correct_display": correct_display,
                    "is_correct": is_correct,
                    "marks_awarded": marks_awarded,
                    "max_marks": q_max,
                })

            elif qtype == "fill_in_the_blank":
                q_max = 1
                max_marks += q_max
                student_text = str(student_answer or "").strip().lower()
                correct_norm = str(ctxt or "").strip().lower()
                is_correct = (student_text == correct_norm) if student_text and correct_norm else False
                marks_awarded = q_max if is_correct else 0
                score += marks_awarded
                details.append({
                    "question_order": qorder,
                    "question_type": qtype,
                    "question_text": qtext,
                    "options": None,
                    "student_text": str(student_answer or "").strip(),
                    "correct_text": ctxt,
                    "is_correct": is_correct,
                    "marks_awarded": marks_awarded,
                    "max_marks": q_max,
                })

            elif qtype == "short_answer":
                q_max = 2
                max_marks += q_max
                student_text = str(student_answer or "").strip()
                
                # We add to details with 0 marks initially
                details.append({
                    "question_order": qorder,
                    "question_type": qtype,
                    "question_text": qtext,
                    "options": None,
                    "student_text": student_text,
                    "correct_text": ctxt,
                    "is_correct": None,
                    "marks_awarded": 0,
                    "max_marks": q_max,
                    "ai_graded": False,
                    "feedback": None,
                })
                
                if student_text:
                    sa_to_grade.append({
                        "question_order": qorder,
                        "question_text": qtext,
                        "model_answer": ctxt,
                        "student_answer": student_text,
                    })

        # Phase 3: AI Grading for Short Answers
        if sa_to_grade:
            try:
                ai_results = evaluate_short_answers(sa_to_grade)
                # ai_results is a list of { question_order, marks, feedback }
                for ai_res in ai_results:
                    for d in details:
                        if d["question_order"] == ai_res["question_order"] and d["question_type"] == "short_answer":
                            m = ai_res.get("marks", 0)
                            d["marks_awarded"] = m
                            d["ai_graded"] = True
                            d["feedback"] = ai_res.get("feedback")
                            score += m
                            break
            except Exception as e:
                print(f"AI short answer grading failed: {e}")
                # Fallback: keep marks at 0, no feedback.

        percentage = round(100.0 * score / max_marks, 1) if max_marks else 0
        grade = _compute_grade(percentage)
        answers_data_json = json.dumps(details)
        passed = bool(percentage >= 50.0)

        # Persist attempt
        try:
            # Determine next attempt number for this student & quiz
            cursor.execute(
                "SELECT COUNT(*) FROM quiz_attempt WHERE quiz_id = %s AND student_id = %s",
                (quiz_id, str(student_id)),
            )
            prev_count = cursor.fetchone()[0] or 0
            attempt_number = int(prev_count) + 1

            # Accept optional started_at from client
            started_at_raw = data.get("started_at") if isinstance(data, dict) else None
            from datetime import datetime, timezone

            started_at_val = None
            time_taken_seconds = None
            if started_at_raw:
                try:
                    started_dt = datetime.fromisoformat(started_at_raw)
                    if started_dt.tzinfo is None:
                        started_dt = started_dt.replace(tzinfo=timezone.utc)
                    started_at_val = started_dt
                    now_dt = datetime.now(timezone.utc)
                    time_taken_seconds = int((now_dt - started_dt).total_seconds())
                except Exception:
                    started_at_val = None
                    time_taken_seconds = None

            cursor.execute(
                """
                INSERT INTO quiz_attempt (
                    quiz_id, student_id, attempt_number, started_at, completed_at,
                    time_taken_seconds, score, total, percentage, passed, answers,
                    grade, answers_data
                ) VALUES (%s, %s, %s, %s, CURRENT_TIMESTAMP, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING attempt_id, started_at, completed_at
                """,
                (
                    quiz_id, str(student_id), attempt_number, started_at_val,
                    time_taken_seconds, score, max_marks, percentage, passed,
                    json.dumps(answers), grade, answers_data_json
                ),
            )
            inserted = cursor.fetchone()
            conn.commit()
            
            cursor.close()
            conn.close()
            return jsonify({
                "success": True,
                "score": score,
                "total": max_marks,
                "percentage": percentage,
                "grade": grade,
                "details": details,
                "attempt_id": inserted[0] if inserted else None,
                "started_at": inserted[1].isoformat() if inserted and inserted[1] else None,
                "completed_at": inserted[2].isoformat() if inserted and inserted[2] else None,
                "passed": passed,
            }), 200

        except Exception as e:
            try:
                conn.rollback()
            except Exception:
                pass
            try:
                cursor.close()
            except Exception:
                pass
            try:
                conn.close()
            except Exception:
                pass
            return jsonify({"success": False, "error": str(e)}), 500

    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        return jsonify({"success": False, "error": str(e)}), 500
