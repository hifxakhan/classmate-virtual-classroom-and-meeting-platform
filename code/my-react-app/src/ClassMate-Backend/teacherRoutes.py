from flask import Blueprint, jsonify, request, send_from_directory
import psycopg2
import os
from dotenv import load_dotenv
from datetime import datetime, date
import json
from werkzeug.utils import secure_filename
import random
import string
import time
import bcrypt
import uuid
from utils.timezone import get_user_timezone, local_to_utc, utc_to_local, get_day_range_utc, to_utc_and_pkt_iso

load_dotenv()

teacher_bp = Blueprint('teacher', __name__)

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif'}

UPLOAD_FOLDER = 'uploads/profile_images'
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

# Add this route to serve uploaded images
@teacher_bp.route('/uploads/profile_images/<filename>')
def serve_profile_image(filename):
    try:
        return send_from_directory(UPLOAD_FOLDER, filename)
    except FileNotFoundError:
        return jsonify({"error": "Image not found"}), 404

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
    
def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def row_to_dict(cursor, row):
    if row is None:
        return None
    columns = [desc[0] for desc in cursor.description]
    return dict(zip(columns, row))

# =============================================
# TEACHER REGISTRATION ENDPOINT
# =============================================

@teacher_bp.route('/api/teachers/register', methods=['POST'])
def register_teacher():
    """
    Register a new teacher
    Required fields: name, email, password, department
    Optional fields: profile_image_url
    """
    try:
        data = request.json
        
        # Validate required fields
        required_fields = ['name', 'email', 'password', 'department']
        for field in required_fields:
            if field not in data or not data[field]:
                return jsonify({
                    "success": False,
                    "message": f"Missing required field: {field}"
                }), 400
        
        name = (data.get('name') or '').strip()
        email = (data.get('email') or '').strip()
        password = (data.get('password') or '').strip()
        department = (data.get('department') or '').strip()
        profile_image_url = (data.get('profile_image_url') or '').strip() or None
        
        print(f"👨‍🏫 Registering teacher: {name} ({email})")
        
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "message": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        
        # Check if email already exists
        cursor.execute(
            "SELECT teacher_id FROM teacher WHERE email = %s",
            (email,)
        )
        if cursor.fetchone():
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "message": "Email already registered"
            }), 400
        
        # Hash password
        password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        
        # Generate teacher ID
        teacher_id = f"TCH-{uuid.uuid4().hex[:8].upper()}"
        
        # Insert teacher
        cursor.execute(
            """INSERT INTO teacher 
               (teacher_id, name, email, password_hash, department, profile_image_url, created_at, updated_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
            (teacher_id, name, email, password_hash, department, profile_image_url, 
             datetime.now(), datetime.now())
        )
        
        conn.commit()
        cursor.close()
        conn.close()
        
        print(f"[OK] Teacher registered successfully: {teacher_id}")
        
        return jsonify({
            "success": True,
            "message": "Teacher registered successfully",
            "teacher": {
                "teacher_id": teacher_id,
                "name": name,
                "email": email,
                "department": department
            }
        }), 201
        
    except Exception as e:
        print(f"[ERROR] Registration error: {e}")
        return jsonify({
            "success": False,
            "message": f"Registration failed: {str(e)}"
        }), 500
    
@teacher_bp.route('/api/teacher/profile/email', methods=['GET'])
def get_teacher_by_email():
    email = request.args.get('email')
    
    if not email:
        return jsonify({
            "success": False,
            "error": "Email parameter is required"
        }), 400
    
    print(f"Fetching teacher profile for email: {email}")
    
    conn = getDbConnection()
    if not conn:
        return jsonify({"success": False, "error": "Database connection failed"}), 500
    
    try:
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT teacher_id, name, email, department, profile_image_url, created_at
            FROM teacher 
            WHERE email = %s
        """, (email,))
        
        teacher = cursor.fetchone()
        
        if not teacher:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": "Teacher not found"
            }), 404
        
        # Get column names
        columns = [desc[0] for desc in cursor.description]
        teacher_data = dict(zip(columns, teacher))
        
        cursor.close()
        conn.close()
        
        # Format the response
        profile = {
            "teacher_id": teacher_data['teacher_id'],
            "name": teacher_data['name'],
            "email": teacher_data['email'],
            "department": teacher_data['department'] or "Computer Science",
            "profile_image_url": teacher_data['profile_image_url'] or "",
            "created_at": teacher_data['created_at'].isoformat() if teacher_data['created_at'] else None
        }
        
        print(f"Teacher profile retrieved: {profile['name']}")
        
        return jsonify({
            "success": True,
            "teacher": profile
        })
        
    except Exception as e:
        print(f"Database error: {e}")
        conn.close()
        return jsonify({
            "success": False,
            "error": f"Database error: {str(e)}"
        }), 500


@teacher_bp.route('/api/teacher/profile/update', methods=['PUT'])
def update_teacher_profile():
    data = request.json
    
    if not data or 'teacher_id' not in data:
        return jsonify({
            "success": False,
            "error": "Teacher ID is required"
        }), 400
    
    teacher_id = data['teacher_id']
    
    # Build update query dynamically based on provided fields
    update_fields = []
    values = []
    
    if 'name' in data and data['name']:
        update_fields.append("name = %s")
        values.append(data['name'])
    
    if 'department' in data and data['department']:
        update_fields.append("department = %s")
        values.append(data['department'])
    
    # Note: profile_image_url is updated separately via upload endpoint
    
    if not update_fields:
        return jsonify({
            "success": False,
            "error": "No fields to update"
        }), 400
    
    values.append(teacher_id)
    
    conn = getDbConnection()
    if not conn:
        return jsonify({"success": False, "error": "Database connection failed"}), 500
    
    try:
        cursor = conn.cursor()
        
        query = f"""
            UPDATE teacher 
            SET {', '.join(update_fields)}, updated_at = CURRENT_TIMESTAMP
            WHERE teacher_id = %s
            RETURNING teacher_id, name, email, department, profile_image_url, created_at, updated_at
        """
        
        cursor.execute(query, values)
        updated_teacher = cursor.fetchone()
        
        if not updated_teacher:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": "Teacher not found"
            }), 404
        
        teacher_data = row_to_dict(cursor, updated_teacher)
        
        conn.commit()
        cursor.close()
        conn.close()
        
        response_data = {
            "teacher_id": teacher_data['teacher_id'],
            "name": teacher_data['name'],
            "email": teacher_data['email'],
            "department": teacher_data['department'] or "Computer Science",
            "profile_image_url": teacher_data['profile_image_url'] or "",
            "created_at": teacher_data['created_at'].isoformat() if teacher_data['created_at'] else None,
            "updated_at": teacher_data['updated_at'].isoformat() if teacher_data['updated_at'] else None
        }
        
        return jsonify({
            "success": True,
            "message": "Profile updated successfully",
            "teacher": response_data
        })
        
    except Exception as e:
        print(f"Update error: {e}")
        if conn:
            conn.close()
        return jsonify({
            "success": False,
            "error": f"Update failed: {str(e)}"
        }), 500
    
