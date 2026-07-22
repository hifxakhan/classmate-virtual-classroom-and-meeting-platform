# assignmentRoutes.py
"""Course assignments: teachers upload an assignment (with an optional file and a
due date); enrolled students view and download it."""

from flask import Blueprint, jsonify, request, send_file
import os
import mimetypes
import traceback
from datetime import datetime
from werkzeug.utils import secure_filename

from db import getDbConnection
from notificationRoutes import notify_course_students, notify_one

assignment_bp = Blueprint('assignment', __name__)

ALLOWED_EXTENSIONS = {
    'pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx',
    'txt', 'jpg', 'jpeg', 'png', 'gif', 'zip', 'rar', '7z',
}
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB

BASE_UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'uploads')


def _allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def _ensure_assignment_table(cursor):
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS assignment (
            assignment_id SERIAL PRIMARY KEY,
            course_id VARCHAR(64) NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            due_date TIMESTAMPTZ,
            file_name TEXT,
            file_path TEXT,
            file_size BIGINT,
            file_type TEXT,
            created_by VARCHAR(64),
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            is_active BOOLEAN DEFAULT TRUE
        )
        """
    )


def _serialize(row):
    (assignment_id, course_id, title, description, due_date, file_name,
     file_size, file_type, created_by, created_at) = row
    return {
        "assignment_id": assignment_id,
        "course_id": course_id,
        "title": title,
        "description": description or "",
        "due_date": due_date.isoformat() if due_date else None,
        "file_name": file_name,
        "file_size": file_size,
        "file_type": file_type,
        "created_by": created_by,
        "created_at": created_at.isoformat() if created_at else None,
        "has_file": bool(file_name),
        "download_url": f"/api/assignments/{assignment_id}/download" if file_name else None,
    }


@assignment_bp.route('/api/courses/<course_id>/assignments', methods=['POST'])
def create_assignment(course_id):
    """Teacher creates an assignment for a course (optionally with an attached file)."""
    conn = getDbConnection()
    if not conn:
        return jsonify({"success": False, "error": "Database connection failed"}), 500
    try:
        cursor = conn.cursor()
        _ensure_assignment_table(cursor)
        conn.commit()

        teacher_id = request.form.get('teacher_id')
        title = (request.form.get('title') or '').strip()
        description = (request.form.get('description') or '').strip()
        due_date = (request.form.get('due_date') or '').strip() or None

        if not teacher_id:
            cursor.close(); conn.close()
            return jsonify({"success": False, "error": "You must be logged in as a teacher."}), 401
        if not title:
            cursor.close(); conn.close()
            return jsonify({"success": False, "error": "Assignment title is required."}), 400

        # Verify the teacher owns this course.
        cursor.execute(
            """
            SELECT 1 FROM teacher t
            INNER JOIN course c ON t.teacher_id = c.teacher_id
            WHERE t.teacher_id = %s AND c.course_id::text = %s
            """,
            (teacher_id, str(course_id)),
        )
        if not cursor.fetchone():
            cursor.close(); conn.close()
            return jsonify({"success": False, "error": "Teacher not found or does not own this course."}), 403

        file_name = None
        file_path = None
        file_size = None
        file_type = None

        file = request.files.get('file')
        if file and file.filename:
            if not _allowed_file(file.filename):
                cursor.close(); conn.close()
                return jsonify({
                    "success": False,
                    "error": f"File type not allowed. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
                }), 400

            file.seek(0, 2)
            file_size = file.tell()
            file.seek(0)
            if file_size > MAX_FILE_SIZE:
                cursor.close(); conn.close()
                return jsonify({
                    "success": False,
                    "error": f"File too large. Maximum size: {MAX_FILE_SIZE // (1024 * 1024)}MB",
                }), 400

            original_filename = secure_filename(file.filename)
            ext = original_filename.rsplit('.', 1)[1].lower() if '.' in original_filename else ''
            course_folder = os.path.join(BASE_UPLOAD_FOLDER, 'assignments', str(course_id))
            os.makedirs(course_folder, exist_ok=True)

            # Reserve an id-less unique name using timestamp to avoid collisions.
            disk_name = f"{int(datetime.now().timestamp() * 1000)}_{original_filename}"
            file_path = os.path.join(course_folder, disk_name)
            file.save(file_path)
            file_name = original_filename
            file_type = mimetypes.guess_type(original_filename)[0] or 'application/octet-stream'

        cursor.execute(
            """
            INSERT INTO assignment (
                course_id, title, description, due_date,
                file_name, file_path, file_size, file_type,
                created_by, created_at, is_active
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), TRUE)
            RETURNING assignment_id, created_at
            """,
            (str(course_id), title, description, due_date,
             file_name, file_path, file_size, file_type, str(teacher_id)),
        )
        new_id, created_at = cursor.fetchone()
        due_str = f" (due {due_date[:10]})" if due_date else ""
        notify_course_students(
            cursor, course_id,
            title=f"New Assignment: {title}",
            message=f"Your teacher posted a new assignment'{title}'{due_str}.",
            notif_type='assignment', ref_id=new_id, ref_type='assignment'
        )
        conn.commit()
        cursor.close()
        conn.close()

        return jsonify({
            "success": True,
            "message": "Assignment created successfully.",
            "assignment": {
                "assignment_id": new_id,
                "course_id": str(course_id),
                "title": title,
                "description": description,
                "due_date": due_date,
                "file_name": file_name,
                "file_size": file_size,
                "file_type": file_type,
                "created_by": str(teacher_id),
                "created_at": created_at.isoformat() if created_at else None,
                "has_file": bool(file_name),
                "download_url": f"/api/assignments/{new_id}/download" if file_name else None,
            },
        }), 201
    except Exception as e:
        try:
            conn.rollback(); conn.close()
        except Exception:
            pass
        print(f"[ERROR] create_assignment: {e}")
        traceback.print_exc()
        return jsonify({"success": False, "error": f"Failed to create assignment: {str(e)}"}), 500


@assignment_bp.route('/api/courses/<course_id>/assignments', methods=['GET'])
def list_assignments(course_id):
    """List active assignments for a course (teacher and students)."""
    conn = getDbConnection()
    if not conn:
        return jsonify({"success": False, "error": "Database connection failed"}), 500
    try:
        cursor = conn.cursor()
        _ensure_assignment_table(cursor)
        conn.commit()

        cursor.execute(
            """
            SELECT assignment_id, course_id, title, description, due_date,
                   file_name, file_size, file_type, created_by, created_at
            FROM assignment
            WHERE course_id::text = %s AND is_active = TRUE
            ORDER BY (due_date IS NULL), due_date ASC, created_at DESC
            """,
            (str(course_id),),
        )
        rows = cursor.fetchall()
        assignments = [_serialize(r) for r in rows]
        cursor.close()
        conn.close()
        return jsonify({"success": True, "assignments": assignments, "count": len(assignments)}), 200
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        print(f"[ERROR] list_assignments: {e}")
        return jsonify({"success": False, "error": f"Failed to list assignments: {str(e)}"}), 500


@assignment_bp.route('/api/assignments/<int:assignment_id>/download', methods=['GET'])
def download_assignment(assignment_id):
    """Download an assignment's attached file."""
    conn = getDbConnection()
    if not conn:
        return jsonify({"success": False, "error": "Database connection failed"}), 500
    try:
        cursor = conn.cursor()
        _ensure_assignment_table(cursor)
        conn.commit()

        cursor.execute(
            """SELECT a.file_name, a.file_path, a.file_type, a.title, c.teacher_id, st.name as student_name
               FROM assignment a
               JOIN course c ON c.course_id::text = a.course_id::text
               LEFT JOIN student st ON st.student_id = %s
               WHERE a.assignment_id = %s AND a.is_active = TRUE""",
            (request.args.get('student_id', ''), assignment_id),
        )
        row = cursor.fetchone()
        if row and row[4]:
            student_name = row[5] or 'A student'
            notify_one(cursor, row[4], 'teacher',
                       title=f"{student_name} downloaded an assignment",
                       message=f"'{row[3]}' was downloaded.",
                       notif_type='download', ref_id=assignment_id, ref_type='assignment')
            conn.commit()
        cursor.close()
        conn.close()

        if not row or not row[1]:
            return jsonify({"success": False, "error": "Assignment file not found."}), 404

        file_name, file_path, file_type = row[0], row[1], row[2]
        if not os.path.exists(file_path):
            return jsonify({"success": False, "error": "File not found on server."}), 404

        return send_file(
            file_path,
            as_attachment=True,
            download_name=file_name,
            mimetype=file_type or 'application/octet-stream',
        )
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        print(f"[ERROR] download_assignment: {e}")
        return jsonify({"success": False, "error": f"Failed to download: {str(e)}"}), 500


@assignment_bp.route('/api/assignments/<int:assignment_id>', methods=['DELETE'])
def delete_assignment(assignment_id):
    """Soft-delete an assignment (teacher who owns the course)."""
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
        _ensure_assignment_table(cursor)
        conn.commit()

        cursor.execute(
            """
            UPDATE assignment a
            SET is_active = FALSE
            FROM course c
            WHERE a.assignment_id = %s
              AND a.course_id::text = c.course_id::text
              AND c.teacher_id = %s
            RETURNING a.assignment_id
            """,
            (assignment_id, str(teacher_id)),
        )
        deleted = cursor.fetchone()
        conn.commit()
        cursor.close()
        conn.close()

        if not deleted:
            return jsonify({"success": False, "error": "Assignment not found or not owned by you."}), 404
        return jsonify({"success": True, "message": "Assignment deleted."}), 200
    except Exception as e:
        try:
            conn.rollback(); conn.close()
        except Exception:
            pass
        print(f"[ERROR] delete_assignment: {e}")
        return jsonify({"success": False, "error": f"Failed to delete: {str(e)}"}), 500
