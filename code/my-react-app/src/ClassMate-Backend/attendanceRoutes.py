from flask import Blueprint, jsonify, request
from datetime import datetime
import psycopg2
import os
from dotenv import load_dotenv

load_dotenv()

attendance_bp = Blueprint('attendance', __name__)

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
    """Record when a student joins a session"""
    try:
        data = request.get_json()
        session_id = data.get('session_id')
        student_id = data.get('student_id')
        
        if not session_id or not student_id:
            return jsonify({
                "success": False,
                "error": "session_id and student_id are required"
            }), 400
        
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        
        # Check if attendance already exists for this session and student
        cursor.execute("""
            SELECT attendance_id, joined_at 
            FROM attendance 
            WHERE session_id = %s AND student_id = %s
        """, (session_id, student_id))
        
        existing = cursor.fetchone()
        
        if existing:
            # Already marked attendance
            cursor.close()
            conn.close()
            return jsonify({
                "success": True,
                "message": "Attendance already recorded",
                "attendance_id": existing[0]
            }), 200
        
        # Insert new attendance record
        cursor.execute("""
            INSERT INTO attendance 
            (session_id, student_id, status, joined_at, recorded_at)
            VALUES (%s, %s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            RETURNING attendance_id
        """, (session_id, student_id, 'present'))
        
        attendance_id = cursor.fetchone()[0]
        conn.commit()
        cursor.close()
        conn.close()
        
        print(f"[OK] Attendance marked: student {student_id} joined session {session_id}")
        
        return jsonify({
            "success": True,
            "message": "Attendance marked successfully",
            "attendance_id": attendance_id
        }), 201
        
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
    """Record when a student leaves a session"""
    try:
        data = request.get_json()
        session_id = data.get('session_id')
        student_id = data.get('student_id')
        
        if not session_id or not student_id:
            return jsonify({
                "success": False,
                "error": "session_id and student_id are required"
            }), 400
        
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        
        # Update left_at and calculate duration
        cursor.execute("""
            UPDATE attendance 
            SET left_at = CURRENT_TIMESTAMP,
                duration_seconds = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - joined_at))::INTEGER
            WHERE session_id = %s AND student_id = %s
            RETURNING attendance_id, duration_seconds
        """, (session_id, student_id))
        
        result = cursor.fetchone()
        
        if not result:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": "Attendance record not found"
            }), 404
        
        conn.commit()
        cursor.close()
        conn.close()
        
        print(f"[OK] Student {student_id} left session {session_id}, duration: {result[1]}s")
        
        return jsonify({
            "success": True,
            "message": "Leave time recorded",
            "attendance_id": result[0],
            "duration_seconds": result[1]
        }), 200
        
    except Exception as e:
        print(f"[ERROR] Error recording leave time: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@attendance_bp.route('/api/attendance/session/<int:session_id>', methods=['GET'])
def get_session_attendance(session_id):
    """Get all attendance records for a session including all enrolled students"""
    try:
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        
        # First, get the course_id and status from the session
        cursor.execute("""
            SELECT course_id, status FROM class_session WHERE session_id = %s
        """, (session_id,))
        
        course_result = cursor.fetchone()
        if not course_result:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": "Session not found"
            }), 404
        
        course_id, session_status = course_result
        
        # Check if session is completed
        if session_status != 'completed':
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": f"Attendance records are only available for completed sessions. Current status: {session_status}"
            }), 403
        
        # Get all students enrolled in the course with their attendance status
        cursor.execute("""
            SELECT 
                st.student_id,
                st.name as student_name,
                COALESCE(a.attendance_id, NULL) as attendance_id,
                COALESCE(a.status, 'absent') as status,
                a.joined_at,
                a.left_at,
                a.duration_seconds,
                a.remarks
            FROM student st
            JOIN enrollment e ON st.student_id = e.student_id
            LEFT JOIN attendance a ON st.student_id = a.student_id AND a.session_id = %s
            WHERE e.course_id = %s AND e.is_active = true
            ORDER BY st.name ASC
        """, (session_id, course_id))
        
        rows = cursor.fetchall()
        
        attendance_list = []
        for row in rows:
            attendance_list.append({
                "attendance_id": row[2],
                "student_id": row[0],
                "student_name": row[1],
                "status": row[3],
                "joined_at": row[4].isoformat() if row[4] else None,
                "left_at": row[5].isoformat() if row[5] else None,
                "duration_seconds": row[6],
                "remarks": row[7]
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