@teacher_bp.route('/api/teacher/upload-image', methods=['POST'])
def upload_teacher_image():
    # Check if file is in request
    if 'image' not in request.files:
        return jsonify({
            "success": False,
            "error": "No file provided"
        }), 400
    
    file = request.files['image']
    teacher_id = request.form.get('teacher_id')
    
    if not teacher_id:
        return jsonify({
            "success": False,
            "error": "Teacher ID is required"
        }), 400
    
    if file.filename == '':
        return jsonify({
            "success": False,
            "error": "No file selected"
        }), 400
    
    if file and allowed_file(file.filename):
        try:
            # Secure the filename
            filename = secure_filename(file.filename)
            
            # Create unique filename: teacher_id_timestamp.extension
            timestamp = datetime.now().strftime('%Y%m%d%H%M%S')
            extension = filename.rsplit('.', 1)[1].lower()
            unique_filename = f"teacher_{teacher_id}_{timestamp}.{extension}"
            
            # Create uploads directory if it doesn't exist
            upload_folder = 'uploads/profile_images'
            if not os.path.exists(upload_folder):
                os.makedirs(upload_folder)
            
            # Save file
            filepath = os.path.join(upload_folder, unique_filename)
            file.save(filepath)
            
            # Create URL for the image
            image_url = f"/uploads/profile_images/{unique_filename}"
            
            # Update teacher profile in database
            conn = getDbConnection()
            if not conn:
                return jsonify({"success": False, "error": "Database connection failed"}), 500
            
            cursor = conn.cursor()
            
            cursor.execute("""
                UPDATE teacher 
                SET profile_image_url = %s, updated_at = CURRENT_TIMESTAMP
                WHERE teacher_id = %s
                RETURNING teacher_id, name, profile_image_url
            """, (image_url, teacher_id))
            
            updated_teacher = cursor.fetchone()
            
            if not updated_teacher:
                cursor.close()
                conn.close()
                return jsonify({
                    "success": False,
                    "error": "Teacher not found"
                }), 404
            
            conn.commit()
            cursor.close()
            conn.close()
            
            return jsonify({
                "success": True,
                "message": "Image uploaded successfully",
                "image_url": image_url,
                "teacher_id": updated_teacher[0]
            })
            
        except Exception as e:
            print(f"Image upload error: {e}")
            return jsonify({
                "success": False,
                "error": f"Upload failed: {str(e)}"
            }), 500
    
    return jsonify({
        "success": False,
        "error": "File type not allowed. Allowed types: png, jpg, jpeg, gif"
    }), 400

@teacher_bp.route('/api/teacher/test', methods=['GET'])
def test_route():
    return jsonify({
        "success": True,
        "message": "Teacher API is working!",
        "endpoints": {
            "get_profile": "/api/teacher/profile/email?email=TEACHER_EMAIL",
            "update_profile": "/api/teacher/profile/update (PUT)",
            "upload_image": "/api/teacher/upload-image (POST)"
        }
    })

@teacher_bp.route('/api/teacher/<teacher_id>', methods=['GET'])
def get_teacher_by_id(teacher_id):
    """Fetch teacher details by teacher_id"""
    try:
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
            
        cursor = conn.cursor()
        
        # Query to get teacher details
        query = """
            SELECT teacher_id, name, email, department, profile_image_url, created_at
            FROM teacher
            WHERE teacher_id = %s
        """
        
        cursor.execute(query, (teacher_id,))
        result = cursor.fetchone()
        
        if not result:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": "Teacher not found"
            }), 404
        
        # Get column names
        columns = [desc[0] for desc in cursor.description]
        teacher_data = dict(zip(columns, result))
        
        # Split name into first_name and last_name if needed
        name_parts = teacher_data['name'].split(' ', 1)
        first_name = name_parts[0]
        last_name = name_parts[1] if len(name_parts) > 1 else ""
        
        teacher_info = {
            "teacher_id": teacher_data['teacher_id'],
            "first_name": first_name,
            "last_name": last_name,
            "name": teacher_data['name'],
            "email": teacher_data['email'],
            "department": teacher_data['department'] or "Computer Science",
            "profile_image_url": teacher_data['profile_image_url'] or "",
            "created_at": teacher_data['created_at'].isoformat() if teacher_data['created_at'] else None
        }
        
        cursor.close()
        conn.close()
        
        return jsonify({
            "success": True,
            "teacher": teacher_info
        })
        
    except Exception as e:
        print(f"Error fetching teacher {teacher_id}: {e}")
        return jsonify({
            "success": False,
            "error": f"Database error: {str(e)}"
        }), 500

