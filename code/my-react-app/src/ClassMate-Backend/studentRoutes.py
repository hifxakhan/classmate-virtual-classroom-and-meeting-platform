from flask import Blueprint, jsonify, request, send_from_directory
import psycopg2
import os
from dotenv import load_dotenv
from datetime import datetime
import bcrypt
import uuid

load_dotenv()

student_bp = Blueprint('student', __name__)

UPLOAD_FOLDER = 'uploads/profile_images/students'
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

# Database connection function
def getDbConnection():
    print(f"Attempting database connection...")
    try:
        conn = psycopg2.connect(
            host=os.getenv('DB_HOST', 'localhost'),
            database=os.getenv('DB_NAME', 'ClassMate'),
            user=os.getenv('DB_USER', 'postgres'),
            password=os.getenv('DB_PASSWORD', 'Hifza12#'),
            port=os.getenv('DB_PORT', 5432)
        )
        print(f"Database connection SUCCESS")
        return conn
    except Exception as e:
        print(f"Database connection FAILED: {e}")
        return None

def row_to_dict(cursor, row):
    if row is None:
        return None
    columns = [desc[0] for desc in cursor.description]
    return dict(zip(columns, row))

# =============================================
# STUDENT REGISTRATION ENDPOINT
# =============================================

@student_bp.route('/api/students/register', methods=['POST'])
def register_student():
    """
    Register a new student
    Required fields: name, email, password, semester
    Optional fields: registration_number, phone, profile_image_url
    If registration_number is not provided, system auto-generates: STU-XXXXXXXX
    """
    try:
        data = request.json
        
        # Validate required fields
        required_fields = ['name', 'email', 'password', 'semester']
        for field in required_fields:
            if field not in data or not data[field]:
                return jsonify({
                    "success": False,
                    "message": f"Missing required field: {field}"
                }), 400
        
        name = (data.get('name') or '').strip()
        email = (data.get('email') or '').strip()
        password = (data.get('password') or '').strip()
        semester = data.get('semester')
        registration_number = (data.get('registration_number') or '').strip() or None
        phone = (data.get('phone') or '').strip() or None
        profile_image_url = (data.get('profile_image_url') or '').strip() or None
        
        # Validate semester is an integer
        try:
            semester = int(semester)
        except (ValueError, TypeError):
            return jsonify({
                "success": False,
                "message": "Semester must be an integer"
            }), 400
        
        print(f"📚 Registering student: {name} ({email})")
        
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "message": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        
        # Check if email already exists
        cursor.execute(
            "SELECT student_id FROM student WHERE email = %s",
            (email,)
        )
        if cursor.fetchone():
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "message": "Email already registered"
            }), 400
        
        # Determine student_id: use provided registration number or generate one
        if registration_number:
            # Check if registration number already exists
            cursor.execute(
                "SELECT student_id FROM student WHERE student_id = %s",
                (registration_number,)
            )
            if cursor.fetchone():
                cursor.close()
                conn.close()
                return jsonify({
                    "success": False,
                    "message": "Registration number already in use"
                }), 400
            student_id = registration_number
            print(f"📌 Using provided registration number: {student_id}")
        else:
            # Auto-generate registration number
            student_id = f"STU-{uuid.uuid4().hex[:8].upper()}"
            print(f"🆔 Auto-generating registration number: {student_id}")
        
        # Hash password
        password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        
        # Insert student
        cursor.execute(
            """INSERT INTO student 
               (student_id, name, email, password_hash, semester, phone, profile_image_url, created_at, updated_at, email_verified)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (student_id, name, email, password_hash, semester, phone, profile_image_url, 
             datetime.now(), datetime.now(), False)
        )
        
        conn.commit()
        cursor.close()
        conn.close()
        
        print(f"[OK] Student registered successfully: {student_id}")
        
        return jsonify({
            "success": True,
            "message": "Student registered successfully",
            "student": {
                "student_id": student_id,
                "name": name,
                "email": email,
                "semester": semester
            }
        }), 201
        
    except Exception as e:
        print(f"[ERROR] Registration error: {e}")
        return jsonify({
            "success": False,
            "message": f"Registration failed: {str(e)}"
        }), 500

# =============================================
# STUDENT DATA ENDPOINTS (STUDENT TABLE ONLY)
# =============================================

@student_bp.route('/api/student/get-by-email', methods=['GET'])
def get_student_by_email():
    """
    Get student data using logged-in email
    Usage: /api/student/get-by-email?email=student@example.com
    """
    email = request.args.get('email')
    
    if not email:
        return jsonify({
            "success": False,
            "error": "Email parameter is required"
        }), 400
    
    print(f"📧 Fetching student data for email: {email}")
    
    conn = getDbConnection()
    if not conn:
        return jsonify({"success": False, "error": "Database connection failed"}), 500
    
    try:
        cursor = conn.cursor()
        
        # Get all student data from student table
        cursor.execute("""
            SELECT 
                student_id, 
                name, 
                email, 
                password_hash, 
                semester, 
                phone, 
                profile_image_url, 
                created_at, 
                updated_at, 
                email_verified
            FROM student 
            WHERE email = %s
        """, (email,))
        
        student = cursor.fetchone()
        
        if not student:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": "Student not found with this email"
            }), 404
        
        # Get column names
        columns = [desc[0] for desc in cursor.description]
        student_data = dict(zip(columns, student))
        
        cursor.close()
        conn.close()
        
        # Format the response (exclude password_hash for security)
        profile = {
            "student_id": student_data['student_id'],
            "name": student_data['name'],
            "email": student_data['email'],
            "semester": student_data['semester'],
            "phone": student_data['phone'] or "",
            "profile_image_url": student_data['profile_image_url'] or "",
            "email_verified": student_data['email_verified'],
            "created_at": student_data['created_at'].isoformat() if student_data['created_at'] else None,
            "updated_at": student_data['updated_at'].isoformat() if student_data['updated_at'] else None
        }
        
        print(f"[OK] Student data retrieved: {profile['name']} ({profile['student_id']})")
        
        return jsonify({
            "success": True,
            "message": "Student data fetched successfully",
            "student": profile
        })
        
    except Exception as e:
        print(f"[ERROR] Database error: {e}")
        if conn:
            conn.close()
        return jsonify({
            "success": False,
            "error": f"Database error: {str(e)}"
        }), 500

@student_bp.route('/api/student/get-by-id', methods=['GET'])
def get_student_by_id():
    """
    Get student data using student_id
    Usage: /api/student/get-by-id?id=STU001
    """
    student_id = request.args.get('id')
    
    if not student_id:
        return jsonify({
            "success": False,
            "error": "Student ID parameter is required"
        }), 400
    
    print(f"🆔 Fetching student data for ID: {student_id}")
    
    conn = getDbConnection()
    if not conn:
        return jsonify({"success": False, "error": "Database connection failed"}), 500
    
    try:
        cursor = conn.cursor()
        
        # Get all student data from student table
        cursor.execute("""
            SELECT 
                student_id, 
                name, 
                email, 
                password_hash, 
                semester, 
                phone, 
                profile_image_url, 
                created_at, 
                updated_at, 
                email_verified
            FROM student 
            WHERE student_id = %s
        """, (student_id,))
        
        student = cursor.fetchone()
        
        if not student:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": "Student not found with this ID"
            }), 404
        
        # Get column names
        columns = [desc[0] for desc in cursor.description]
        student_data = dict(zip(columns, student))
        
        cursor.close()
        conn.close()
        
        # Format the response
        profile = {
            "student_id": student_data['student_id'],
            "name": student_data['name'],
            "email": student_data['email'],
            "semester": student_data['semester'],
            "phone": student_data['phone'] or "",
            "profile_image_url": student_data['profile_image_url'] or "",
            "email_verified": student_data['email_verified'],
            "created_at": student_data['created_at'].isoformat() if student_data['created_at'] else None,
            "updated_at": student_data['updated_at'].isoformat() if student_data['updated_at'] else None
        }
        
        print(f"[OK] Student data retrieved: {profile['name']}")
        
        return jsonify({
            "success": True,
            "message": "Student data fetched successfully",
            "student": profile
        })
        
    except Exception as e:
        print(f"[ERROR] Database error: {e}")
        if conn:
            conn.close()
        return jsonify({
            "success": False,
            "error": f"Database error: {str(e)}"
        }), 500

@student_bp.route('/api/student/get-current', methods=['GET'])
def get_current_student():
    """
    Get current logged-in student data (most common endpoint)
    Uses email from headers or query parameters
    """
    # Get email from headers (recommended for production)
    student_email = request.headers.get('X-Student-Email')
    
    # If not in headers, check query parameters
    if not student_email:
        student_email = request.args.get('email')
    
    if not student_email:
        return jsonify({
            "success": False,
            "error": "Student email is required. Provide it in X-Student-Email header or email query parameter."
        }), 400
    
    print(f"👤 Fetching current student data for: {student_email}")
    
    conn = getDbConnection()
    if not conn:
        return jsonify({"success": False, "error": "Database connection failed"}), 500
    
    try:
        cursor = conn.cursor()
        
        # Simple query to get student data
        cursor.execute("""
            SELECT 
                student_id, 
                name, 
                email, 
                semester, 
                phone, 
                profile_image_url, 
                created_at, 
                updated_at, 
                email_verified
            FROM student 
            WHERE email = %s
        """, (student_email,))
        
        student = cursor.fetchone()
        
        if not student:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": "No student found with this email. Please login again."
            }), 404
        
        columns = [desc[0] for desc in cursor.description]
        student_data = dict(zip(columns, student))
        
        cursor.close()
        conn.close()
        
        # Create response
        response = {
            "student_id": student_data['student_id'],
            "name": student_data['name'],
            "email": student_data['email'],
            "semester": student_data['semester'],
            "phone": student_data['phone'] or "Not provided",
            "profile_image_url": student_data['profile_image_url'] or "",
            "email_verified": student_data['email_verified'],
            "created_at": student_data['created_at'].isoformat() if student_data['created_at'] else None,
            "updated_at": student_data['updated_at'].isoformat() if student_data['updated_at'] else None
        }
        
        print(f"[OK] Current student retrieved: {response['name']}")
        
        return jsonify({
            "success": True,
            "student": response
        })
        
    except Exception as e:
        print(f"[ERROR] Error fetching student: {e}")
        if conn:
            conn.close()
        return jsonify({
            "success": False,
            "error": f"Database error: {str(e)}"
        }), 500

@student_bp.route('/api/student/test-connection', methods=['GET'])
def test_student_connection():
    """Test endpoint to verify student API is working"""
    return jsonify({
        "success": True,
        "message": "Student API is working!",
        "endpoints": {
            "get_current": "/api/student/get-current?email=STUDENT_EMAIL",
            "get_by_email": "/api/student/get-by-email?email=STUDENT_EMAIL",
            "get_by_id": "/api/student/get-by-id?id=STUDENT_ID"
        },
        "timestamp": datetime.now().isoformat()
    })

# Route to serve uploaded student profile images
@student_bp.route('/uploads/profile_images/students/<filename>')
def serve_student_profile_image(filename):
    try:
        return send_from_directory(UPLOAD_FOLDER, filename)
    except FileNotFoundError:
        return jsonify({"error": "Image not found"}), 404

@student_bp.route('/api/student/enrolled-courses', methods=['GET'])
def get_enrolled_courses():
    """Get all courses that the logged-in student is enrolled in"""
    # Get student email from query parameter
    student_email = request.args.get('email')
    
    if not student_email:
        return jsonify({
            "success": False,
            "error": "Student email is required"
        }), 400
    
    print(f"📚 Fetching enrolled courses for student: {student_email}")
    
    conn = getDbConnection()
    if not conn:
        return jsonify({"success": False, "error": "Database connection failed"}), 500
    
    try:
        cursor = conn.cursor()
        
        # First, get the student_id from email
        cursor.execute("SELECT student_id FROM student WHERE email = %s", (student_email,))
        student_result = cursor.fetchone()
        
        if not student_result:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": "Student not found"
            }), 404
        
        student_id = student_result[0]
        
        # Get enrolled courses with course details
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
                c.schedule,
                c.created_at,
                c.updated_at,
                e.enrolled_at,
                e.is_active as enrollment_active,
                t.name as teacher_name,
                t.email as teacher_email
            FROM enrollment e
            JOIN course c ON e.course_id = c.course_id
            JOIN teacher t ON c.teacher_id = t.teacher_id
            WHERE e.student_id = %s AND e.is_active = true
            ORDER BY c.course_code
        """, (student_id,))
        
        courses = cursor.fetchall()
        
        # Get column names
        columns = [desc[0] for desc in cursor.description]
        
        courses_list = []
        for course in courses:
            course_dict = dict(zip(columns, course))
            
            # Format course data
            courses_list.append({
                "course_id": course_dict['course_id'],
                "title": course_dict['title'],
                "description": course_dict['description'] or "",
                "credit_hours": course_dict['credit_hours'],
                "course_code": course_dict['course_code'],
                "department": course_dict['department'] or "",
                "teacher_id": course_dict['teacher_id'],
                "teacher_name": course_dict['teacher_name'],
                "teacher_email": course_dict['teacher_email'],
                "semester": course_dict['semester'],
                "status": course_dict['status'],
                "max_students": course_dict['max_students'],
                "schedule": course_dict['schedule'] or "",
                "enrolled_at": course_dict['enrolled_at'].isoformat() if course_dict['enrolled_at'] else None,
                "enrollment_active": course_dict['enrollment_active'],
                "created_at": course_dict['created_at'].isoformat() if course_dict['created_at'] else None,
                "updated_at": course_dict['updated_at'].isoformat() if course_dict['updated_at'] else None
            })
        
        cursor.close()
        conn.close()
        
        print(f"[OK] Found {len(courses_list)} enrolled courses for student {student_id}")
        
        return jsonify({
            "success": True,
            "courses": courses_list,
            "count": len(courses_list),
            "student_id": student_id
        })
        
    except Exception as e:
        print(f"[ERROR] Database error in get_enrolled_courses: {e}")
        if conn:
            conn.close()
        return jsonify({
            "success": False,
            "error": f"Database error: {str(e)}"
        }), 500

