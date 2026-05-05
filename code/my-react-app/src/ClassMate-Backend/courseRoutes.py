# courseRoutes.py or add to existing routes
from flask import Blueprint, jsonify, request
import psycopg2
import os
from dotenv import load_dotenv
from datetime import datetime
import uuid
from utils.timezone import get_user_timezone, utc_to_local, get_day_range_utc, to_utc_and_pkt_iso

load_dotenv()

course_bp = Blueprint('course', __name__)

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
        print(f"Database connection FAILED: {e}")
        return None

def row_to_dict(cursor, row):
    if row is None:
        return None
    columns = [desc[0] for desc in cursor.description]
    return dict(zip(columns, row))

@course_bp.route('/api/courses/register', methods=['POST'])
def register_course():
    """Register a new course in the database"""
    try:
        data = request.get_json()
        
        # Extract and validate fields with null-safe handling (convert to string first)
        course_code = (str(data.get('courseCode') or '')).strip()
        title = (str(data.get('title') or '')).strip()
        description = (str(data.get('description') or '')).strip()
        credit_hours = data.get('creditHours')
        teacher_id = (str(data.get('teacherId') or '')).strip()
        department = (str(data.get('department') or '')).strip()
        semester = (str(data.get('semester') or '')).strip()
        status = (str(data.get('status') or 'active')).strip()
        max_students = data.get('maxStudents', 50)
        syllabus_url = (str(data.get('syllabusUrl') or '')).strip()
        schedule = (str(data.get('schedule') or '')).strip()
        course_id = (str(data.get('courseId') or '')).strip()
        
        # Validate required fields
        if not course_code:
            return jsonify({'success': False, 'message': '[ERROR] Course code is required'}), 400
        if not title:
            return jsonify({'success': False, 'message': '[ERROR] Course title is required'}), 400
        if not credit_hours:
            return jsonify({'success': False, 'message': '[ERROR] Credit hours are required'}), 400
        if not teacher_id:
            return jsonify({'success': False, 'message': '[ERROR] Teacher is required'}), 400
        
        # Validate credit hours is a positive number
        try:
            credit_hours = float(credit_hours)
            if credit_hours <= 0:
                return jsonify({'success': False, 'message': '[ERROR] Credit hours must be a positive number'}), 400
        except (ValueError, TypeError):
            return jsonify({'success': False, 'message': '[ERROR] Credit hours must be a valid number'}), 400
        
        conn = getDbConnection()
        if not conn:
            return jsonify({'success': False, 'message': '[ERROR] Database connection failed'}), 500
        
        cursor = conn.cursor()
        
        # Check if course code already exists
        cursor.execute("SELECT course_id FROM course WHERE course_code = %s", (course_code,))
        if cursor.fetchone():
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'message': f'[ERROR] Course code "{course_code}" already exists'}), 409
        
        # Check if teacher exists
        cursor.execute("SELECT teacher_id FROM teacher WHERE teacher_id = %s", (teacher_id,))
        if not cursor.fetchone():
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'message': '[ERROR] Selected teacher does not exist'}), 404
        
        # Generate course_id if not provided
        if not course_id:
            course_id = f"CRS-{str(uuid.uuid4())[:8].upper()}"
        
        # Insert course into database
        cursor.execute("""
            INSERT INTO course (
                course_id, course_code, title, description, credit_hours,
                teacher_id, department, semester, status, max_students,
                syllabus_url, schedule
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            course_id, course_code, title, description, credit_hours,
            teacher_id, department if department else None, 
            semester if semester else None, status, max_students,
            syllabus_url if syllabus_url else None,
            schedule if schedule else None
        ))
        
        conn.commit()
        cursor.close()
        conn.close()
        
        print(f"[OK] Course registered successfully: {course_code}")
        
        return jsonify({
            'success': True,
            'message': f'[OK] Course "{title}" registered successfully!',
            'course_id': course_id,
            'course_code': course_code
        }), 201
        
    except Exception as e:
        print(f"[ERROR] Error registering course: {str(e)}")
        return jsonify({
            'success': False,
            'message': f'[ERROR] Error registering course: {str(e)}'
        }), 500


@course_bp.route('/api/courses/<course_id>/students', methods=['GET'])
def get_course_students(course_id):
    """Get enrolled students - SIMPLEST VERSION"""
    print(f"📚 Getting students for course: {course_id}")
    
    try:
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        
        # 1. Check if course exists
        cursor.execute("SELECT course_code, title FROM course WHERE course_id = %s", (course_id,))
        course_info = cursor.fetchone()
        
        if not course_info:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": f"Course not found: {course_id}"
            }), 404
        
        # 2. SIMPLE QUERY - Only what we need
        query = """
            SELECT 
                s.student_id,
                s.name,
                s.email,
                s.semester,
                s.phone
            FROM enrollment e
            JOIN student s ON e.student_id = s.student_id
            WHERE e.course_id = %s
              AND e.is_active = true
            ORDER BY s.name
        """
        
        cursor.execute(query, (course_id,))
        students_raw = cursor.fetchall()
        
        # 3. Simple data formatting
        students = []
        for student in students_raw:
            student_id = student[0]
            name = student[1]
            
            # Create simple roll number (use last 3 chars of student_id)
            roll_number = f"CS-{student_id[-3:]}"
            
            students.append({
                "id": student_id,
                "student_id": student_id,
                "name": name,
                "email": student[2] or "",
                "rollNumber": roll_number,
                "semester": student[3] or 1,
                "phone": student[4] or "",
                "avatar": name[0].upper() if name else "S"
            })
        
        cursor.close()
        conn.close()
        
        return jsonify({
            "success": True,
            "course_id": course_id,
            "course_code": course_info[0],
            "course_title": course_info[1],
            "students": students,
            "count": len(students),
            "message": f"Found {len(students)} students"
        })
        
    except Exception as e:
        print(f"[ERROR] Error: {e}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500
    
# Get course details with student count
@course_bp.route('/api/courses/<course_id>', methods=['GET'])
def get_course_details(course_id):
    """Get course details with enrolled student count"""
    try:
        print(f"🔍 Getting course details for: {course_id}")
        
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        
        # Get course details
        cursor.execute("""
            SELECT 
                c.*,
                t.name as teacher_name,
                t.email as teacher_email,
                COUNT(e.student_id) as enrolled_students
            FROM course c
            LEFT JOIN teacher t ON c.teacher_id = t.teacher_id
            LEFT JOIN enrollment e ON c.course_id = e.course_id AND e.is_active = TRUE
            WHERE c.course_id = %s
            GROUP BY c.course_id, c.title, c.description, c.credit_hours, 
                     c.course_code, c.department, c.teacher_id, c.semester,
                     c.status, c.max_students, c.syllabus_url, c.schedule,
                     c.created_at, c.updated_at, t.name, t.email
        """, (course_id,))
        
        course_raw = cursor.fetchone()
        
        if not course_raw:
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": "Course not found"}), 404
        
        course_dict = row_to_dict(cursor, course_raw)
        
        cursor.close()
        conn.close()
        
        # Format the course data
        course_data = {
            "id": course_dict['course_id'],
            "title": course_dict['title'],
            "description": course_dict.get('description', ''),
            "credit_hours": course_dict['credit_hours'],
            "course_code": course_dict['course_code'],
            "department": course_dict.get('department', ''),
            "teacher_id": course_dict['teacher_id'],
            "teacher_name": course_dict.get('teacher_name', ''),
            "teacher_email": course_dict.get('teacher_email', ''),
            "semester": course_dict.get('semester'),
            "status": course_dict.get('status'),
            "max_students": course_dict.get('max_students', 50),
            "student_count": course_dict.get('enrolled_students', 0),
            "syllabus_url": course_dict.get('syllabus_url'),
            "schedule": course_dict.get('schedule'),
            "created_at": course_dict['created_at'].isoformat() if course_dict.get('created_at') else None,
            "updated_at": course_dict['updated_at'].isoformat() if course_dict.get('updated_at') else None
        }
        
        print(f"[OK] Retrieved course details: {course_data['course_code']}")
        
        return jsonify({
            "success": True,
            "course": course_data,
            "timestamp": datetime.now().isoformat()
        })
        
    except Exception as e:
        print(f"[ERROR] Error getting course details: {e}")
        return jsonify({
            "success": False,
            "error": f"Failed to get course details: {str(e)}"
        }), 500

# Add this to your courseRoutes.py
@course_bp.route('/api/debug/enrollment/<course_id>', methods=['GET'])
def debug_enrollment(course_id):
    """Debug endpoint to check enrollment data"""
    try:
        print(f"🔍 DEBUG: Checking enrollment for course: {course_id}")
        
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        
        # Check if course exists
        cursor.execute("SELECT course_id, course_code, title FROM course WHERE course_id = %s", (course_id,))
        course = cursor.fetchone()
        
        if not course:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": f"Course {course_id} not found"
            }), 404
        
        print(f"[OK] Course found: {course[1]} - {course[2]}")
        
        # Check total enrollments
        cursor.execute("""
            SELECT COUNT(*) as total_enrollments 
            FROM enrollment 
            WHERE course_id = %s AND is_active = true
        """, (course_id,))
        
        total = cursor.fetchone()[0]
        print(f"📊 Total active enrollments: {total}")
        
        # Get detailed enrollment info
        cursor.execute("""
            SELECT 
                e.student_id,
                s.name,
                s.email,
                e.enrolled_at,
                e.is_active
            FROM enrollment e
            LEFT JOIN student s ON e.student_id = s.student_id
            WHERE e.course_id = %s
            ORDER BY e.enrolled_at DESC
        """, (course_id,))
        
        enrollments = cursor.fetchall()
        
        enrollment_list = []
        for enrollment in enrollments:
            enrollment_list.append({
                "student_id": enrollment[0],
                "student_name": enrollment[1],
                "email": enrollment[2],
                "enrolled_at": enrollment[3].isoformat() if enrollment[3] else None,
                "is_active": enrollment[4]
            })
        
        cursor.close()
        conn.close()
        
        return jsonify({
            "success": True,
            "course_id": course_id,
            "course_code": course[1],
            "course_title": course[2],
            "total_enrollments": total,
            "enrollments": enrollment_list,
            "message": f"Found {total} active enrollments for course {course[1]}"
        })
        
    except Exception as e:
        print(f"[ERROR] Debug error: {e}")
        import traceback
        traceback.print_exc()
        if conn:
            conn.close()
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500
    
# Add this helper function to courseRoutes.py (for testing only)
def check_and_seed_enrollment(course_id):
    """Check if enrollment exists, if not, add some test data"""
    conn = getDbConnection()
    if not conn:
        return False
    
    try:
        cursor = conn.cursor()
        
        # Check if any enrollments exist
        cursor.execute("SELECT COUNT(*) FROM enrollment WHERE course_id = %s", (course_id,))
        count = cursor.fetchone()[0]
        
        if count == 0:
            print(f"⚠️ No enrollments found for course {course_id}. Adding test data...")
            
            # Get some students from database
            cursor.execute("SELECT student_id, name FROM student LIMIT 5")
            available_students = cursor.fetchall()
            
            if available_students:
                for student in available_students:
                    cursor.execute("""
                        INSERT INTO enrollment (student_id, course_id, enrolled_at, is_active)
                        VALUES (%s, %s, NOW(), true)
                        ON CONFLICT DO NOTHING
                    """, (student[0], course_id))
                
                conn.commit()
                print(f"[OK] Added {len(available_students)} test enrollments")
            else:
                print("⚠️ No students available to enroll")
        
        cursor.close()
        conn.close()
        return count > 0
        
    except Exception as e:
        print(f"[ERROR] Error checking enrollment: {e}")
        if conn:
            conn.close()
        return False
    
# Add this to courseRoutes.py
@course_bp.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        "success": True,
        "message": "Course API is running",
        "timestamp": datetime.now().isoformat(),
        "endpoints": {
            "get_course": "/api/courses/<course_id>",
            "get_students": "/api/courses/<course_id>/students",
            "debug": "/api/debug/enrollment/<course_id>",
            "health": "/api/health"
        }
    })

# Add this to your courseRoutes.py - COMPREHENSIVE COURSE DETAILS ENDPOINT
@course_bp.route('/api/courses/<course_id>/full', methods=['GET'])
def get_course_full_details(course_id):
    """Get comprehensive course information with all related data"""
    try:
        print(f"📘 Getting full course details for: {course_id}")
        
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        
        # Get comprehensive course information with teacher details
        cursor.execute("""
            SELECT 
                c.course_id,
                c.title,
                c.description,
                c.credit_hours,
                c.course_code,
                c.department,
                c.teacher_id,
                c.semester,
                c.status,
                c.max_students,
                c.syllabus_url,
                c.schedule,
                c.created_at,
                c.updated_at,
                t.name as teacher_name,
                t.email as teacher_email,
                t.department as teacher_department,
                t.profile_image_url as teacher_image,
                COUNT(DISTINCT e.student_id) as enrolled_students,
                COUNT(DISTINCT cs.session_id) as total_sessions,
                COUNT(DISTINCT a.assignment_id) as total_assignments
            FROM course c
            LEFT JOIN teacher t ON c.teacher_id = t.teacher_id
            LEFT JOIN enrollment e ON c.course_id = e.course_id AND e.is_active = TRUE
            LEFT JOIN class_session cs ON c.course_id = cs.course_id
            LEFT JOIN (
                SELECT course_id, COUNT(*) as assignment_count 
                FROM assignment 
                GROUP BY course_id
            ) a ON c.course_id = a.course_id
            WHERE c.course_id = %s
            GROUP BY 
                c.course_id, c.title, c.description, c.credit_hours, 
                c.course_code, c.department, c.teacher_id, c.semester,
                c.status, c.max_students, c.syllabus_url, c.schedule,
                c.created_at, c.updated_at, t.name, t.email, 
                t.department, t.profile_image_url
        """, (course_id,))
        
        course_raw = cursor.fetchone()
        
        if not course_raw:
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": "Course not found"}), 404
        
        # Convert to dictionary
        columns = [desc[0] for desc in cursor.description]
        course_dict = dict(zip(columns, course_raw))
        
        # Get prerequisites if they exist in a separate table
        # If you have a prerequisites table, add this query:
        # cursor.execute("""
        #     SELECT prerequisite_course_id, prerequisite_name 
        #     FROM course_prerequisites 
        #     WHERE course_id = %s
        # """, (course_id,))
        # prerequisites = cursor.fetchall()
        
        cursor.close()
        conn.close()
        
        # Format the comprehensive course data
        course_data = {
            # Basic Info
            "id": course_dict['course_id'],
            "course_id": course_dict['course_id'],
            "title": course_dict['title'],
            "description": course_dict.get('description', 'No description available'),
            "course_code": course_dict['course_code'],
            
            # Course Details
            "credit_hours": course_dict['credit_hours'],
            "department": course_dict.get('department', 'Not specified'),
            "semester": course_dict.get('semester', 1),
            "status": course_dict.get('status', 'active'),
            "max_students": course_dict.get('max_students', 50),
            
            # Teacher Info
            "teacher_id": course_dict['teacher_id'],
            "teacher_name": course_dict.get('teacher_name', 'Not assigned'),
            "teacher_email": course_dict.get('teacher_email', ''),
            "teacher_department": course_dict.get('teacher_department', ''),
            "teacher_image": course_dict.get('teacher_image', ''),
            
            # Course Resources
            "syllabus_url": course_dict.get('syllabus_url', ''),
            "schedule": course_dict.get('schedule', 'Schedule not specified'),
            
            # Statistics
            "student_count": course_dict.get('enrolled_students', 0),
            "total_sessions": course_dict.get('total_sessions', 0),
            "total_assignments": course_dict.get('total_assignments', 0),
            
            # Timestamps
            "created_at": course_dict['created_at'].isoformat() if course_dict.get('created_at') else None,
            "updated_at": course_dict['updated_at'].isoformat() if course_dict.get('updated_at') else None,
            
            # Additional Info (you can customize these based on your schema)
            "prerequisites": "None",  # Update if you have prerequisites table
            "course_type": "Regular",  # Could be 'Lab', 'Theory', 'Practical', etc.
            "location": "Main Campus",  # If you have location info
            "meeting_days": "MWF",  # Example: Monday, Wednesday, Friday
            "meeting_time": "10:00 AM - 11:30 AM"  # Example time
        }
        
        print(f"[OK] Retrieved comprehensive details for: {course_data['course_code']}")
        
        return jsonify({
            "success": True,
            "course": course_data,
            "timestamp": datetime.now().isoformat()
        })
        
    except Exception as e:
        print(f"[ERROR] Error getting full course details: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            "success": False,
            "error": f"Failed to get course details: {str(e)}"
        }), 500
    