@teacher_bp.route('/api/teacher/by-course/<course_code>', methods=['GET'])
def get_teacher_by_course(course_code):
    """Get teacher teaching a specific course by course code"""
    try:
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        
        # Get teacher who teaches this course
        cursor.execute("""
            SELECT 
                t.teacher_id,
                t.name,
                t.email,
                t.department,
                t.profile_image_url,
                c.course_id,
                c.title
            FROM teacher t
            INNER JOIN course c ON t.teacher_id = c.teacher_id
            WHERE c.course_code = %s
            LIMIT 1
        """, (course_code,))
        
        result = cursor.fetchone()
        
        if not result:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": "No teacher found for this course"
            }), 404
        
        cursor.close()
        conn.close()
        
        return jsonify({
            "success": True,
            "teacher": {
                "teacher_id": result[0],
                "name": result[1],
                "email": result[2],
                "department": result[3] or "",
                "profile_image_url": result[4] or "",
                "course_id": result[5],
                "course_title": result[6]
            }
        }), 200
        
    except Exception as e:
        print(f"Error getting teacher by course: {e}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

@teacher_bp.route('/api/course/<course_code>/students', methods=['GET'])
def get_course_students(course_code):
    """Get all students enrolled in a course"""
    try:
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        
        # Get all students enrolled in this course
        cursor.execute("""
            SELECT 
                s.student_id,
                s.name,
                s.email,
                e.enrollment_id
            FROM student s
            INNER JOIN enrollment e ON s.student_id = e.student_id
            INNER JOIN course c ON e.course_id = c.course_id
            WHERE c.course_code = %s AND e.is_active = true
            ORDER BY s.name
        """, (course_code,))
        
        results = cursor.fetchall()
        
        students = []
        for result in results:
            students.append({
                "student_id": result[0],
                "name": result[1],
                "email": result[2]
            })
        
        cursor.close()
        conn.close()
        
        return jsonify({
            "success": True,
            "students": students,
            "count": len(students)
        }), 200
        
    except Exception as e:
        print(f"Error getting course students: {e}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

@teacher_bp.route('/api/teacher/profile', methods=['GET'])
def get_teacher_profile():
    """Get teacher profile by ID"""
    teacher_id = request.args.get('id')
    
    if not teacher_id:
        return jsonify({
            "success": False,
            "error": "Teacher ID is required"
        }), 400
    
    conn = getDbConnection()
    if not conn:
        return jsonify({"success": False, "error": "Database connection failed"}), 500
    
    try:
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT teacher_id, name, email, department, profile_image_url, 
                   created_at, updated_at
            FROM teacher 
            WHERE teacher_id = %s
        """, (teacher_id,))
        
        teacher = cursor.fetchone()
        
        if not teacher:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": "Teacher not found"
            }), 404
        
        columns = [desc[0] for desc in cursor.description]
        teacher_data = dict(zip(columns, teacher))
        
        cursor.close()
        conn.close()
        
        return jsonify({
            "success": True,
            "teacher": {
                "teacher_id": teacher_data['teacher_id'],
                "name": teacher_data['name'],
                "email": teacher_data['email'],
                "department": teacher_data['department'] or "",
                "profile_image_url": teacher_data['profile_image_url'] or "",
                "created_at": teacher_data['created_at'].isoformat() if teacher_data['created_at'] else None,
                "updated_at": teacher_data['updated_at'].isoformat() if teacher_data['updated_at'] else None
            }
        })
        
    except Exception as e:
        print(f"Database error: {e}")
        conn.close()
        return jsonify({
            "success": False,
            "error": f"Database error: {str(e)}"
        }), 500
    
@teacher_bp.route('/api/teacher/profile/current', methods=['GET'])
def get_current_teacher_profile():
    """
    Get the profile of the currently logged-in teacher.
    This endpoint expects the teacher's email to be passed in the request.
    """
    # Get email from request headers or query parameters
    teacher_email = request.headers.get('X-Teacher-Email') or request.args.get('email')
    
    if not teacher_email:
        return jsonify({
            "success": False,
            "error": "Teacher email is required. Please provide it in headers (X-Teacher-Email) or query parameter (email)."
        }), 400
    
    print(f"Fetching current teacher profile for email: {teacher_email}")
    
    conn = getDbConnection()
    if not conn:
        return jsonify({"success": False, "error": "Database connection failed"}), 500
    
    try:
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT teacher_id, name, email, department, profile_image_url, created_at, updated_at
            FROM teacher 
            WHERE email = %s
        """, (teacher_email,))
        
        teacher = cursor.fetchone()
        
        if not teacher:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": "Teacher not found"
            }), 404
        
        # Get column names
        columns = [desc[0] for desc in cursor.description]
        teacher_data = dict(zip(columns, teacher))
        
        cursor.close()
        conn.close()
        
        # Format the response
        profile = {
            "teacher_id": teacher_data['teacher_id'],
            "name": teacher_data['name'],
            "email": teacher_data['email'],
            "department": teacher_data['department'] or "Not specified",
            "profile_image_url": teacher_data['profile_image_url'] or "",
            "created_at": teacher_data['created_at'].isoformat() if teacher_data['created_at'] else None,
            "updated_at": teacher_data['updated_at'].isoformat() if teacher_data['updated_at'] else None
        }
        
        print(f"Current teacher profile retrieved: {profile['name']}")
        
        return jsonify({
            "success": True,
            "teacher": profile
        })
        
    except Exception as e:
        print(f"Database error in get_current_teacher_profile: {e}")
        if conn:
            conn.close()
        return jsonify({
            "success": False,
            "error": f"Database error: {str(e)}"
        }), 500

# ===== COURSES API ENDPOINT =====