# =============================================
# STUDENT UPDATE ENDPOINT
# =============================================
@student_bp.route('/api/admin/students/<student_id>', methods=['PUT'])
def update_student(student_id):
    """Update student information"""
    try:
        data = request.get_json()
        conn = getDbConnection()
        if not conn:
            return jsonify({'success': False, 'message': 'Database connection failed'}), 500
        
        cursor = conn.cursor()
        
        # Build update query based on provided fields
        updates = []
        values = []
        
        if 'name' in data:
            updates.append("name = %s")
            values.append(data['name'])
        if 'email' in data:
            updates.append("email = %s")
            values.append(data['email'])
        if 'phone' in data:
            updates.append("phone = %s")
            values.append(data['phone'])
        if 'semester' in data:
            updates.append("semester = %s")
            values.append(data['semester'])
        if 'profile_image_url' in data:
            updates.append("profile_image_url = %s")
            values.append((data.get('profile_image_url') or '').strip() or None)
        
        if not updates:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'message': 'No fields to update'}), 400
        
        values.append(student_id)
        update_query = f"UPDATE student SET {', '.join(updates)} WHERE student_id = %s"
        
        cursor.execute(update_query, values)
        conn.commit()
        cursor.close()
        conn.close()
        
        print(f"[OK] Student {student_id} updated successfully")
        return jsonify({'success': True, 'message': 'Student updated successfully'}), 200
        
    except Exception as e:
        print(f"[ERROR] Error updating student: {e}")
        return jsonify({'success': False, 'message': f'Error updating student: {str(e)}'}), 500