# Add this function to courseRoutes.py - GET ALL CLASS SESSIONS FOR A COURSE
@course_bp.route('/api/courses/<course_id>/sessions', methods=['GET'])
def get_course_sessions(course_id):
    """Get all class sessions for a specific course"""
    try:
        print(f"📅 Getting class sessions for course: {course_id}")
        
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        
        # First, check if the course exists
        cursor.execute("SELECT course_code, title FROM course WHERE course_id = %s", (course_id,))
        course_info = cursor.fetchone()
        
        if not course_info:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": f"Course not found: {course_id}"
            }), 404
        
        print(f"[OK] Course found: {course_info[0]} - {course_info[1]}")
        
        # Get all class sessions for this course with additional details
        query = """
            SELECT 
                cs.session_id,
                cs.course_id,
                cs.title,
                cs.description,
                cs.start_time,
                cs.end_time,
                cs.meeting_room_id,
                cs.meeting_token,
                cs.is_private,
                cs.recording_path,
                cs.recording_available,
                cs.status,
                cs.participants_count,
                cs.materials,
                cs.notes,
                cs.created_at,
                cs.updated_at,
                cs.started_at,
                cs.ended_at,
                c.course_code,
                c.title as course_title,
                t.name as teacher_name,
                t.email as teacher_email,
                -- Calculate if session is ongoing
                CASE 
                    WHEN cs.status = 'ongoing' THEN true
                    WHEN CURRENT_TIMESTAMP BETWEEN cs.start_time AND cs.end_time 
                         AND cs.status = 'scheduled' THEN true
                    ELSE false 
                END as is_ongoing,
                -- Calculate if session is upcoming
                CASE 
                    WHEN CURRENT_TIMESTAMP < cs.start_time 
                         AND cs.status = 'scheduled' THEN true
                    ELSE false 
                END as is_upcoming,
                -- Calculate if session is completed (past end time)
                CASE 
                    WHEN CURRENT_TIMESTAMP > cs.end_time 
                         AND cs.status IN ('scheduled', 'ongoing') THEN true
                    ELSE false 
                END as is_past,
                -- Format time for display
                TO_CHAR(cs.start_time, 'HH12:MI AM') as display_start_time,
                TO_CHAR(cs.end_time, 'HH12:MI AM') as display_end_time,
                TO_CHAR(cs.start_time, 'Day') as day_of_week
            FROM class_session cs
            JOIN course c ON cs.course_id = c.course_id
            LEFT JOIN teacher t ON c.teacher_id = t.teacher_id
            WHERE cs.course_id = %s
            ORDER BY cs.start_time DESC
        """
        
        cursor.execute(query, (course_id,))
        sessions_raw = cursor.fetchall()
        
        # Convert to list of dictionaries
        sessions = []
        for session in sessions_raw:
            session_dict = row_to_dict(cursor, session)
            start_time_utc, start_time_pkt = to_utc_and_pkt_iso(session_dict.get('start_time'))
            end_time_utc, end_time_pkt = to_utc_and_pkt_iso(session_dict.get('end_time'))
            created_at_utc, created_at_pkt = to_utc_and_pkt_iso(session_dict.get('created_at'))
            updated_at_utc, updated_at_pkt = to_utc_and_pkt_iso(session_dict.get('updated_at'))
            started_at_utc, started_at_pkt = to_utc_and_pkt_iso(session_dict.get('started_at'))
            ended_at_utc, ended_at_pkt = to_utc_and_pkt_iso(session_dict.get('ended_at'))
            
            # Format the session data
            formatted_session = {
                "session_id": session_dict['session_id'],
                "course_id": session_dict['course_id'],
                "title": session_dict['title'],
                "description": session_dict.get('description', ''),
                "start_time": start_time_utc,
                "end_time": end_time_utc,
                "start_time_utc": start_time_utc,
                "start_time_pkt": start_time_pkt,
                "end_time_utc": end_time_utc,
                "end_time_pkt": end_time_pkt,
                "meeting_room_id": session_dict.get('meeting_room_id'),
                "meeting_token": session_dict.get('meeting_token'),
                "is_private": session_dict.get('is_private', False),
                "recording_path": session_dict.get('recording_path'),
                "recording_available": session_dict.get('recording_available', False),
                "status": session_dict.get('status', 'scheduled'),
                "participants_count": session_dict.get('participants_count', 0),
                "materials": session_dict.get('materials') or [],
                "notes": session_dict.get('notes', ''),
                "created_at": created_at_utc,
                "updated_at": updated_at_utc,
                "started_at": started_at_utc,
                "ended_at": ended_at_utc,
                "created_at_utc": created_at_utc,
                "created_at_pkt": created_at_pkt,
                "updated_at_utc": updated_at_utc,
                "updated_at_pkt": updated_at_pkt,
                "started_at_utc": started_at_utc,
                "started_at_pkt": started_at_pkt,
                "ended_at_utc": ended_at_utc,
                "ended_at_pkt": ended_at_pkt,
                
                # Additional info
                "course_code": session_dict['course_code'],
                "course_title": session_dict['course_title'],
                "teacher_name": session_dict.get('teacher_name'),
                "teacher_email": session_dict.get('teacher_email'),
                
                # Calculated fields
                "is_ongoing": session_dict.get('is_ongoing', False),
                "is_upcoming": session_dict.get('is_upcoming', False),
                "is_past": session_dict.get('is_past', False),
                
                # Display fields
                "display_start_time": session_dict.get('display_start_time'),
                "display_end_time": session_dict.get('display_end_time'),
                "day_of_week": session_dict.get('day_of_week'),
                "display_time": f"{session_dict.get('display_start_time', '')} - {session_dict.get('display_end_time', '')}",
                
                # Duration in minutes
                "duration_minutes": None
            }
            
            # Calculate duration if we have both start and end times
            if session_dict.get('start_time') and session_dict.get('end_time'):
                try:
                    start_dt = session_dict['start_time']
                    end_dt = session_dict['end_time']
                    duration = end_dt - start_dt
                    formatted_session['duration_minutes'] = int(duration.total_seconds() / 60)
                except:
                    pass
            
            sessions.append(formatted_session)
        
        cursor.close()
        conn.close()
        
        print(f"[OK] Retrieved {len(sessions)} sessions for course {course_info[0]}")
        
        return jsonify({
            "success": True,
            "course_id": course_id,
            "course_code": course_info[0],
            "course_title": course_info[1],
            "sessions": sessions,
            "count": len(sessions),
            "timestamp": datetime.now().isoformat(),
            "message": f"Found {len(sessions)} class sessions"
        })
        
    except Exception as e:
        print(f"[ERROR] Error getting class sessions: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            "success": False,
            "error": f"Failed to get class sessions: {str(e)}"
        }), 500