@teacher_bp.route('/api/teacher/courses', methods=['GET'])
def get_teacher_courses():
    """Get all courses for a teacher with accurate student count"""
    teacher_id = request.args.get('teacher_id')
    
    if not teacher_id:
        return jsonify({
            "success": False,
            "error": "Teacher ID is required"
        }), 400
    
    print(f"📚 Fetching courses for teacher ID: {teacher_id}")
    
    conn = getDbConnection()
    if not conn:
        return jsonify({"success": False, "error": "Database connection failed"}), 500
    
    try:
        cursor = conn.cursor()
        
        # Get courses with accurate student count from enrollment table
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
                COALESCE(enrollment_count.student_count, 0) as student_count
            FROM course c
            LEFT JOIN (
                SELECT 
                    course_id, 
                    COUNT(DISTINCT student_id) as student_count
                FROM enrollment 
                WHERE is_active = true
                GROUP BY course_id
            ) enrollment_count ON c.course_id = enrollment_count.course_id
            WHERE c.teacher_id = %s
            ORDER BY c.course_code
        """, (teacher_id,))
        
        courses = cursor.fetchall()
        
        # Get column names
        columns = [desc[0] for desc in cursor.description]
        
        courses_list = []
        for course in courses:
            course_dict = dict(zip(columns, course))
            courses_list.append({
                "id": course_dict['course_id'],  # Use course_id directly
                "course_id": course_dict['course_id'],  # Keep course_id as well
                "course_code": course_dict['course_code'],
                "title": course_dict['title'],
                "description": course_dict['description'] or "",
                "credit_hours": course_dict['credit_hours'],
                "department": course_dict['department'] or "",
                "semester": course_dict['semester'],
                "status": course_dict['status'] or "active",
                "max_students": course_dict['max_students'],
                "schedule": course_dict['schedule'] or "",
                "student_count": course_dict['student_count'],  # This should now be accurate
                "created_at": course_dict['created_at'].isoformat() if course_dict['created_at'] else None
            })
        
        cursor.close()
        conn.close()
        
        print(f"[OK] Found {len(courses_list)} courses for teacher {teacher_id}")
        
        return jsonify({
            "success": True,
            "courses": courses_list,
            "count": len(courses_list)
        })
        
    except Exception as e:
        print(f"[ERROR] Database error in get_teacher_courses: {e}")
        if conn:
            conn.close()
        return jsonify({
            "success": False,
            "error": f"Database error: {str(e)}"
        }), 500

    
    # ===== SCHEDULE API ENDPOINTS =====

@teacher_bp.route('/api/teacher/schedule/create', methods=['POST'])
def create_schedule():
    """Create a new class session/schedule"""
    try:
        data = request.json
        
        # Debug: print received data
        print(f"📝 Received schedule data: {data}")
        
        # Required fields validation
        required_fields = ['course_id', 'title', 'start_time', 'end_time', 'teacher_id']
        for field in required_fields:
            if field not in data or not data[field]:
                return jsonify({
                    "success": False,
                    "error": f"Missing required field: {field}"
                }), 400
        
        print(f"📝 Creating new schedule for teacher: {data['teacher_id']}")

        timezone_str = get_user_timezone()
        print(f"🕒 User timezone for schedule creation: {timezone_str}")
        
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        
        # First, verify the course belongs to the teacher
        cursor.execute("""
            SELECT course_id FROM course 
            WHERE course_id = %s AND teacher_id = %s AND status = 'active'
        """, (data['course_id'], data['teacher_id']))
        
        course = cursor.fetchone()
        
        if not course:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": "Course not found or does not belong to teacher"
            }), 404
        
        # Prepare data for insertion
        meeting_room_id = data.get('meeting_room_id') or f"room-{data['course_id']}-{int(time.time())}"
        
        # Generate token using the helper function
        meeting_token = data.get('meeting_token') or generate_secure_token(16)
        
        # Default values
        is_private = data.get('is_private', False)
        status = data.get('status', 'scheduled')
        recording_available = data.get('recording_available', False)
        participants_count = data.get('participants_count', 0)
        notes = data.get('notes', '')
        description = data.get('description', '')
        recording_path = data.get('recording_path', '')
        
        # Handle materials array (convert to PostgreSQL array format)
        materials = data.get('materials', [])
        if isinstance(materials, list) and materials:
            # Filter out empty strings
            materials = [m for m in materials if m.strip()]
            materials_array = "{" + ",".join(materials) + "}"
        else:
            materials_array = "{}"  # Empty array
        
        # Debug print before insertion
        print(f"📝 Inserting schedule with data:")
        print(f"  course_id: {data['course_id']}")
        print(f"  title: {data['title']}")
        print(f"  start_time: {data['start_time']}")
        print(f"  end_time: {data['end_time']}")
        print(f"  meeting_room_id: {meeting_room_id}")
        print(f"  meeting_token: {meeting_token}")

        try:
            start_local = datetime.fromisoformat(str(data['start_time']))
            end_local = datetime.fromisoformat(str(data['end_time']))
        except ValueError:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": "Invalid datetime format. Expected ISO format from frontend."
            }), 400

        # Convert user-local datetime to UTC before database storage.
        start_utc = local_to_utc(start_local, timezone_str).replace(tzinfo=None)
        end_utc = local_to_utc(end_local, timezone_str).replace(tzinfo=None)

        print(f"  start_time_utc: {start_utc.isoformat()}")
        print(f"  end_time_utc: {end_utc.isoformat()}")
        
        # Insert the session
        insert_query = """
        INSERT INTO class_session (
            course_id,
            title,
            description,
            start_time,
            end_time,
            meeting_room_id,
            meeting_token,
            is_private,
            recording_path,
            recording_available,
            status,
            participants_count,
            materials,
            notes
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING session_id
        """
        
        try:
            cursor.execute(insert_query, (
                data['course_id'],
                data['title'],
                description,
                start_utc,
                end_utc,
                meeting_room_id,
                meeting_token,
                is_private,
                recording_path,
                recording_available,
                status,
                participants_count,
                materials_array,
                notes
            ))
            
            session_id = cursor.fetchone()[0]
            conn.commit()
            
            print(f"[OK] Schedule created successfully. Session ID: {session_id}")
            
            cursor.close()
            conn.close()
            
            return jsonify({
                "success": True,
                "message": "Schedule created successfully",
                "session_id": session_id,
                "meeting_room_id": meeting_room_id,
                "meeting_token": meeting_token,
                "start_time_utc": to_utc_and_pkt_iso(start_utc)[0],
                "start_time_pkt": to_utc_and_pkt_iso(start_utc)[1],
                "end_time_utc": to_utc_and_pkt_iso(end_utc)[0],
                "end_time_pkt": to_utc_and_pkt_iso(end_utc)[1]
            })
            
        except psycopg2.Error as e:
            print(f"[ERROR] PostgreSQL Error in create_schedule: {e}")
            conn.rollback()
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": f"Database error: {str(e)}"
            }), 500
        
    except Exception as e:
        print(f"[ERROR] Error in create_schedule: {e}")
        if 'conn' in locals() and conn:
            try:
                conn.rollback()
                cursor.close()
                conn.close()
            except:
                pass
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@teacher_bp.route('/api/teacher/schedule/today', methods=['GET'])
def get_today_schedule():
    """Get today's class sessions for a teacher with accurate participant counts"""
    teacher_id = (request.args.get('teacher_id') or '').strip()
    requested_date = (request.args.get('date') or '').strip()
    timezone_str = get_user_timezone()
    
    if not teacher_id:
        return jsonify({
            "success": False,
            "error": "Teacher ID is required"
        }), 400
    
    print("📅 Teacher schedule request received")
    print(f"   teacher_id={teacher_id}")
    print(f"   requested_date={requested_date or 'CURRENT_DATE'}")
    print(f"   user_timezone={timezone_str}")
    
    conn = getDbConnection()
    if not conn:
        return jsonify({"success": False, "error": "Database connection failed"}), 500
    
    try:
        cursor = conn.cursor()

        # Resolve the date window once so we can inspect the exact range in logs.
        if requested_date:
            try:
                query_date = datetime.strptime(requested_date, "%Y-%m-%d").date()
            except ValueError:
                return jsonify({
                    "success": False,
                    "error": "Invalid date format. Use YYYY-MM-DD"
                }), 400
        else:
            tz_now = utc_to_local(datetime.utcnow(), timezone_str)
            query_date = tz_now.date()

        day_start_utc, day_end_utc = get_day_range_utc(timezone_str, query_date)
        # DB currently stores timestamps as UTC-naive values.
        day_start = day_start_utc.replace(tzinfo=None)
        day_end = day_end_utc.replace(tzinfo=None)

        print(f"   query_date={query_date.isoformat()}")
        print(f"   day_start_utc={day_start.isoformat()}")
        print(f"   day_end_utc={day_end.isoformat()} (exclusive)")
        
        # Updated query to get enrolled student count for each course
        query = """
        SELECT 
            cs.session_id,
            cs.course_id,
            cs.title as session_title,
            cs.description as session_description,
            cs.start_time,
            cs.end_time,
            cs.meeting_room_id,
            cs.meeting_token,
            cs.is_private,
            cs.status as session_status,
            cs.participants_count,
            cs.recording_available,
            c.course_code,
            c.title as course_title,
            c.description as course_description,
            c.credit_hours,
            c.department,
            c.semester,
            c.status as course_status,
            COALESCE(enrolled.student_count, 0) as enrolled_students
        FROM class_session cs
        JOIN course c ON cs.course_id = c.course_id
        LEFT JOIN (
            SELECT 
                course_id, 
                COUNT(DISTINCT student_id) as student_count
            FROM enrollment 
            WHERE is_active = true
            GROUP BY course_id
        ) enrolled ON c.course_id = enrolled.course_id
                WHERE TRIM(c.teacher_id) = TRIM(%s)
                    AND cs.start_time >= %s
                    AND cs.start_time < %s
          AND cs.status IN ('scheduled', 'ongoing')
          AND c.status = 'active'
        ORDER BY cs.start_time ASC
        """
        
        print("🧾 Executing schedule query with parameters:")
        print(f"   teacher_id={teacher_id}")
        print(f"   start={day_start}")
        print(f"   end={day_end}")
        print("🧾 SQL:")
        print(query)

        cursor.execute(query, (teacher_id, day_start, day_end))
        sessions = cursor.fetchall()
        print(f"   raw_rows_returned={len(sessions)}")
        
        # Get column names
        columns = [desc[0] for desc in cursor.description]
        print(f"   columns={columns}")
        
        sessions_list = []
        for session in sessions:
            session_dict = dict(zip(columns, session))
            print(f"   raw_session_row={session_dict}")
            
            # Use enrolled student count instead of participants_count
            enrolled_students = session_dict.get('enrolled_students', 0)
            
            # Format the session data
            formatted_session = {
                "session_id": session_dict['session_id'],
                "course_id": session_dict['course_id'],
                "course_code": session_dict['course_code'],
                "course_title": session_dict['course_title'],
                "course_description": session_dict['course_description'] or "",
                "session_title": session_dict['session_title'],
                "session_description": session_dict['session_description'] or "",
                "start_time": utc_to_local(session_dict['start_time'], timezone_str).isoformat() if session_dict['start_time'] else None,
                "end_time": utc_to_local(session_dict['end_time'], timezone_str).isoformat() if session_dict['end_time'] else None,
                "start_time_utc": to_utc_and_pkt_iso(session_dict['start_time'])[0] if session_dict['start_time'] else None,
                "start_time_pkt": to_utc_and_pkt_iso(session_dict['start_time'])[1] if session_dict['start_time'] else None,
                "end_time_utc": to_utc_and_pkt_iso(session_dict['end_time'])[0] if session_dict['end_time'] else None,
                "end_time_pkt": to_utc_and_pkt_iso(session_dict['end_time'])[1] if session_dict['end_time'] else None,
                "meeting_room_id": session_dict['meeting_room_id'] or "",
                "meeting_token": session_dict['meeting_token'] or "",
                "is_private": session_dict['is_private'],
                "status": session_dict['session_status'],
                "participants_count": enrolled_students,  # Use enrolled students count
                "recording_available": session_dict['recording_available'] or False,
                "credit_hours": session_dict['credit_hours'],
                "department": session_dict['department'] or "",
                "semester": session_dict['semester'] or "",
                "course_status": session_dict['course_status']
            }
            
            # Format time for display
            start_time = utc_to_local(session_dict['start_time'], timezone_str) if session_dict['start_time'] else None
            end_time = utc_to_local(session_dict['end_time'], timezone_str) if session_dict['end_time'] else None
            if start_time:
                # Format as "10:00 AM" (remove leading zero)
                time_str = start_time.strftime("%I:%M %p")
                if time_str.startswith('0'):
                    time_str = time_str[1:]
                formatted_session["display_time"] = time_str
                formatted_session["display_date"] = start_time.strftime("%B %d, %Y")
                
                # Calculate duration
                if end_time:
                    duration_minutes = (end_time - start_time).seconds / 60
                    if duration_minutes >= 60:
                        duration_hours = duration_minutes / 60
                        formatted_session["duration"] = f"{duration_hours:.1f} hours"
                    else:
                        formatted_session["duration"] = f"{duration_minutes:.0f} minutes"
            
            # Determine type for display
            session_title_lower = (session_dict['session_title'] or "").lower()
            if "meeting" in session_title_lower:
                formatted_session["type"] = "Meeting"
            elif any(word in session_title_lower for word in ['lab', 'workshop', 'practical']):
                formatted_session["type"] = "Lab Session"
            elif any(word in session_title_lower for word in ['lecture', 'class', 'tutorial']):
                formatted_session["type"] = "Lecture"
            else:
                formatted_session["type"] = "Session"
            
            # Check if session is currently live (ongoing)
            now = utc_to_local(datetime.utcnow(), timezone_str)
            if start_time and end_time:
                if start_time <= now <= end_time:
                    formatted_session["status"] = "ongoing"
                    formatted_session["type"] = "Live Now"
                    formatted_session["is_live"] = True
                elif now > end_time:
                    formatted_session["status"] = "completed"
            
            sessions_list.append(formatted_session)
        
        cursor.close()
        conn.close()
        
        print(f"[OK] Found {len(sessions_list)} sessions for teacher {teacher_id} today")
        print(f"[OK] schedule response date={query_date.isoformat()} sessions={len(sessions_list)}")
        
        return jsonify({
            "success": True,
            "date": query_date.isoformat(),
            "display_date": query_date.strftime("%B %d, %Y"),
            "user_timezone": timezone_str,
            "sessions": sessions_list,
            "count": len(sessions_list)
        })
        
    except Exception as e:
        print(f"[ERROR] Database error in get_today_schedule: {e}")
        import traceback
        traceback.print_exc()
        if conn:
            conn.close()
        return jsonify({
            "success": False,
            "error": f"Database error: {str(e)}"
        }), 500

@teacher_bp.route('/api/teacher/schedule/<int:session_id>', methods=['GET'])
def get_schedule_detail(session_id):
    """Get detailed information about a specific schedule"""
    try:
        print(f"🔍 Getting schedule details for session: {session_id}")
        
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        
        query = """
        SELECT 
            cs.*,
            c.course_code,
            c.title as course_title,
            c.description as course_description,
            c.credit_hours,
            c.department,
            c.semester,
            c.teacher_id,
            t.name as teacher_name,
            t.email as teacher_email
        FROM class_session cs
        JOIN course c ON cs.course_id = c.course_id
        JOIN teacher t ON c.teacher_id = t.teacher_id
        WHERE cs.session_id = %s
        """
        
        cursor.execute(query, (session_id,))
        session = cursor.fetchone()
        
        if not session:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": "Schedule not found"
            }), 404
        
        # Get column names
        columns = [desc[0] for desc in cursor.description]
        session_dict = dict(zip(columns, session))
        
        # Parse materials
        materials_str = session_dict.get('materials', '{}')
        if materials_str and materials_str != '{}':
            materials = [m.strip() for m in materials_str.strip('{}').split(',') if m.strip()]
        else:
            materials = []
        
        formatted_session = {
            "session_id": session_dict['session_id'],
            "course_id": session_dict['course_id'],
            "course_code": session_dict['course_code'],
            "course_title": session_dict['course_title'],
            "course_description": session_dict['course_description'] or "",
            "session_title": session_dict['title'],
            "session_description": session_dict['description'] or "",
            "start_time": session_dict['start_time'].isoformat() if session_dict['start_time'] else None,
            "end_time": session_dict['end_time'].isoformat() if session_dict['end_time'] else None,
            "meeting_room_id": session_dict['meeting_room_id'] or "",
            "meeting_token": session_dict['meeting_token'] or "",
            "is_private": session_dict['is_private'],
            "status": session_dict['status'],
            "participants_count": session_dict['participants_count'] or 0,
            "recording_available": session_dict['recording_available'] or False,
            "recording_path": session_dict['recording_path'] or "",
            "materials": materials,
            "notes": session_dict['notes'] or "",
            "credit_hours": session_dict['credit_hours'],
            "department": session_dict['department'] or "",
            "semester": session_dict['semester'] or "",
            "teacher_id": session_dict['teacher_id'],
            "teacher_name": session_dict['teacher_name'],
            "teacher_email": session_dict['teacher_email'],
            "created_at": session_dict['created_at'].isoformat() if session_dict['created_at'] else None,
            "updated_at": session_dict['updated_at'].isoformat() if session_dict['updated_at'] else None,
            "started_at": session_dict['started_at'].isoformat() if session_dict['started_at'] else None,
            "ended_at": session_dict['ended_at'].isoformat() if session_dict['ended_at'] else None
        }
        
        cursor.close()
        conn.close()
        
        print(f"[OK] Retrieved schedule details for session {session_id}")
        
        return jsonify({
            "success": True,
            "schedule": formatted_session
        })
        
    except Exception as e:
        print(f"[ERROR] Error in get_schedule_detail: {e}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

@teacher_bp.route('/api/teacher/schedule/<int:session_id>', methods=['PUT'])
def update_schedule(session_id):
    """Update an existing schedule"""
    try:
        data = request.json
        
        if not data:
            return jsonify({
                "success": False,
                "error": "No data provided"
            }), 400
        
        print(f"✏️ Updating schedule: {session_id}")
        
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        
        # First, check if the schedule exists and get teacher_id for authorization
        cursor.execute("""
            SELECT c.teacher_id 
            FROM class_session cs
            JOIN course c ON cs.course_id = c.course_id
            WHERE cs.session_id = %s
        """, (session_id,))
        
        result = cursor.fetchone()
        
        if not result:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": "Schedule not found"
            }), 404
        
        # Teacher ID for the course
        course_teacher_id = result[0]
        
        # Optional: Check if the requesting teacher owns this schedule
        # Uncomment if you want to add authorization
        # requesting_teacher_id = data.get('teacher_id')
        # if requesting_teacher_id and requesting_teacher_id != course_teacher_id:
        #     return jsonify({
        #         "success": False,
        #         "error": "Unauthorized: You don't own this schedule"
        #     }), 403
        
        # Build update query dynamically
        update_fields = []
        values = []
        
        allowed_fields = [
            'title', 'description', 'start_time', 'end_time',
            'meeting_room_id', 'meeting_token', 'is_private',
            'recording_path', 'recording_available', 'status',
            'participants_count', 'notes'
        ]
        
        for field in allowed_fields:
            if field in data:
                update_fields.append(f"{field} = %s")
                values.append(data[field])
        
        # Handle materials separately (array field)
        if 'materials' in data and isinstance(data['materials'], list):
            materials = [m for m in data['materials'] if m.strip()]
            materials_array = "{" + ",".join(materials) + "}"
            update_fields.append("materials = %s")
            values.append(materials_array)
        
        if not update_fields:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": "No fields to update"
            }), 400
        
        # Add session_id to values
        values.append(session_id)
        
        # Add updated_at timestamp
        update_fields.append("updated_at = CURRENT_TIMESTAMP")
        
        query = f"""
        UPDATE class_session 
        SET {', '.join(update_fields)}
        WHERE session_id = %s
        RETURNING session_id, title, status, start_time
        """
        
        cursor.execute(query, tuple(values))
        updated_session = cursor.fetchone()
        
        conn.commit()
        cursor.close()
        conn.close()
        
        print(f"[OK] Schedule updated successfully: {session_id}")
        
        return jsonify({
            "success": True,
            "message": "Schedule updated successfully",
            "session_id": updated_session[0],
            "title": updated_session[1],
            "status": updated_session[2],
            "start_time": updated_session[3].isoformat() if updated_session[3] else None
        })
        
    except Exception as e:
        print(f"[ERROR] Error in update_schedule: {e}")
        if conn:
            conn.rollback()
            conn.close()
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