# =============================================
# STUDENT DELETE ENDPOINT
# =============================================
@student_bp.route('/api/admin/students/<student_id>', methods=['DELETE'])
def delete_student(student_id):
    """Delete a student"""
    try:
        conn = getDbConnection()
        if not conn:
            return jsonify({'success': False, 'message': 'Database connection failed'}), 500
        
        cursor = conn.cursor()
        
        # Check if student exists
        cursor.execute("SELECT name FROM student WHERE student_id = %s", (student_id,))
        student = cursor.fetchone()
        
        if not student:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'message': 'Student not found'}), 404
        
        student_name = student[0]

        # Cleanup related records to avoid FK constraint failures
        cursor.execute("SAVEPOINT cleanup_student_course")
        try:
            cursor.execute("DELETE FROM student_course WHERE student_id = %s", (student_id,))
            cursor.execute("RELEASE SAVEPOINT cleanup_student_course")
        except Exception as cleanup_error:
            cursor.execute("ROLLBACK TO SAVEPOINT cleanup_student_course")
            print(f"[WARN] Cleanup student_course failed: {cleanup_error}")

        cursor.execute("SAVEPOINT cleanup_enrollment")
        try:
            cursor.execute("DELETE FROM enrollment WHERE student_id = %s", (student_id,))
            cursor.execute("RELEASE SAVEPOINT cleanup_enrollment")
        except Exception as cleanup_error:
            cursor.execute("ROLLBACK TO SAVEPOINT cleanup_enrollment")
            print(f"[WARN] Cleanup enrollment failed: {cleanup_error}")

        cursor.execute("SAVEPOINT cleanup_attendance")
        try:
            cursor.execute("DELETE FROM attendance WHERE student_id = %s", (student_id,))
            cursor.execute("RELEASE SAVEPOINT cleanup_attendance")
        except Exception as cleanup_error:
            cursor.execute("ROLLBACK TO SAVEPOINT cleanup_attendance")
            print(f"[WARN] Cleanup attendance failed: {cleanup_error}")
        
        # Delete student
        cursor.execute("DELETE FROM student WHERE student_id = %s", (student_id,))
        conn.commit()
        cursor.close()
        conn.close()
        
        print(f"[OK] Student {student_id} ({student_name}) deleted successfully")
        return jsonify({'success': True, 'message': f'Student "{student_name}" deleted successfully'}), 200
        
    except Exception as e:
        print(f"[ERROR] Error deleting student: {e}")
        return jsonify({'success': False, 'message': f'Error deleting student: {str(e)}'}), 500