# Add this function to courseRoutes.py - GET SPECIFIC SESSION DETAILS
@course_bp.route('/api/sessions/<session_id>', methods=['GET'])
def get_session_details(session_id):
    """Get detailed information about a specific session"""
    try:
        print(f"📋 Getting details for session: {session_id}")
        
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        
        # Get session details with all related information
        query = """
            SELECT 
                cs.*,
                c.course_code,
                c.title as course_title,
                c.department,
                c.teacher_id,
                t.name as teacher_name,
                t.email as teacher_email,
                t.profile_image_url as teacher_image
            FROM class_session cs
            JOIN course c ON cs.course_id = c.course_id
            LEFT JOIN teacher t ON c.teacher_id = t.teacher_id
            WHERE cs.session_id = %s
        """
        
        cursor.execute(query, (session_id,))
        session_raw = cursor.fetchone()
        
        if not session_raw:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": f"Session not found: {session_id}"
            }), 404
        
        session_dict = row_to_dict(cursor, session_raw)

        start_time_utc, start_time_pkt = to_utc_and_pkt_iso(session_dict.get('start_time'))
        end_time_utc, end_time_pkt = to_utc_and_pkt_iso(session_dict.get('end_time'))
        created_at_utc, created_at_pkt = to_utc_and_pkt_iso(session_dict.get('created_at'))
        updated_at_utc, updated_at_pkt = to_utc_and_pkt_iso(session_dict.get('updated_at'))
        started_at_utc, started_at_pkt = to_utc_and_pkt_iso(session_dict.get('started_at'))
        ended_at_utc, ended_at_pkt = to_utc_and_pkt_iso(session_dict.get('ended_at'))

        session_dict['start_time'] = start_time_utc
        session_dict['end_time'] = end_time_utc
        session_dict['created_at'] = created_at_utc
        session_dict['updated_at'] = updated_at_utc
        session_dict['started_at'] = started_at_utc
        session_dict['ended_at'] = ended_at_utc
        session_dict['start_time_utc'] = start_time_utc
        session_dict['start_time_pkt'] = start_time_pkt
        session_dict['end_time_utc'] = end_time_utc
        session_dict['end_time_pkt'] = end_time_pkt
        session_dict['created_at_utc'] = created_at_utc
        session_dict['created_at_pkt'] = created_at_pkt
        session_dict['updated_at_utc'] = updated_at_utc
        session_dict['updated_at_pkt'] = updated_at_pkt
        session_dict['started_at_utc'] = started_at_utc
        session_dict['started_at_pkt'] = started_at_pkt
        session_dict['ended_at_utc'] = ended_at_utc
        session_dict['ended_at_pkt'] = ended_at_pkt
        
        # Get attendance for this session if you have an attendance table
        # Uncomment and modify if you have attendance tracking
        # cursor.execute("""
        #     SELECT student_id, status, joined_at, left_at
        #     FROM attendance 
        #     WHERE session_id = %s
        #     ORDER BY joined_at
        # """, (session_id,))
        # attendance_records = cursor.fetchall()
        
        # Get materials with more details if needed
        materials = []
        if session_dict.get('materials'):
            # If materials is an array of IDs or paths, you can fetch more details
            # For now, just use what's in the array
            materials = session_dict['materials']
        
        cursor.close()
        conn.close()
        
        # Format the response
        response_data = {
            "session": session_dict,
            "attendance": [],  # Populate if you have attendance data
            "materials": materials,
            "related_assignments": session_dict.get('related_assignments', 0)
        }
        
        print(f"[OK] Retrieved session details: {session_dict['title']}")
        
        return jsonify({
            "success": True,
            "data": response_data,
            "timestamp": datetime.now().isoformat()
        })
        
    except Exception as e:
        print(f"[ERROR] Error getting session details: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            "success": False,
            "error": f"Failed to get session details: {str(e)}"
        }), 500


