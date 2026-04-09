from flask import Blueprint, jsonify, request
from datetime import datetime
import psycopg2
import os
from dotenv import load_dotenv

load_dotenv()

attendance_bp = Blueprint('attendance', __name__)


def _to_int(value, field_name):
    try:
        return int(value)
    except (TypeError, ValueError):
        raise ValueError(f"{field_name} must be a valid integer")


def _validate_session_student_payload(data):
    if not isinstance(data, dict):
        raise ValueError('JSON request body is required')

    session_id = _to_int(data.get('session_id'), 'session_id')
    student_id = str(data.get('student_id') or '').strip()

    if not student_id:
        raise ValueError('student_id is required')

    return session_id, student_id


def _mark_join(cursor, session_id, student_id):
    cursor.execute(
        """
        SELECT attendance_id, joined_at
        FROM attendance
        WHERE session_id = %s
          AND student_id = %s
          AND left_at IS NULL
        ORDER BY joined_at DESC
        LIMIT 1
        """,
        (session_id, student_id),
    )
    existing_open = cursor.fetchone()

    if existing_open:
        return {
            'attendance_id': existing_open[0],
            'joined_at': existing_open[1],
            'already_open': True,
        }

    cursor.execute(
        """
        INSERT INTO attendance (session_id, student_id, status, joined_at, recorded_at)
        VALUES (%s, %s, 'present', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING attendance_id, joined_at
        """,
        (session_id, student_id),
    )
    created = cursor.fetchone()
    return {
        'attendance_id': created[0],
        'joined_at': created[1],
        'already_open': False,
    }


def _mark_leave(cursor, session_id, student_id):
    cursor.execute(
        """
        UPDATE attendance a
        SET left_at = CURRENT_TIMESTAMP,
            duration_seconds = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - a.joined_at))::INTEGER,
            status = 'present'
        WHERE a.attendance_id = (
            SELECT attendance_id
            FROM attendance
            WHERE session_id = %s
              AND student_id = %s
              AND left_at IS NULL
            ORDER BY joined_at DESC
            LIMIT 1
            FOR UPDATE
        )
        RETURNING attendance_id, joined_at, left_at, duration_seconds
        """,
        (session_id, student_id),
    )
    return cursor.fetchone()


def _close_all_open_records(cursor, session_id):
    cursor.execute(
        """
        UPDATE attendance
        SET left_at = CURRENT_TIMESTAMP,
            duration_seconds = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - joined_at))::INTEGER,
            status = 'present'
        WHERE session_id = %s
          AND left_at IS NULL
        RETURNING attendance_id
        """,
        (session_id,),
    )
    return cursor.fetchall()

def getDbConnection():
    try:
        conn = psycopg2.connect(
            host=os.getenv('DB_HOST', 'localhost'),
            database=os.getenv('DB_NAME', 'ClassMate'),
            user=os.getenv('DB_USER', 'postgres'),
            password=os.getenv('DB_PASSWORD', 'Hifza12#'),
            port=os.getenv('DB_PORT', 5432)
        )
        return conn
    except Exception as e:
        print(f"Database connection error: {e}")
        return None


@attendance_bp.route('/api/attendance/mark-join', methods=['POST'])
def mark_attendance_join():
    """Backward-compatible alias for /api/attendance/join"""
    return attendance_join()