@student_bp.route('/api/student/profile/get-by-email', methods=['GET'])
def get_student_profile_by_email():
    """Get student profile by email (for editing)"""
    student_email = request.args.get('email')
    
    if not student_email:
        return jsonify({
            "success": False,
            "error": "Student email is required"
        }), 400
    
    print(f"📧 Fetching student profile for email: {student_email}")
    
    conn = getDbConnection()
    if not conn:
        return jsonify({"success": False, "error": "Database connection failed"}), 500
    
    try:
        cursor = conn.cursor()
        
        # [OK] FIXED: Only query columns that exist in your table
        cursor.execute("""
            SELECT 
                student_id,
                name,
                email,
                phone,
                semester,
                profile_image_url,
                email_verified,
                created_at,
                updated_at
            FROM student 
            WHERE email = %s
        """, (student_email,))
        
        student = cursor.fetchone()
        
        if not student:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": "Student not found"
            }), 404
        
        # Get column names
        columns = [desc[0] for desc in cursor.description]
        student_data = dict(zip(columns, student))
        
        cursor.close()
        conn.close()
        
        # Format the response with defaults for missing columns
        profile = {
            "student_id": student_data['student_id'],
            "name": student_data['name'],
            "email": student_data['email'],
            "phone": student_data['phone'] or "",
            "semester": student_data['semester'] or 1,
            "profile_image_url": student_data['profile_image_url'] or "",
            "email_verified": student_data['email_verified'],
            "created_at": student_data['created_at'].isoformat() if student_data['created_at'] else None,
            "updated_at": student_data['updated_at'].isoformat() if student_data['updated_at'] else None
        }
        
        print(f"[OK] Student profile retrieved: {profile['name']}")
        
        return jsonify({
            "success": True,
            "student": profile
        })
        
    except Exception as e:
        print(f"[ERROR] Database error: {e}")
        if conn:
            conn.close()
        return jsonify({
            "success": False,
            "error": f"Database error: {str(e)}"
        }), 500