# Lookup session by meeting_room_id
@course_bp.route('/api/sessions/by-room/<meeting_room_id>', methods=['GET'])
def get_session_by_room(meeting_room_id):
    """Find a session by its meeting_room_id"""
    try:
        print(f"🔎 Looking up session by meeting_room_id: {meeting_room_id}")

        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500

        cursor = conn.cursor()

        cursor.execute("""
            SELECT session_id, course_id, title, start_time, end_time, meeting_room_id, status
            FROM class_session
            WHERE meeting_room_id = %s
            LIMIT 1
        """, (meeting_room_id,))

        row = cursor.fetchone()
        cursor.close()
        conn.close()

        if not row:
            return jsonify({"success": False, "error": "Session not found"}), 404

        session = {
            "session_id": row[0],
            "course_id": row[1],
            "title": row[2],
            "start_time": to_utc_and_pkt_iso(row[3])[0] if row[3] else None,
            "start_time_utc": to_utc_and_pkt_iso(row[3])[0] if row[3] else None,
            "start_time_pkt": to_utc_and_pkt_iso(row[3])[1] if row[3] else None,
            "end_time": to_utc_and_pkt_iso(row[4])[0] if row[4] else None,
            "end_time_utc": to_utc_and_pkt_iso(row[4])[0] if row[4] else None,
            "end_time_pkt": to_utc_and_pkt_iso(row[4])[1] if row[4] else None,
            "meeting_room_id": row[5],
            "status": row[6]
        }

        return jsonify({"success": True, "session": session})

    except Exception as e:
        print(f"[ERROR] Error finding session by room: {e}")
        if 'conn' in locals() and conn:
            conn.close()
        return jsonify({"success": False, "error": str(e)}), 500