@teacher_bp.route('/api/teacher/schedule/<int:session_id>', methods=['DELETE'])
def delete_schedule(session_id):
    """Delete a schedule"""
    try:
        teacher_id = request.args.get('teacher_id')
        
        if not teacher_id:
            return jsonify({
                "success": False,
                "error": "Teacher ID is required for authorization"
            }), 400
        
        print(f"🗑️ Deleting schedule: {session_id} by teacher: {teacher_id}")
        
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        
        # First, verify the schedule belongs to the teacher
        cursor.execute("""
            SELECT cs.session_id 
            FROM class_session cs
            JOIN course c ON cs.course_id = c.course_id
            WHERE cs.session_id = %s AND c.teacher_id = %s
        """, (session_id, teacher_id))
        
        schedule = cursor.fetchone()
        
        if not schedule:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": "Schedule not found or you don't have permission to delete it"
            }), 404
        
        # Delete the schedule
        cursor.execute("DELETE FROM class_session WHERE session_id = %s", (session_id,))
        
        conn.commit()
        cursor.close()
        conn.close()
        
        print(f"[OK] Schedule deleted successfully: {session_id}")
        
        return jsonify({
            "success": True,
            "message": "Schedule deleted successfully"
        })
        
    except Exception as e:
        print(f"[ERROR] Error in delete_schedule: {e}")
        if conn:
            conn.rollback()
            conn.close()
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