@student_bp.route('/api/student/profile/update-by-email', methods=['PUT'])
def update_student_profile_by_email():
    """Update student profile using email"""
    data = request.json
    
    if not data or 'email' not in data:
        return jsonify({
            "success": False,
            "error": "Student email is required"
        }), 400
    
    student_email = data['email']
    
    # [OK] FIXED: Only allow updating fields that exist in your table
    update_fields = []
    values = []
    
    allowed_fields = [
        'name', 'phone', 'semester'  # Only these columns exist
    ]
    
    for field in allowed_fields:
        if field in data and data[field] is not None:
            update_fields.append(f"{field} = %s")
            values.append(data[field])
    
    if not update_fields:
        return jsonify({
            "success": False,
            "error": "No fields to update"
        }), 400
    
    values.append(student_email)
    
    conn = getDbConnection()
    if not conn:
        return jsonify({"success": False, "error": "Database connection failed"}), 500
    
    try:
        cursor = conn.cursor()
        
        # First, check if student exists
        cursor.execute("SELECT student_id FROM student WHERE email = %s", (student_email,))
        student = cursor.fetchone()
        
        if not student:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": "Student not found with this email"
            }), 404
        
        student_id = student[0]
        
        # Update query
        query = f"""
            UPDATE student 
            SET {', '.join(update_fields)}, updated_at = CURRENT_TIMESTAMP
            WHERE email = %s
            RETURNING 
                student_id,
                name,
                email,
                phone,
                semester,
                profile_image_url,
                email_verified,
                created_at,
                updated_at
        """
        
        cursor.execute(query, tuple(values))
        updated_student = cursor.fetchone()
        
        if not updated_student:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": "Failed to update profile"
            }), 500
        
        columns = [desc[0] for desc in cursor.description]
        student_data = dict(zip(columns, updated_student))
        
        conn.commit()
        cursor.close()
        conn.close()
        
        # Format the response
        response_data = {
            "student_id": student_data['student_id'],
            "name": student_data['name'],
            "email": student_data['email'],
            "phone": student_data['phone'] or "",
            "semester": student_data['semester'] or 1,
            "profile_image_url": student_data['profile_image_url'] or "",
            "email_verified": student_data['email_verified'],
            "created_at": student_data['created_at'].isoformat() if student_data['created_at'] else None,
            "updated_at": student_data['updated_at'].isoformat() if student_data['updated_at'] else None,
        }
        
        return jsonify({
            "success": True,
            "message": "Profile updated successfully",
            "student": response_data
        })
        
    except Exception as e:
        print(f"[ERROR] Update error: {e}")
        conn.rollback()
        if conn:
            conn.close()
        return jsonify({
            "success": False,
            "error": f"Update failed: {str(e)}"
        }), 500