# Add this function to courseRoutes.py - UPDATE SESSION STATUS
@course_bp.route('/api/sessions/<session_id>/status', methods=['PUT'])
def update_session_status(session_id):
    """Update the status of a class session"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({"success": False, "error": "No data provided"}), 400
        
        status = data.get('status')
        notes = data.get('notes')
        
        if not status:
            return jsonify({"success": False, "error": "Status is required"}), 400
        
        # Validate status
        valid_statuses = ['scheduled', 'ongoing', 'completed', 'cancelled']
        if status not in valid_statuses:
            return jsonify({
                "success": False, 
                "error": f"Invalid status. Must be one of: {', '.join(valid_statuses)}"
            }), 400
        
        print(f"🔄 Updating session {session_id} status to: {status}")
        
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        
        # First, check if session exists
        cursor.execute("SELECT session_id, course_id, title FROM class_session WHERE session_id = %s", (session_id,))
        session_info = cursor.fetchone()
        
        if not session_info:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": f"Session not found: {session_id}"
            }), 404
        
        # Build the update query based on status
        update_query = """
            UPDATE class_session 
            SET status = %s,
                updated_at = CURRENT_TIMESTAMP
        """
        params = [status]
        
        # Add notes if provided
        if notes:
            update_query += ", notes = %s"
            params.append(notes)
        
        # Set started_at/ended_at based on status
        if status == 'ongoing':
            update_query += ", started_at = COALESCE(started_at, CURRENT_TIMESTAMP)"
        elif status == 'completed':
            update_query += ", ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP)"
        
        update_query += " WHERE session_id = %s RETURNING *"
        params.append(session_id)
        
        cursor.execute(update_query, params)
        updated_session = cursor.fetchone()
        
        conn.commit()
        
        session_dict = row_to_dict(cursor, updated_session)
        
        cursor.close()
        conn.close()
        
        print(f"[OK] Updated session {session_id} status to {status}")
        
        return jsonify({
            "success": True,
            "session": session_dict,
            "message": f"Session status updated to {status}",
            "timestamp": datetime.now().isoformat()
        })
        
    except Exception as e:
        print(f"[ERROR] Error updating session status: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            "success": False,
            "error": f"Failed to update session status: {str(e)}"
        }), 500


@course_bp.route('/api/sessions/<session_id>/join', methods=['POST'])
def join_session_as_teacher(session_id):
    """Teacher joins a session. Expect JSON: { teacher: { id: 'TCH...' } }
    Backend will verify teacher_id matches the course's assigned teacher before
    promoting the session to ongoing and returning session details.
    """
    try:
        data = request.get_json() or {}
        teacher = data.get('teacher') or {}
        teacher_id = teacher.get('id') or data.get('teacher_id')

        if not teacher_id:
            return jsonify({"success": False, "error": "teacher.id (teacher_id) required"}), 400

        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500

        cursor = conn.cursor()

        # Find session and its course
        cursor.execute("SELECT session_id, course_id FROM class_session WHERE session_id = %s", (session_id,))
        sess = cursor.fetchone()
        if not sess:
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": f"Session not found: {session_id}"}), 404

        course_id = sess[1]

        # Get course's assigned teacher
        cursor.execute("SELECT teacher_id FROM course WHERE course_id = %s", (course_id,))
        course_row = cursor.fetchone()
        if not course_row:
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": f"Course not found for session: {course_id}"}), 404

        assigned_teacher_id = course_row[0]

        # Verify the teacher matches the course teacher
        if str(assigned_teacher_id) != str(teacher_id):
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": "Teacher ID does not match course teacher"}), 403

        # Update session status to ongoing and set started_at
        cursor.execute("""
            UPDATE class_session
            SET status = %s,
                started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
                updated_at = CURRENT_TIMESTAMP
            WHERE session_id = %s
            RETURNING *
        """, ('ongoing', session_id))

        updated = cursor.fetchone()
        conn.commit()

        session_dict = row_to_dict(cursor, updated) if updated else None

        cursor.close()
        conn.close()

        return jsonify({"success": True, "session": session_dict, "message": "Teacher joined and session set to ongoing"})

    except Exception as e:
        print(f"[ERROR] Error in join_session_as_teacher: {e}")
        import traceback
        traceback.print_exc()
        if 'conn' in locals() and conn:
            conn.close()
        return jsonify({"success": False, "error": str(e)}), 500

# Add this function to courseRoutes.py - GET TODAY'S SESSIONS FOR A COURSE
@course_bp.route('/api/courses/<course_id>/sessions/today', methods=['GET'])
def get_today_sessions(course_id):
    """Get today's sessions for a specific course"""
    try:
        print(f"📅 Getting today's sessions for course: {course_id}")
        timezone_str = get_user_timezone()
        now_local = utc_to_local(datetime.utcnow(), timezone_str)
        query_date = now_local.date()
        day_start_utc, day_end_utc = get_day_range_utc(timezone_str, query_date)
        day_start = day_start_utc.replace(tzinfo=None)
        day_end = day_end_utc.replace(tzinfo=None)
        print(f"🕒 timezone={timezone_str} day_start_utc={day_start} day_end_utc={day_end}")
        
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        
        # Check if course exists
        cursor.execute("SELECT course_code, title FROM course WHERE course_id = %s", (course_id,))
        course_info = cursor.fetchone()
        
        if not course_info:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": f"Course not found: {course_id}"
            }), 404
        
        # Get today's sessions (sessions that start or end today)
        query = """
            SELECT 
                cs.session_id,
                cs.title,
                cs.start_time,
                cs.end_time,
                cs.status,
                cs.meeting_room_id,
                cs.is_private,
                cs.participants_count,
                CASE 
                    WHEN %s BETWEEN cs.start_time AND cs.end_time 
                         AND cs.status IN ('scheduled', 'ongoing') THEN true
                    ELSE false 
                END as is_live_now
            FROM class_session cs
            WHERE cs.course_id = %s
                AND cs.start_time >= %s
                AND cs.start_time < %s
            ORDER BY cs.start_time
        """
        
        cursor.execute(query, (datetime.utcnow(), course_id, day_start, day_end))
        sessions_raw = cursor.fetchall()
        
        sessions = []
        for session in sessions_raw:
            session_dict = row_to_dict(cursor, session)
            
            formatted_session = {
                "session_id": session_dict['session_id'],
                "title": session_dict['title'],
                "start_time": utc_to_local(session_dict['start_time'], timezone_str).isoformat() if session_dict.get('start_time') else None,
                "end_time": utc_to_local(session_dict['end_time'], timezone_str).isoformat() if session_dict.get('end_time') else None,
                "status": session_dict.get('status', 'scheduled'),
                "meeting_room_id": session_dict.get('meeting_room_id'),
                "is_private": session_dict.get('is_private', False),
                "participants_count": session_dict.get('participants_count', 0),
                "is_live_now": session_dict.get('is_live_now', False),
                "display_time": None
            }
            
            # Format display time
            if session_dict.get('start_time'):
                start_time = utc_to_local(session_dict['start_time'], timezone_str)
                formatted_session['display_time'] = start_time.strftime('%I:%M %p')
            
            sessions.append(formatted_session)
        
        cursor.close()
        conn.close()
        
        return jsonify({
            "success": True,
            "course_id": course_id,
            "course_code": course_info[0],
            "course_title": course_info[1],
            "sessions": sessions,
            "count": len(sessions),
            "date": datetime.now().date().isoformat(),
            "message": f"Found {len(sessions)} sessions for today"
        })
        
    except Exception as e:
        print(f"[ERROR] Error getting today's sessions: {e}")
        return jsonify({
            "success": False,
            "error": f"Failed to get today's sessions: {str(e)}"
        }), 500

