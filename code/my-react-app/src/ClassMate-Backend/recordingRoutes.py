# recordingRoutes.py
"""Meeting recordings: the teacher records a session in the browser and uploads
it here. Recordings are private until the teacher shares them; enrolled students
can then view (stream) or download shared recordings for that session."""

from flask import Blueprint, jsonify, request, send_file
import os
import mimetypes
import traceback
from werkzeug.utils import secure_filename

from db import getDbConnection

recording_bp = Blueprint('recording', __name__)

ALLOWED_EXTENSIONS = {'webm', 'mp4', 'mkv', 'ogg', 'mov'}
MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024  # 2GB

BASE_UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'uploads')


def _ensure_recording_table(cursor):
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS session_recording (
            recording_id SERIAL PRIMARY KEY,
            session_id TEXT,
            course_id VARCHAR(64),
            title TEXT,
            file_name TEXT,
            file_path TEXT,
            file_size BIGINT,
            file_type TEXT,
            duration_seconds INT,
            created_by VARCHAR(64),
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            is_shared BOOLEAN DEFAULT FALSE,
            is_active BOOLEAN DEFAULT TRUE
        )
        """
    )


def _session_course(cursor, session_id):
    cursor.execute(
        "SELECT session_id::text, course_id::text FROM class_session WHERE session_id::text = %s",
        (str(session_id),),
    )
    return cursor.fetchone()


def _teacher_owns_course(cursor, course_id, teacher_id):
    cursor.execute(
        "SELECT 1 FROM course WHERE course_id::text = %s AND teacher_id = %s",
        (str(course_id), str(teacher_id)),
    )
    return cursor.fetchone() is not None


def _is_enrolled(cursor, course_id, student_id):
    cursor.execute(
        """
        SELECT 1 FROM enrollment
        WHERE course_id::text = %s AND student_id = %s AND COALESCE(is_active, true)
        """,
        (str(course_id), str(student_id)),
    )
    return cursor.fetchone() is not None


def _serialize(row):
    (recording_id, session_id, course_id, title, file_name, file_size,
     file_type, duration_seconds, created_by, created_at, is_shared) = row
    return {
        "recording_id": recording_id,
        "session_id": session_id,
        "course_id": course_id,
        "title": title,
        "file_name": file_name,
        "file_size": file_size,
        "file_type": file_type,
        "duration_seconds": duration_seconds,
        "created_by": created_by,
        "created_at": created_at.isoformat() if created_at else None,
        "is_shared": bool(is_shared),
        "stream_url": f"/api/recordings/{recording_id}/stream",
        "download_url": f"/api/recordings/{recording_id}/download",
    }


@recording_bp.route('/api/sessions/<session_id>/recordings', methods=['POST'])
def upload_recording(session_id):
    """Teacher uploads a browser-captured recording for a session."""
    conn = getDbConnection()
    if not conn:
        return jsonify({"success": False, "error": "Database connection failed"}), 500
    try:
        cursor = conn.cursor()
        _ensure_recording_table(cursor)
        conn.commit()

        teacher_id = request.form.get('teacher_id')
        if not teacher_id:
            cursor.close(); conn.close()
            return jsonify({"success": False, "error": "Only a teacher can upload recordings."}), 401

        sess = _session_course(cursor, session_id)
        if not sess:
            cursor.close(); conn.close()
            return jsonify({"success": False, "error": "Session not found."}), 404
        sid_key, course_id = sess

        if not _teacher_owns_course(cursor, course_id, teacher_id):
            cursor.close(); conn.close()
            return jsonify({"success": False, "error": "You do not own this course."}), 403

        file = request.files.get('file')
        if not file or not file.filename:
            cursor.close(); conn.close()
            return jsonify({"success": False, "error": "No recording file provided."}), 400

        ext = file.filename.rsplit('.', 1)[1].lower() if '.' in file.filename else 'webm'
        if ext not in ALLOWED_EXTENSIONS:
            ext = 'webm'

        file.seek(0, 2)
        file_size = file.tell()
        file.seek(0)
        if file_size > MAX_FILE_SIZE:
            cursor.close(); conn.close()
            return jsonify({"success": False, "error": "Recording is too large."}), 400

        title = (request.form.get('title') or '').strip()
        duration = request.form.get('duration_seconds')
        try:
            duration = int(float(duration)) if duration else None
        except (TypeError, ValueError):
            duration = None

        course_folder = os.path.join(BASE_UPLOAD_FOLDER, 'recordings', str(course_id))
        os.makedirs(course_folder, exist_ok=True)

        from datetime import datetime as _dt
        stamp = int(_dt.now().timestamp() * 1000)
        disk_name = secure_filename(f"recording_{sid_key}_{stamp}.{ext}")
        file_path = os.path.join(course_folder, disk_name)
        file.save(file_path)

        file_type = mimetypes.guess_type(disk_name)[0] or f'video/{ext}'
        if not title:
            title = f"Recording — {_dt.now().strftime('%d %b %Y, %H:%M')}"

        cursor.execute(
            """
            INSERT INTO session_recording (
                session_id, course_id, title, file_name, file_path, file_size,
                file_type, duration_seconds, created_by, created_at, is_shared, is_active
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW(),FALSE,TRUE)
            RETURNING recording_id, created_at
            """,
            (sid_key, course_id, title, file.filename, file_path, file_size,
             file_type, duration, str(teacher_id)),
        )
        rec_id, created_at = cursor.fetchone()
        conn.commit()
        cursor.close()
        conn.close()

        return jsonify({
            "success": True,
            "message": "Recording uploaded.",
            "recording_id": rec_id,
            "created_at": created_at.isoformat() if created_at else None,
        }), 201
    except Exception as e:
        try:
            conn.rollback(); conn.close()
        except Exception:
            pass
        print(f"[ERROR] upload_recording: {e}")
        traceback.print_exc()
        return jsonify({"success": False, "error": f"Failed to upload recording: {str(e)}"}), 500


@recording_bp.route('/api/sessions/<session_id>/recordings', methods=['GET'])
def list_session_recordings(session_id):
    """List recordings for a session. Teachers see all; students see only shared ones."""
    viewer_type = str(request.args.get('viewer_type') or '').lower()
    viewer_id = request.args.get('viewer_id')

    conn = getDbConnection()
    if not conn:
        return jsonify({"success": False, "error": "Database connection failed"}), 500
    try:
        cursor = conn.cursor()
        _ensure_recording_table(cursor)
        conn.commit()

        sess = _session_course(cursor, session_id)
        if not sess:
            cursor.close(); conn.close()
            return jsonify({"success": True, "recordings": []}), 200
        sid_key, course_id = sess

        is_teacher = viewer_type == 'teacher' and viewer_id and _teacher_owns_course(cursor, course_id, viewer_id)

        if is_teacher:
            cursor.execute(
                """
                SELECT recording_id, session_id, course_id, title, file_name, file_size,
                       file_type, duration_seconds, created_by, created_at, is_shared
                FROM session_recording
                WHERE session_id::text = %s AND is_active = TRUE
                ORDER BY created_at DESC
                """,
                (str(sid_key),),
            )
        else:
            cursor.execute(
                """
                SELECT recording_id, session_id, course_id, title, file_name, file_size,
                       file_type, duration_seconds, created_by, created_at, is_shared
                FROM session_recording
                WHERE session_id::text = %s AND is_active = TRUE AND is_shared = TRUE
                ORDER BY created_at DESC
                """,
                (str(sid_key),),
            )
        rows = cursor.fetchall()
        cursor.close()
        conn.close()
        return jsonify({"success": True, "recordings": [_serialize(r) for r in rows]}), 200
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        print(f"[ERROR] list_session_recordings: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@recording_bp.route('/api/recordings/<int:recording_id>/share', methods=['PUT'])
def toggle_share_recording(recording_id):
    """Teacher shares/unshares a recording with students."""
    conn = getDbConnection()
    if not conn:
        return jsonify({"success": False, "error": "Database connection failed"}), 500
    try:
        data = request.get_json(silent=True) or {}
        teacher_id = data.get('teacher_id')
        shared = bool(data.get('shared', True))
        if not teacher_id:
            conn.close()
            return jsonify({"success": False, "error": "teacher_id is required."}), 400

        cursor = conn.cursor()
        _ensure_recording_table(cursor)
        conn.commit()

        cursor.execute(
            """
            UPDATE session_recording r
            SET is_shared = %s
            FROM course c
            WHERE r.recording_id = %s
              AND r.course_id::text = c.course_id::text
              AND c.teacher_id = %s
            RETURNING r.recording_id
            """,
            (shared, recording_id, str(teacher_id)),
        )
        updated = cursor.fetchone()
        conn.commit()
        cursor.close()
        conn.close()
        if not updated:
            return jsonify({"success": False, "error": "Recording not found or not owned by you."}), 404
        return jsonify({"success": True, "is_shared": shared}), 200
    except Exception as e:
        try:
            conn.rollback(); conn.close()
        except Exception:
            pass
        print(f"[ERROR] toggle_share_recording: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


def _fetch_recording_file(recording_id):
    conn = getDbConnection()
    if not conn:
        return None, None, None, ("Database connection failed", 500)
    try:
        cursor = conn.cursor()
        _ensure_recording_table(cursor)
        conn.commit()
        cursor.execute(
            "SELECT file_name, file_path, file_type FROM session_recording WHERE recording_id = %s AND is_active = TRUE",
            (recording_id,),
        )
        row = cursor.fetchone()
        cursor.close()
        conn.close()
        if not row or not row[1]:
            return None, None, None, ("Recording not found.", 404)
        file_name, file_path, file_type = row
        if not os.path.exists(file_path):
            return None, None, None, ("File not found on server.", 404)
        return file_name, file_path, file_type, None
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        return None, None, None, (str(e), 500)


@recording_bp.route('/api/recordings/<int:recording_id>/stream', methods=['GET'])
def stream_recording(recording_id):
    """Serve a recording inline (supports range requests for in-browser playback)."""
    file_name, file_path, file_type, err = _fetch_recording_file(recording_id)
    if err:
        return jsonify({"success": False, "error": err[0]}), err[1]
    return send_file(file_path, mimetype=file_type or 'video/webm', conditional=True)


@recording_bp.route('/api/recordings/<int:recording_id>/download', methods=['GET'])
def download_recording(recording_id):
    """Download a recording as an attachment."""
    file_name, file_path, file_type, err = _fetch_recording_file(recording_id)
    if err:
        return jsonify({"success": False, "error": err[0]}), err[1]
    return send_file(
        file_path,
        as_attachment=True,
        download_name=file_name,
        mimetype=file_type or 'video/webm',
    )


@recording_bp.route('/api/recordings/<int:recording_id>', methods=['DELETE'])
def delete_recording(recording_id):
    """Teacher soft-deletes a recording."""
    conn = getDbConnection()
    if not conn:
        return jsonify({"success": False, "error": "Database connection failed"}), 500
    try:
        data = request.get_json(silent=True) or {}
        teacher_id = data.get('teacher_id') or request.args.get('teacher_id')
        if not teacher_id:
            conn.close()
            return jsonify({"success": False, "error": "teacher_id is required."}), 400

        cursor = conn.cursor()
        _ensure_recording_table(cursor)
        conn.commit()
        cursor.execute(
            """
            UPDATE session_recording r
            SET is_active = FALSE
            FROM course c
            WHERE r.recording_id = %s
              AND r.course_id::text = c.course_id::text
              AND c.teacher_id = %s
            RETURNING r.recording_id
            """,
            (recording_id, str(teacher_id)),
        )
        deleted = cursor.fetchone()
        conn.commit()
        cursor.close()
        conn.close()
        if not deleted:
            return jsonify({"success": False, "error": "Recording not found or not owned by you."}), 404
        return jsonify({"success": True}), 200
    except Exception as e:
        try:
            conn.rollback(); conn.close()
        except Exception:
            pass
        print(f"[ERROR] delete_recording: {e}")
        return jsonify({"success": False, "error": str(e)}), 500