@attendance_bp.route('/api/attendance/join', methods=['POST'])
def attendance_join():
    """Record when a student joins a session. Rejoin-safe with open-session dedupe."""
    try:
        data = request.get_json()
        session_id, student_id = _validate_session_student_payload(data)
        
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()

        join_result = _mark_join(cursor, session_id, student_id)
        conn.commit()
        cursor.close()
        conn.close()
        
        print(f"[OK] Attendance join: student {student_id} joined session {session_id}")
        
        return jsonify({
            "success": True,
            "message": "Active attendance already exists" if join_result['already_open'] else "Attendance join recorded",
            "attendance_id": join_result['attendance_id'],
            "joined_at": join_result['joined_at'].isoformat() if join_result['joined_at'] else None,
            "already_open": join_result['already_open']
        }), 200

    except ValueError as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 400
        
    except Exception as e:
        print(f"[ERROR] Error marking attendance: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@attendance_bp.route('/api/attendance/mark-leave', methods=['PUT'])
def mark_attendance_leave():
    """Backward-compatible alias for /api/attendance/leave"""
    return attendance_leave()


@attendance_bp.route('/api/attendance/leave', methods=['POST', 'PUT'])
def attendance_leave():
    """Record when a student leaves a session. Safe when duplicate leave events arrive."""
    try:
        data = request.get_json()
        session_id, student_id = _validate_session_student_payload(data)
        
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()

        result = _mark_leave(cursor, session_id, student_id)
        conn.commit()
        cursor.close()
        conn.close()

        if not result:
            return jsonify({
                "success": True,
                "message": "No active attendance record to close",
                "session_id": session_id,
                "student_id": student_id
            }), 200
        
        print(f"[OK] Student {student_id} left session {session_id}, duration: {result[1]}s")
        
        return jsonify({
            "success": True,
            "message": "Leave time recorded",
            "attendance_id": result[0],
            "joined_at": result[1].isoformat() if result[1] else None,
            "left_at": result[2].isoformat() if result[2] else None,
            "duration_seconds": result[3]
        }), 200

    except ValueError as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 400
        
    except Exception as e:
        print(f"[ERROR] Error recording leave time: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@attendance_bp.route('/api/attendance/session-end', methods=['POST'])
def attendance_session_end():
    """Close all open attendance rows for a session when a class ends."""
    try:
        data = request.get_json() or {}
        session_id = _to_int(data.get('session_id'), 'session_id')

        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500

        cursor = conn.cursor()
        closed_rows = _close_all_open_records(cursor, session_id)
        conn.commit()
        cursor.close()
        conn.close()

        return jsonify({
            "success": True,
            "message": "Session attendance closed",
            "session_id": session_id,
            "closed_count": len(closed_rows)
        }), 200

    except ValueError as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 400

    except Exception as e:
        print(f"[ERROR] Error closing session attendance: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@attendance_bp.route('/api/attendance/session/<int:session_id>', methods=['GET'])
def get_session_attendance(session_id):
    """Get session attendance across enrolled students with aggregated rejoin duration."""
    try:
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        
        # First, get the course_id from the session
        cursor.execute("""
            SELECT course_id FROM class_session WHERE session_id = %s
        """, (session_id,))
        
        course_result = cursor.fetchone()
        if not course_result:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": "Session not found"
            }), 404

        course_id = course_result[0]
        
        # Aggregate multiple attendance rows (rejoins) into one report row per student.
        cursor.execute("""
            SELECT 
                st.student_id,
                st.name as student_name,
                MIN(a.joined_at) as first_joined_at,
                MAX(a.left_at) as last_left_at,
                COALESCE(
                    SUM(
                        COALESCE(
                            a.duration_seconds,
                            CASE
                                WHEN a.joined_at IS NOT NULL AND a.left_at IS NOT NULL
                                    THEN EXTRACT(EPOCH FROM (a.left_at - a.joined_at))::INTEGER
                                ELSE 0
                            END
                        )
                    ),
                    0
                ) as total_duration_seconds,
                CASE WHEN COUNT(a.attendance_id) > 0 THEN 'present' ELSE 'absent' END as status,
                COUNT(a.attendance_id) as join_count
            FROM student st
            JOIN enrollment e ON st.student_id = e.student_id
            LEFT JOIN attendance a ON st.student_id = a.student_id AND a.session_id = %s
            WHERE e.course_id = %s AND e.is_active = true
            GROUP BY st.student_id, st.name
            ORDER BY st.name ASC
        """, (session_id, course_id))
        
        rows = cursor.fetchall()
        
        attendance_list = []
        for row in rows:
            attendance_list.append({
                "student_id": row[0],
                "student_name": row[1],
                "joined_at": row[2].isoformat() if row[2] else None,
                "left_at": row[3].isoformat() if row[3] else None,
                "duration_seconds": int(row[4] or 0),
                "status": row[5],
                "join_count": int(row[6] or 0)
            })
        
        cursor.close()
        conn.close()
        
        return jsonify({
            "success": True,
            "attendance": attendance_list
        }), 200
        
    except Exception as e:
        print(f"[ERROR] Error fetching attendance: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500