@teacher_bp.route('/api/teacher/schedule/upcoming', methods=['GET'])
@teacher_bp.route('/api/teacher/schedule/upcoming', methods=['GET'])
def get_upcoming_schedules():
    """Get upcoming schedules for a teacher"""
    try:
        teacher_id = request.args.get('teacher_id')
        days = int(request.args.get('days', 7))  # Default: next 7 days
        
        if not teacher_id:
            return jsonify({
                "success": False,
                "error": "Teacher ID is required"
            }), 400
        
        print(f"📅 Getting upcoming schedules for teacher: {teacher_id} (next {days} days)")
        
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        
        # FIXED: Use proper PostgreSQL interval syntax
        query = """
        SELECT 
            cs.session_id,
            cs.course_id,
            cs.title as session_title,
            cs.start_time,
            cs.end_time,
            cs.meeting_room_id,
            cs.status,
            c.course_code,
            c.title as course_title
        FROM class_session cs
        JOIN course c ON cs.course_id = c.course_id
        WHERE c.teacher_id = %s
          AND cs.start_time >= CURRENT_TIMESTAMP
          AND cs.start_time <= CURRENT_TIMESTAMP + INTERVAL '1 day' * %s
          AND cs.status IN ('scheduled', 'ongoing')
        ORDER BY cs.start_time ASC
        """
        
        cursor.execute(query, (teacher_id, days))
        upcoming_sessions = cursor.fetchall()
        
        sessions_list = []
        for session in upcoming_sessions:
            session_dict = {
                "session_id": session[0],
                "course_id": session[1],
                "session_title": session[2],
                "start_time": session[3].isoformat() if session[3] else None,
                "end_time": session[4].isoformat() if session[4] else None,
                "meeting_room_id": session[5] or "",
                "status": session[6],
                "course_code": session[7],
                "course_title": session[8]
            }
            
            # Calculate days until session
            if session[3]:
                days_until = (session[3] - datetime.now()).days
                session_dict["days_until"] = days_until
                
                # Add human readable time
                time_str = session[3].strftime("%I:%M %p")
                if time_str.startswith('0'):
                    time_str = time_str[1:]
                session_dict["display_time"] = time_str
                session_dict["display_date"] = session[3].strftime("%B %d, %Y")
            
            sessions_list.append(session_dict)
        
        cursor.close()
        conn.close()
        
        print(f"[OK] Found {len(sessions_list)} upcoming schedules for teacher {teacher_id}")
        
        return jsonify({
            "success": True,
            "upcoming_schedules": sessions_list,
            "count": len(sessions_list),
            "days_ahead": days
        })
        
    except Exception as e:
        print(f"[ERROR] Error in get_upcoming_schedules: {e}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500
    
def generate_secure_token(length=16):
    """Generate a secure random token"""
    characters = string.ascii_letters + string.digits
    return ''.join(random.choice(characters) for _ in range(length))

    
@teacher_bp.route('/api/test/enrollment', methods=['GET'])
def test_enrollment_data():
    """Test endpoint to verify enrollment data exists"""
    conn = getDbConnection()
    if not conn:
        return jsonify({"success": False, "error": "Database connection failed"}), 500
    
    try:
        cursor = conn.cursor()
        
        # Check total enrollment count
        cursor.execute("SELECT COUNT(*) FROM enrollment WHERE is_active = true")
        total_enrollments = cursor.fetchone()[0]
        
        # Check sample data
        cursor.execute("""
            SELECT e.course_id, c.course_code, c.title, 
                   COUNT(e.student_id) as student_count
            FROM enrollment e
            JOIN course c ON e.course_id = c.course_id
            WHERE e.is_active = true
            GROUP BY e.course_id, c.course_code, c.title
            LIMIT 10
        """)
        
        sample_data = cursor.fetchall()
        
        cursor.close()
        conn.close()
        
        return jsonify({
            "success": True,
            "total_active_enrollments": total_enrollments,
            "sample_courses": [
                {
                    "course_id": row[0],
                    "course_code": row[1],
                    "title": row[2],
                    "student_count": row[3]
                }
                for row in sample_data
            ]
        })
        
    except Exception as e:
        print(f"[ERROR] Test error: {e}")
        if conn:
            conn.close()
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

@teacher_bp.route('/api/teacher/sessions', methods=['GET'])
def get_teacher_sessions():
    """Get all sessions scheduled by a specific teacher"""
    try:
        teacher_id = request.args.get('teacher_id')
        
        if not teacher_id:
            return jsonify({
                "success": False,
                "error": "Teacher ID is required"
            }), 400
        
        print(f"📅 Getting sessions for teacher: {teacher_id}")
        
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        
        # Get all sessions created/scheduled by this teacher
        # Join course to filter by teacher_id (teacher teaches the course)
        cursor.execute("""
            SELECT 
                cs.session_id,
                cs.title,
                cs.description,
                cs.start_time,
                cs.end_time,
                cs.meeting_room_id,
                cs.meeting_token,
                cs.is_private,
                cs.status,
                cs.recording_path,
                cs.recording_available,
                c.course_id,
                c.course_code,
                c.title as course_title,
                COUNT(DISTINCT e.student_id) as participants_count
            FROM class_session cs
            JOIN course c ON cs.course_id = c.course_id
            LEFT JOIN enrollment e ON c.course_id = e.course_id AND e.is_active = TRUE
            WHERE c.teacher_id = %s
            GROUP BY cs.session_id, c.course_id, c.course_code, c.title
            ORDER BY cs.start_time DESC
        """, (teacher_id,))
        
        sessions_raw = cursor.fetchall()
        
        sessions = []
        for session in sessions_raw:
            start_time_utc, start_time_pkt = to_utc_and_pkt_iso(session[3])
            end_time_utc, end_time_pkt = to_utc_and_pkt_iso(session[4])
            sessions.append({
                "session_id": session[0],
                "title": session[1],
                "description": session[2],
                "start_time": start_time_utc,
                "end_time": end_time_utc,
                "start_time_utc": start_time_utc,
                "start_time_pkt": start_time_pkt,
                "end_time_utc": end_time_utc,
                "end_time_pkt": end_time_pkt,
                "meeting_room_id": session[5],
                "meeting_token": session[6],
                "is_private": session[7],
                "status": session[8],
                "recording_path": session[9],
                "recording_available": session[10],
                "course_id": session[11],
                "course_code": session[12],
                "course_title": session[13],
                "participants_count": session[14] or 0
            })
        
        cursor.close()
        conn.close()
        
        print(f"[OK] Retrieved {len(sessions)} sessions for teacher {teacher_id}")
        
        return jsonify({
            "success": True,
            "teacher_id": teacher_id,
            "sessions": sessions,
            "count": len(sessions),
            "message": f"Found {len(sessions)} sessions"
        })
        
    except Exception as e:
        print(f"[ERROR] Error getting teacher sessions: {e}")
        if conn:
            conn.close()
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@teacher_bp.route('/api/sessions/<int:session_id>', methods=['DELETE'])
def delete_session(session_id):
    """Delete/cancel a session"""
    try:
        print(f"🗑️ Deleting session: {session_id}")
        
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        
        # Update session status to cancelled
        cursor.execute("""
            UPDATE class_session 
            SET status = 'cancelled'
            WHERE session_id = %s
            RETURNING session_id, title
        """, (session_id,))
        
        result = cursor.fetchone()
        
        if not result:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": "Session not found"
            }), 404
        
        conn.commit()
        cursor.close()
        conn.close()
        
        print(f"[OK] Session {session_id} cancelled successfully")
        
        return jsonify({
            "success": True,
            "message": f"Session '{result[1]}' has been cancelled",
            "session_id": session_id
        })
        
    except Exception as e:
        print(f"[ERROR] Error deleting session: {e}")
        if conn:
            conn.close()
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@teacher_bp.route('/api/sessions/<int:session_id>', methods=['PUT'])
def update_session(session_id):
    """Update an existing session"""
    try:
        data = request.json
        print(f"Updating session {session_id} with data:", data)
        
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        
        # Build update query dynamically based on provided fields
        update_fields = []
        values = []
        
        fields_to_update = ['title', 'description', 'start_time', 'end_time', 'meeting_room_id', 
                           'meeting_token', 'is_private', 'recording_path', 'recording_available', 'status']
        
        for field in fields_to_update:
            if field in data and data[field] is not None:
                if field in ['is_private', 'recording_available']:
                    update_fields.append(f"{field} = %s")
                    values.append(data[field])
                else:
                    update_fields.append(f"{field} = %s")
                    values.append(data[field])
        
        if not update_fields:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": "No fields to update"
            }), 400
        
        values.append(session_id)
        
        query = f"""
            UPDATE class_session 
            SET {', '.join(update_fields)}, updated_at = CURRENT_TIMESTAMP
            WHERE session_id = %s
            RETURNING session_id, title, description, start_time, end_time, 
                     meeting_room_id, meeting_token, is_private, status
        """
        
        cursor.execute(query, values)
        result = cursor.fetchone()
        
        if not result:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": "Session not found"
            }), 404
        
        conn.commit()
        cursor.close()
        conn.close()
        
        session_data = {
            "session_id": result[0],
            "title": result[1],
            "description": result[2],
            "start_time": result[3].isoformat() if result[3] else None,
            "end_time": result[4].isoformat() if result[4] else None,
            "meeting_room_id": result[5],
            "meeting_token": result[6],
            "is_private": result[7],
            "status": result[8]
        }
        
        print(f"[OK] Session {session_id} updated successfully")
        
        return jsonify({
            "success": True,
            "message": f"Session updated successfully",
            "session": session_data
        })
        
    except Exception as e:
        print(f"[ERROR] Error updating session: {e}")
        if conn:
            conn.close()
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

