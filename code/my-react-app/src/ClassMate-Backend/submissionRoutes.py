"""Student assignment submissions and teacher grading."""

from flask import Blueprint, jsonify, request, send_file
import os
import traceback
from datetime import datetime
from werkzeug.utils import secure_filename
from db import getDbConnection

submission_bp = Blueprint('submission', __name__)

ALLOWED_EXTENSIONS = {'pdf', 'doc', 'docx', 'txt', 'jpg', 'jpeg', 'png', 'zip', 'rar', 'ppt', 'pptx'}
MAX_SIZE = 50 * 1024 * 1024
BASE_UPLOAD = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'uploads')


def _ensure_tables(cursor):
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS assignment_submission (
            submission_id SERIAL PRIMARY KEY,
            assignment_id INT NOT NULL,
            student_id VARCHAR(64) NOT NULL,
            file_name TEXT,
            file_path TEXT,
            file_size BIGINT,
            file_type TEXT,
            submitted_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            marks_obtained NUMERIC,
            total_marks NUMERIC,
            feedback TEXT,
            graded_at TIMESTAMPTZ,
            graded_by VARCHAR(64),
            UNIQUE(assignment_id, student_id)
        )
    """)


@submission_bp.route('/api/assignments/<int:assignment_id>/submit', methods=['POST'])
def submit_assignment(assignment_id):
    conn = getDbConnection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database connection failed'}), 500
    try:
        cursor = conn.cursor()
        _ensure_tables(cursor)
        conn.commit()

        student_id = request.form.get('student_id')
        if not student_id:
            cursor.close(); conn.close()
            return jsonify({'success': False, 'error': 'student_id required'}), 401

        cursor.execute(
            "SELECT assignment_id FROM assignment WHERE assignment_id = %s AND is_active = TRUE",
            (assignment_id,)
        )
        if not cursor.fetchone():
            cursor.close(); conn.close()
            return jsonify({'success': False, 'error': 'Assignment not found'}), 404

        cursor.execute(
            "SELECT submission_id FROM assignment_submission WHERE assignment_id = %s AND student_id = %s",
            (assignment_id, student_id)
        )
        if cursor.fetchone():
            cursor.close(); conn.close()
            return jsonify({'success': False, 'error': 'You have already submitted this assignment'}), 409

        file_name = file_path = file_type = None
        file_size = None

        file = request.files.get('file')
        if file and file.filename:
            orig = secure_filename(file.filename)
            ext = orig.rsplit('.', 1)[1].lower() if '.' in orig else ''
            if ext not in ALLOWED_EXTENSIONS:
                cursor.close(); conn.close()
                return jsonify({'success': False, 'error': 'File type not allowed'}), 400
            file.seek(0, 2); file_size = file.tell(); file.seek(0)
            if file_size > MAX_SIZE:
                cursor.close(); conn.close()
                return jsonify({'success': False, 'error': 'File too large (max 50MB)'}), 400
            folder = os.path.join(BASE_UPLOAD, 'submissions', str(assignment_id))
            os.makedirs(folder, exist_ok=True)
            disk = f"{int(datetime.now().timestamp() * 1000)}_{student_id}_{orig}"
            file_path = os.path.join(folder, disk)
            file.save(file_path)
            file_name = orig
            file_type = file.content_type or 'application/octet-stream'

        cursor.execute("""
            INSERT INTO assignment_submission
                (assignment_id, student_id, file_name, file_path, file_size, file_type)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING submission_id, submitted_at
        """, (assignment_id, student_id, file_name, file_path, file_size, file_type))
        sub_id, sub_at = cursor.fetchone()
        conn.commit()
        cursor.close(); conn.close()
        return jsonify({'success': True, 'submission_id': sub_id, 'submitted_at': sub_at.isoformat()}), 201
    except Exception as e:
        try:
            conn.rollback(); conn.close()
        except Exception:
            pass
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@submission_bp.route('/api/assignments/<int:assignment_id>/submissions', methods=['GET'])
def list_submissions(assignment_id):
    conn = getDbConnection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database connection failed'}), 500
    try:
        cursor = conn.cursor()
        _ensure_tables(cursor)
        conn.commit()
        cursor.execute("""
            SELECT s.submission_id, s.assignment_id, s.student_id, st.name,
                   s.file_name, s.file_size, s.file_type, s.submitted_at,
                   s.marks_obtained, s.total_marks, s.feedback, s.graded_at, s.graded_by
            FROM assignment_submission s
            JOIN student st ON st.student_id = s.student_id
            WHERE s.assignment_id = %s
            ORDER BY s.submitted_at DESC
        """, (assignment_id,))
        rows = cursor.fetchall()
        out = []
        for r in rows:
            out.append({
                'submission_id': r[0],
                'assignment_id': r[1],
                'student_id': r[2],
                'student_name': r[3],
                'file_name': r[4],
                'file_size': r[5],
                'has_file': bool(r[4]),
                'submitted_at': r[7].isoformat() if r[7] else None,
                'marks_obtained': float(r[8]) if r[8] is not None else None,
                'total_marks': float(r[9]) if r[9] is not None else None,
                'feedback': r[10] or '',
                'graded_at': r[11].isoformat() if r[11] else None,
                'download_url': f'/api/submissions/{r[0]}/file' if r[4] else None,
            })
        cursor.close(); conn.close()
        return jsonify({'success': True, 'submissions': out, 'count': len(out)}), 200
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        return jsonify({'success': False, 'error': str(e)}), 500


@submission_bp.route('/api/submissions/<int:submission_id>/file', methods=['GET'])
def serve_submission_file(submission_id):
    conn = getDbConnection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database connection failed'}), 500
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT file_path, file_name, file_type FROM assignment_submission WHERE submission_id = %s",
            (submission_id,)
        )
        row = cursor.fetchone()
        cursor.close(); conn.close()
        if not row or not row[0]:
            return jsonify({'success': False, 'error': 'File not found'}), 404
        if not os.path.exists(row[0]):
            return jsonify({'success': False, 'error': 'File missing on server'}), 404
        return send_file(row[0], as_attachment=True, download_name=row[1],
                         mimetype=row[2] or 'application/octet-stream')
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        return jsonify({'success': False, 'error': str(e)}), 500


@submission_bp.route('/api/submissions/<int:submission_id>/grade', methods=['PATCH'])
def grade_submission(submission_id):
    conn = getDbConnection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database connection failed'}), 500
    try:
        data = request.get_json(silent=True) or {}
        teacher_id = data.get('teacher_id')
        if not teacher_id:
            conn.close()
            return jsonify({'success': False, 'error': 'teacher_id required'}), 401
        marks_obtained = data.get('marks_obtained')
        total_marks = data.get('total_marks')
        feedback = data.get('feedback', '')

        cursor = conn.cursor()
        cursor.execute("""
            UPDATE assignment_submission
            SET marks_obtained = %s, total_marks = %s, feedback = %s,
                graded_at = NOW(), graded_by = %s
            WHERE submission_id = %s
            RETURNING submission_id
        """, (marks_obtained, total_marks, feedback, teacher_id, submission_id))
        if not cursor.fetchone():
            cursor.close(); conn.close()
            return jsonify({'success': False, 'error': 'Submission not found'}), 404
        conn.commit()
        cursor.close(); conn.close()
        return jsonify({'success': True, 'message': 'Grade saved'}), 200
    except Exception as e:
        try:
            conn.rollback(); conn.close()
        except Exception:
            pass
        return jsonify({'success': False, 'error': str(e)}), 500


@submission_bp.route('/api/student/<student_id>/pending-work', methods=['GET'])
def get_pending_work(student_id):
    """Return all pending quizzes and assignments for a student (not yet attempted/submitted)."""
    conn = getDbConnection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database connection failed'}), 500
    try:
        cursor = conn.cursor()
        _ensure_tables(cursor)

        cursor.execute("""
            SELECT q.quiz_id, q.title, q.due_date, q.course_id, q.session_id,
                   c.course_code, c.title as course_title, cs.title as session_title,
                   t.name as teacher_name
            FROM quiz q
            JOIN enrollment e ON e.course_id::text = q.course_id::text
                 AND e.student_id = %s AND COALESCE(e.is_active, true)
            LEFT JOIN course c ON c.course_id::text = q.course_id::text
            LEFT JOIN class_session cs ON cs.session_id::text = q.session_id::text
            LEFT JOIN teacher t ON t.teacher_id = c.teacher_id
            WHERE (q.due_date IS NULL OR q.due_date > NOW())
              AND NOT EXISTS (
                  SELECT 1 FROM quiz_attempt qa
                  WHERE qa.quiz_id = q.quiz_id AND qa.student_id = %s
              )
            ORDER BY (q.due_date IS NULL), q.due_date ASC
        """, (student_id, student_id))

        pending_quizzes = []
        for r in cursor.fetchall():
            pending_quizzes.append({
                'type': 'quiz',
                'quiz_id': r[0],
                'title': r[1],
                'due_date': r[2].isoformat() if r[2] else None,
                'course_id': r[3],
                'session_id': r[4],
                'course_code': r[5] or '',
                'course_title': r[6] or '',
                'session_title': r[7] or '',
                'teacher_name': r[8] or '',
            })

        cursor.execute("""
            SELECT a.assignment_id, a.title, a.description, a.due_date, a.course_id,
                   c.course_code, c.title as course_title, t.name as teacher_name,
                   a.file_name
            FROM assignment a
            JOIN enrollment e ON e.course_id::text = a.course_id::text
                 AND e.student_id = %s AND COALESCE(e.is_active, true)
            LEFT JOIN course c ON c.course_id::text = a.course_id::text
            LEFT JOIN teacher t ON t.teacher_id = c.teacher_id
            WHERE a.is_active = TRUE
              AND (a.due_date IS NULL OR a.due_date > NOW())
              AND NOT EXISTS (
                  SELECT 1 FROM assignment_submission sub
                  WHERE sub.assignment_id = a.assignment_id AND sub.student_id = %s
              )
            ORDER BY (a.due_date IS NULL), a.due_date ASC
        """, (student_id, student_id))

        pending_assignments = []
        for r in cursor.fetchall():
            aid = r[0]
            pending_assignments.append({
                'type': 'assignment',
                'assignment_id': aid,
                'title': r[1],
                'description': r[2] or '',
                'due_date': r[3].isoformat() if r[3] else None,
                'course_id': r[4],
                'course_code': r[5] or '',
                'course_title': r[6] or '',
                'teacher_name': r[7] or '',
                'has_teacher_file': bool(r[8]),
                'teacher_file_url': f'/api/assignments/{aid}/download' if r[8] else None,
            })

        cursor.close(); conn.close()
        return jsonify({
            'success': True,
            'pending_quizzes': pending_quizzes,
            'pending_assignments': pending_assignments,
        }), 200
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@submission_bp.route('/api/student/<student_id>/my-submissions', methods=['GET'])
def get_my_submissions(student_id):
    """Return all assignment submissions made by the student, with grades if available."""
    conn = getDbConnection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database connection failed'}), 500
    try:
        cursor = conn.cursor()
        _ensure_tables(cursor)
        cursor.execute("""
            SELECT s.submission_id, s.assignment_id, a.title, a.course_id, a.due_date,
                   c.course_code, s.file_name, s.submitted_at,
                   s.marks_obtained, s.total_marks, s.feedback, s.graded_at
            FROM assignment_submission s
            JOIN assignment a ON a.assignment_id = s.assignment_id
            LEFT JOIN course c ON c.course_id::text = a.course_id::text
            WHERE s.student_id = %s
            ORDER BY s.submitted_at DESC
        """, (student_id,))
        out = []
        for r in cursor.fetchall():
            out.append({
                'submission_id': r[0],
                'assignment_id': r[1],
                'title': r[2],
                'course_id': r[3],
                'due_date': r[4].isoformat() if r[4] else None,
                'course_code': r[5] or '',
                'file_name': r[6],
                'submitted_at': r[7].isoformat() if r[7] else None,
                'marks_obtained': float(r[8]) if r[8] is not None else None,
                'total_marks': float(r[9]) if r[9] is not None else None,
                'feedback': r[10] or '',
                'graded_at': r[11].isoformat() if r[11] else None,
                'graded': r[8] is not None,
            })
        cursor.close(); conn.close()
        return jsonify({'success': True, 'submissions': out}), 200
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        return jsonify({'success': False, 'error': str(e)}), 500


@submission_bp.route('/api/courses/<course_id>/student-results', methods=['GET'])
def get_course_student_results(course_id):
    """Teacher view: all student quiz attempts and assignment submissions for a course."""
    conn = getDbConnection()
    if not conn:
        return jsonify({'success': False, 'error': 'Database connection failed'}), 500
    try:
        cursor = conn.cursor()
        _ensure_tables(cursor)

        cursor.execute("""
            SELECT s.student_id, s.name, s.email
            FROM enrollment e
            JOIN student s ON s.student_id = e.student_id
            WHERE e.course_id::text = %s AND COALESCE(e.is_active, true)
            ORDER BY s.name
        """, (str(course_id),))
        students = {}
        for r in cursor.fetchall():
            students[r[0]] = {
                'student_id': r[0], 'name': r[1], 'email': r[2],
                'quiz_attempts': [], 'assignment_submissions': []
            }

        cursor.execute("""
            SELECT qa.student_id, q.title, q.quiz_id, qa.score, qa.percentage,
                   qa.passed, qa.completed_at, cs.title as session_title
            FROM quiz_attempt qa
            JOIN quiz q ON q.quiz_id = qa.quiz_id
            LEFT JOIN class_session cs ON cs.session_id::text = q.session_id::text
            WHERE q.course_id::text = %s
            ORDER BY qa.completed_at DESC
        """, (str(course_id),))
        for r in cursor.fetchall():
            sid = r[0]
            if sid in students:
                students[sid]['quiz_attempts'].append({
                    'quiz_title': r[1],
                    'quiz_id': r[2],
                    'score': float(r[3]) if r[3] is not None else 0,
                    'percentage': float(r[4]) if r[4] is not None else 0,
                    'passed': bool(r[5]),
                    'completed_at': r[6].isoformat() if r[6] else None,
                    'session_title': r[7] or '',
                })

        cursor.execute("""
            SELECT s.student_id, a.title, a.assignment_id, s.submission_id,
                   s.submitted_at, s.marks_obtained, s.total_marks, s.feedback, s.graded_at
            FROM assignment_submission s
            JOIN assignment a ON a.assignment_id = s.assignment_id
            WHERE a.course_id::text = %s
            ORDER BY s.submitted_at DESC
        """, (str(course_id),))
        for r in cursor.fetchall():
            sid = r[0]
            if sid in students:
                students[sid]['assignment_submissions'].append({
                    'assignment_title': r[1],
                    'assignment_id': r[2],
                    'submission_id': r[3],
                    'submitted_at': r[4].isoformat() if r[4] else None,
                    'marks_obtained': float(r[5]) if r[5] is not None else None,
                    'total_marks': float(r[6]) if r[6] is not None else None,
                    'feedback': r[7] or '',
                    'graded_at': r[8].isoformat() if r[8] else None,
                    'graded': r[5] is not None,
                    'download_url': f'/api/submissions/{r[3]}/file',
                })

        cursor.close(); conn.close()
        return jsonify({'success': True, 'students': list(students.values())}), 200
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500