# Add this function to courseRoutes.py - GET UPCOMING SESSIONS FOR A COURSE
@course_bp.route('/api/courses/<course_id>/sessions/upcoming', methods=['GET'])
def get_upcoming_sessions(course_id):
    """Get upcoming sessions for a course (next 7 days)"""
    try:
        days = request.args.get('days', default=7, type=int)
        
        print(f"📅 Getting upcoming sessions for course {course_id} (next {days} days)")
        
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        
        # Check if course exists
        cursor.execute("SELECT course_code, title FROM course WHERE course_id = %s", (course_id,))
        course_info = cursor.fetchone()
        
        if not course_info:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": f"Course not found: {course_id}"
            }), 404
        
        # Get upcoming sessions
        query = """
            SELECT 
                cs.session_id,
                cs.title,
                cs.description,
                cs.start_time,
                cs.end_time,
                cs.status,
                cs.meeting_room_id,
                cs.is_private,
                cs.participants_count
            FROM class_session cs
            WHERE cs.course_id = %s
                AND cs.start_time > CURRENT_TIMESTAMP
                AND cs.start_time <= CURRENT_TIMESTAMP + INTERVAL '%s days'
                AND cs.status != 'cancelled'
            ORDER BY cs.start_time
            LIMIT 10
        """
        
        cursor.execute(query, (course_id, days))
        sessions_raw = cursor.fetchall()
        
        sessions = []
        for session in sessions_raw:
            session_dict = row_to_dict(cursor, session)
            sessions.append(session_dict)
        
        cursor.close()
        conn.close()
        
        return jsonify({
            "success": True,
            "course_id": course_id,
            "course_code": course_info[0],
            "course_title": course_info[1],
            "sessions": sessions,
            "count": len(sessions),
            "days": days,
            "message": f"Found {len(sessions)} upcoming sessions"
        })
        
    except Exception as e:
        print(f"[ERROR] Error getting upcoming sessions: {e}")
        return jsonify({
            "success": False,
            "error": f"Failed to get upcoming sessions: {str(e)}"
        }), 500


@course_bp.route("/api/courses/<course_id>/quizzes", methods=["GET"])
def list_course_quizzes(course_id):
    """List quizzes for a course (studentCourseProfile.jsx). Uses DATABASE_URL via db.py."""
    try:
        from db import getDbConnection as get_app_db

        conn = get_app_db()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500

        cursor = conn.cursor()
        from lecture_recap_routes import ensure_lecture_recap_tables

        ensure_lecture_recap_tables(cursor)
        conn.commit()

        cursor.execute(
            """
            SELECT quiz_id, title
            FROM quiz
            WHERE course_id = %s
            ORDER BY quiz_id DESC
            """,
            (course_id,),
        )
        rows = cursor.fetchall()
        cursor.close()
        conn.close()

        quizzes = []
        for r in rows:
            qid = r[0]
            title = r[1] or "Quiz"
            quizzes.append({"id": qid, "quiz_id": qid, "title": title})

        return jsonify({"success": True, "quizzes": quizzes}), 200
    except Exception as e:
        print(f"[ERROR] list_course_quizzes: {e}")
        return jsonify({"success": False, "error": str(e)}), 500