# =============================================
# TEACHER UPDATE ENDPOINT
# =============================================
@teacher_bp.route('/api/admin/teachers/<teacher_id>', methods=['PUT'])
def update_teacher(teacher_id):
    """Update teacher information"""
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
        if 'department' in data:
            updates.append("department = %s")
            values.append(data['department'])
        if 'profile_image_url' in data:
            updates.append("profile_image_url = %s")
            values.append((data.get('profile_image_url') or '').strip() or None)
        
        if not updates:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'message': 'No fields to update'}), 400
        
        values.append(teacher_id)
        update_query = f"UPDATE teacher SET {', '.join(updates)} WHERE teacher_id = %s"
        
        cursor.execute(update_query, values)
        conn.commit()
        cursor.close()
        conn.close()
        
        print(f"[OK] Teacher {teacher_id} updated successfully")
        return jsonify({'success': True, 'message': 'Teacher updated successfully'}), 200
        
    except Exception as e:
        print(f"[ERROR] Error updating teacher: {e}")
        return jsonify({'success': False, 'message': f'Error updating teacher: {str(e)}'}), 500


# =============================================
# TEACHER DELETE ENDPOINT
# =============================================
@teacher_bp.route('/api/admin/teachers/<teacher_id>', methods=['DELETE'])
def delete_teacher(teacher_id):
    """Delete a teacher"""
    try:
        conn = getDbConnection()
        if not conn:
            return jsonify({'success': False, 'message': 'Database connection failed'}), 500
        
        cursor = conn.cursor()
        
        # Check if teacher exists
        cursor.execute("SELECT name FROM teacher WHERE teacher_id = %s", (teacher_id,))
        teacher = cursor.fetchone()
        
        if not teacher:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'message': 'Teacher not found'}), 404
        
        teacher_name = teacher[0]

        # Cleanup related records to avoid FK constraint failures
        cursor.execute("SELECT id, course_id FROM course WHERE teacher_id = %s", (teacher_id,))
        course_rows = cursor.fetchall()
        course_ids_int = [row[0] for row in course_rows if row[0] is not None]
        course_ids = [row[1] for row in course_rows if row[1]]

        if course_ids_int:
            cursor.execute("SAVEPOINT cleanup_student_course")
            try:
                cursor.execute("DELETE FROM student_course WHERE course_id = ANY(%s)", (course_ids_int,))
                cursor.execute("RELEASE SAVEPOINT cleanup_student_course")
            except Exception as cleanup_error:
                cursor.execute("ROLLBACK TO SAVEPOINT cleanup_student_course")
                print(f"[WARN] Cleanup student_course by id failed: {cleanup_error}")

        if course_ids:
            cursor.execute("SAVEPOINT cleanup_enrollment")
            try:
                cursor.execute("DELETE FROM enrollment WHERE course_id = ANY(%s)", (course_ids,))
                cursor.execute("RELEASE SAVEPOINT cleanup_enrollment")
            except Exception as cleanup_error:
                cursor.execute("ROLLBACK TO SAVEPOINT cleanup_enrollment")
                print(f"[WARN] Cleanup enrollment failed: {cleanup_error}")

            cursor.execute("SAVEPOINT cleanup_attendance")
            try:
                cursor.execute("DELETE FROM attendance WHERE session_id IN (SELECT session_id FROM class_session WHERE course_id = ANY(%s))", (course_ids,))
                cursor.execute("RELEASE SAVEPOINT cleanup_attendance")
            except Exception as cleanup_error:
                cursor.execute("ROLLBACK TO SAVEPOINT cleanup_attendance")
                print(f"[WARN] Cleanup attendance failed: {cleanup_error}")

            cursor.execute("SAVEPOINT cleanup_class_session")
            try:
                cursor.execute("DELETE FROM class_session WHERE course_id = ANY(%s)", (course_ids,))
                cursor.execute("RELEASE SAVEPOINT cleanup_class_session")
            except Exception as cleanup_error:
                cursor.execute("ROLLBACK TO SAVEPOINT cleanup_class_session")
                print(f"[WARN] Cleanup class_session failed: {cleanup_error}")

        cursor.execute("SAVEPOINT cleanup_course")
        try:
            cursor.execute("DELETE FROM course WHERE teacher_id = %s", (teacher_id,))
            cursor.execute("RELEASE SAVEPOINT cleanup_course")
        except Exception as cleanup_error:
            cursor.execute("ROLLBACK TO SAVEPOINT cleanup_course")
            print(f"[WARN] Cleanup course failed: {cleanup_error}")
        
        # Delete teacher
        cursor.execute("DELETE FROM teacher WHERE teacher_id = %s", (teacher_id,))
        conn.commit()
        cursor.close()
        conn.close()
        
        print(f"[OK] Teacher {teacher_id} ({teacher_name}) deleted successfully")
        return jsonify({'success': True, 'message': f'Teacher "{teacher_name}" deleted successfully'}), 200
        
    except Exception as e:
        print(f"[ERROR] Error deleting teacher: {e}")
        return jsonify({'success': False, 'message': f'Error deleting teacher: {str(e)}'}), 500