@student_bp.route('/api/student/today-schedule', methods=['GET'])
def get_student_today_schedule():
    """Get today's class sessions for the logged-in student"""
    # Get student email from query parameter
    student_email = request.args.get('email')
    
    if not student_email:
        return jsonify({
            "success": False,
            "error": "Student email is required"
        }), 400
    
    print(f"📅 Fetching today's schedule for student: {student_email}")
    
    conn = getDbConnection()
    if not conn:
        return jsonify({"success": False, "error": "Database connection failed"}), 500
    
    try:
        cursor = conn.cursor()
        
        # First, get the student_id from email
        cursor.execute("SELECT student_id FROM student WHERE email = %s", (student_email,))
        student_result = cursor.fetchone()
        
        if not student_result:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": "Student not found"
            }), 404
        
        student_id = student_result[0]
        
        # Get today's schedule for enrolled courses
        cursor.execute("""
            SELECT 
                cs.session_id,
                cs.title as session_title,
                cs.description,
                cs.start_time,
                cs.end_time,
                cs.meeting_room_id,
                cs.meeting_token,
                cs.status,
                cs.participants_count,
                cs.is_private,
                cs.recording_available,
                c.course_id,
                c.course_code,
                c.title as course_title,
                c.department,
                c.credit_hours,
                t.name as teacher_name,
                t.email as teacher_email
            FROM class_session cs
            JOIN course c ON cs.course_id = c.course_id
            JOIN teacher t ON c.teacher_id = t.teacher_id
            WHERE c.course_id IN (
                SELECT course_id 
                FROM enrollment 
                WHERE student_id = %s AND is_active = true
            )
            AND DATE(cs.start_time) = CURRENT_DATE
            AND cs.status IN ('scheduled', 'ongoing')
            ORDER BY cs.start_time ASC
        """, (student_id,))
        
        sessions = cursor.fetchall()
        
        # Get column names
        columns = [desc[0] for desc in cursor.description]
        
        sessions_list = []
        for session in sessions:
            session_dict = dict(zip(columns, session))
            
            start_time = session_dict['start_time']
            end_time = session_dict['end_time']
            
            # Format time for display
            display_time = ""
            if start_time:
                time_str = start_time.strftime("%I:%M %p")
                if time_str.startswith('0'):
                    time_str = time_str[1:]
                display_time = time_str
            
            # Check if session is currently live
            now = datetime.now()
            is_live = False
            if start_time and end_time:
                if start_time <= now <= end_time:
                    is_live = True
            
            # Determine session type
            session_title_lower = (session_dict['session_title'] or "").lower()
            if is_live:
                session_type = "Live Now"
            elif any(word in session_title_lower for word in ['lab', 'workshop', 'practical']):
                session_type = "Lab Session"
            elif any(word in session_title_lower for word in ['lecture', 'class']):
                session_type = "Lecture"
            elif "meeting" in session_title_lower:
                session_type = "Meeting"
            else:
                session_type = "Class Session"
            
            sessions_list.append({
                "session_id": session_dict['session_id'],
                "course_id": session_dict['course_id'],
                "course_code": session_dict['course_code'],
                "course_title": session_dict['course_title'],
                "session_title": session_dict['session_title'],
                "description": session_dict['description'] or "",
                "start_time": start_time.isoformat() if start_time else None,
                "end_time": end_time.isoformat() if end_time else None,
                "display_time": display_time,
                "meeting_room_id": session_dict['meeting_room_id'] or "",
                "meeting_token": session_dict['meeting_token'] or "",
                "status": session_dict['status'],
                "participants_count": session_dict['participants_count'] or 0,
                "is_private": session_dict['is_private'],
                "recording_available": session_dict['recording_available'],
                "department": session_dict['department'] or "",
                "credit_hours": session_dict['credit_hours'],
                "teacher_name": session_dict['teacher_name'],
                "teacher_email": session_dict['teacher_email'],
                "is_live": is_live,
                "type": session_type,
                "room": session_dict['meeting_room_id'] or "Online",
                "duration_minutes": int((end_time - start_time).seconds / 60) if start_time and end_time else 0
            })
        
        cursor.close()
        conn.close()
        
        print(f"[OK] Found {len(sessions_list)} sessions for student {student_id} today")
        
        return jsonify({
            "success": True,
            "date": datetime.now().date().isoformat(),
            "display_date": datetime.now().strftime("%B %d, %Y"),
            "sessions": sessions_list,
            "count": len(sessions_list),
            "student_id": student_id
        })
        
    except Exception as e:
        print(f"[ERROR] Database error in get_student_today_schedule: {e}")
        if conn:
            conn.close()
        return jsonify({
            "success": False,
            "error": f"Database error: {str(e)}"
        }), 500