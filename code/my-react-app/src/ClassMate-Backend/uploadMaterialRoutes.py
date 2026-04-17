# uploadMaterialRoutes.py
from flask import Blueprint, jsonify, request, current_app
import psycopg2
import os
import uuid
from dotenv import load_dotenv
from datetime import datetime
from werkzeug.utils import secure_filename
import mimetypes
import traceback

load_dotenv()

upload_bp = Blueprint('upload', __name__)

def getDbConnection():
    """Establish database connection"""
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
        print(f"[ERROR] Database connection FAILED: {e}")
        return None

# Configuration
ALLOWED_EXTENSIONS = {
    'pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx',
    'txt', 'jpg', 'jpeg', 'png', 'gif', 'bmp',
    'mp4', 'avi', 'mov', 'wmv', 'mp3', 'wav',
    'zip', 'rar', '7z'
}

MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB

# Create uploads directory if it doesn't exist
BASE_UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'uploads')
os.makedirs(BASE_UPLOAD_FOLDER, exist_ok=True)

def allowed_file(filename):
    """Check if file extension is allowed"""
    if '.' not in filename:
        return False
    extension = filename.rsplit('.', 1)[1].lower()
    return extension in ALLOWED_EXTENSIONS

def get_file_mime_type(filename):
    """Get MIME type based on file extension"""
    return mimetypes.guess_type(filename)[0] or 'application/octet-stream'

def ensure_course_folder(course_id):
    """Ensure course-specific upload folder exists"""
    course_folder = os.path.join(BASE_UPLOAD_FOLDER, 'materials', str(course_id))
    os.makedirs(course_folder, exist_ok=True)
    return course_folder

@upload_bp.route('/api/courses/<course_id>/materials/upload', methods=['POST'])
def upload_course_material(course_id):
    """Upload a new material file for a course"""
    try:
        print(f"📤 Upload request received for course: {course_id}")
        
        # Get teacher ID from form data
        teacher_id = request.form.get('teacher_id')
        
        # Check if we have a teacher ID
        if not teacher_id:
            return jsonify({
                "success": False,
                "error": "You must be logged in as a teacher to upload materials"
            }), 401
        
        print(f"👨‍🏫 Teacher ID: {teacher_id}")
        
        conn = getDbConnection()
        if not conn:
            return jsonify({
                "success": False,
                "error": "Database connection failed"
            }), 500
        
        cursor = conn.cursor()
        
        # Verify course exists
        cursor.execute("""
            SELECT course_id, course_code, title 
            FROM course 
            WHERE course_id = %s
        """, (course_id,))
        
        course = cursor.fetchone()
        if not course:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": f"Course {course_id} not found"
            }), 404
        
        print(f"[OK] Course found: {course[1]} - {course[2]}")
        
        # Check if file is provided
        if 'file' not in request.files:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": "No file provided"
            }), 400
        
        file = request.files['file']
        
        if file.filename == '':
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": "No file selected"
            }), 400
        
        # Validate file
        if not allowed_file(file.filename):
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": f"File type not allowed. Allowed types: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
            }), 400
        
        # Check file size
        file.seek(0, 2)  # Seek to end
        file_size = file.tell()
        file.seek(0)  # Reset pointer
        
        if file_size > MAX_FILE_SIZE:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": f"File too large. Maximum size: {MAX_FILE_SIZE // (1024*1024)}MB"
            }), 400
        
        # Get form data
        title = request.form.get('title', '').strip()
        description = request.form.get('description', '').strip()
        material_type = request.form.get('material_type', 'lecture_material')
        session_id = request.form.get('session_id') or None
        is_public = request.form.get('is_public', 'true').lower() == 'true'
        tags = request.form.get('tags', '')
        
        # SIMPLIFIED: Verify teacher exists and owns the course
        cursor.execute("""
            SELECT t.teacher_id 
            FROM teacher t
            INNER JOIN course c ON t.teacher_id = c.teacher_id
            WHERE t.teacher_id = %s AND c.course_id = %s
        """, (teacher_id, course_id))
        
        teacher_course = cursor.fetchone()
        if not teacher_course:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": "Teacher not found or does not own this course"
            }), 403
        
        print(f"[OK] Teacher {teacher_id} owns course {course_id}")
        
        # Generate material ID
        material_id = str(uuid.uuid4().hex[:20])
        
        # Prepare file information
        original_filename = secure_filename(file.filename)
        file_extension = original_filename.rsplit('.', 1)[1].lower() if '.' in original_filename else ''
        
        # Generate unique filename
        unique_filename = f"{material_id}.{file_extension}" if file_extension else material_id
        
        # Create course-specific folder
        course_folder = ensure_course_folder(course_id)
        file_path = os.path.join(course_folder, unique_filename)
        
        # Save file
        file.save(file_path)
        print(f"💾 File saved to: {file_path}")
        
        # Get file MIME type
        file_mime_type = get_file_mime_type(original_filename)
        
        # Determine material category based on file type
        if 'pdf' in file_mime_type:
            file_category = 'pdf'
        elif 'word' in file_mime_type or 'document' in file_mime_type:
            file_category = 'document'
        elif 'powerpoint' in file_mime_type or 'presentation' in file_mime_type:
            file_category = 'presentation'
        elif 'excel' in file_mime_type or 'spreadsheet' in file_mime_type:
            file_category = 'spreadsheet'
        elif 'image' in file_mime_type:
            file_category = 'image'
        elif 'video' in file_mime_type:
            file_category = 'video'
        elif 'audio' in file_mime_type:
            file_category = 'audio'
        elif 'zip' in file_mime_type or 'compress' in file_mime_type:
            file_category = 'archive'
        else:
            file_category = 'other'
        
        # Process tags
        tag_list = []
        if tags:
            tag_list = [tag.strip() for tag in tags.split(',') if tag.strip()]
        
        # If no title provided, use filename without extension
        if not title:
            title = original_filename.rsplit('.', 1)[0] if '.' in original_filename else original_filename
        
        # Insert into database
        cursor.execute("""
            INSERT INTO lecture_material (
                course_id, 
                session_id, 
                title, 
                description,
                file_name, 
                file_path, 
                file_size, 
                file_type, 
                material_type,
                uploaded_by, 
                uploaded_date, 
                is_public, 
                tags,
                is_active
            ) VALUES (
                %s, %s, %s, %s,
                %s, %s, %s, %s, %s,
                %s, NOW(), %s, %s,
                true
            ) RETURNING material_id, uploaded_date
        """, (
            course_id, 
            session_id,
            title, 
            description,
            original_filename, 
            file_path, 
            file_size, 
            file_mime_type, 
            material_type,
            teacher_id,
            is_public, 
            tag_list
        ))

        result = cursor.fetchone()
        conn.commit()

        new_material_id = result[0]  # This will be the auto-generated integer ID
        uploaded_date = result[1]
        
        cursor.close()
        conn.close()
        
        print(f"[OK] Material uploaded successfully: {new_material_id}")
        
        return jsonify({
            "success": True,
            "message": "Material uploaded successfully",
            "material": {
                "id": new_material_id,
                "material_id": new_material_id,
                "title": title,
                "description": description,
                "file_name": original_filename,
                "file_size": file_size,
                "file_type": file_mime_type,
                "material_type": material_type,
                "uploaded_by": teacher_id,
                "uploaded_date": uploaded_date.isoformat(),
                "is_public": is_public,
                "tags": tag_list,
                "course_id": course_id,
                "course_code": course[1],
                "course_title": course[2],
                "download_url": f"/api/materials/{new_material_id}/download"
            }
        })
        
    except Exception as e:
        print(f"[ERROR] Error uploading material: {e}")
        traceback.print_exc()
        if 'conn' in locals():
            conn.close()
        return jsonify({
            "success": False,
            "error": f"Failed to upload material: {str(e)}"
        }), 500

@upload_bp.route('/api/courses/<course_id>/sessions', methods=['GET'])
def get_course_sessions(course_id):
    """Get all sessions for a course (for dropdown in frontend)"""
    try:
        print(f"📅 Getting sessions for course: {course_id}")
        
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        
        # Verify course exists
        cursor.execute("""
            SELECT course_id FROM course WHERE course_id = %s
        """, (course_id,))
        
        course = cursor.fetchone()
        if not course:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": f"Course {course_id} not found"
            }), 404
        
        # Get sessions
        cursor.execute("""
            SELECT 
                session_id,
                session_date,
                topic,
                description,
                start_time,
                end_time,
                location
            FROM class_session
            WHERE course_id = %s
            ORDER BY session_date DESC, start_time DESC
        """, (course_id,))
        
        sessions_raw = cursor.fetchall()
        
        sessions = []
        for session in sessions_raw:
            sessions.append({
                "session_id": session[0],
                "session_date": session[1].strftime('%Y-%m-%d') if session[1] else None,
                "topic": session[2] or "No topic",
                "description": session[3] or "",
                "start_time": session[4].strftime('%H:%M') if session[4] else None,
                "end_time": session[5].strftime('%H:%M') if session[5] else None,
                "location": session[6] or "No location"
            })
        
        cursor.close()
        conn.close()
        
        return jsonify({
            "success": True,
            "course_id": course_id,
            "sessions": sessions,
            "count": len(sessions)
        })
        
    except Exception as e:
        print(f"[ERROR] Error getting sessions: {e}")
        traceback.print_exc()
        return jsonify({
            "success": False,
            "error": f"Failed to get sessions: {str(e)}"
        }), 500

@upload_bp.route('/api/upload/test', methods=['GET'])
def upload_test():
    """Test endpoint for upload API"""
    return jsonify({
        "success": True,
        "message": "Upload API is working",
        "timestamp": datetime.now().isoformat(),
        "config": {
            "max_file_size_mb": MAX_FILE_SIZE // (1024 * 1024),
            "allowed_extensions": list(ALLOWED_EXTENSIONS),
            "upload_folder": BASE_UPLOAD_FOLDER
        }
    })

# Also need to add this to materialRoutes.py for file download
@upload_bp.route('/api/materials/<material_id>/download', methods=['GET'])
def download_material(material_id):
    """Download a material file"""
    try:
        print(f"📥 Download request for material: {material_id}")
        
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        
        # Get material info
        cursor.execute("""
            SELECT 
                material_id,
                file_name,
                file_path,
                file_type,
                download_count
            FROM lecture_material 
            WHERE material_id = %s AND is_active = TRUE
        """, (material_id,))
        
        material = cursor.fetchone()
        
        if not material:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": "Material not found or inactive"
            }), 404
        
        material_id, file_name, file_path, file_type, download_count = material
        
        # Check if file exists
        if not os.path.exists(file_path):
            print(f"[ERROR] File not found at path: {file_path}")
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": "File not found on server"
            }), 404
        
        # Update download count
        cursor.execute("""
            UPDATE lecture_material 
            SET download_count = download_count + 1,
                last_downloaded_at = NOW()
            WHERE material_id = %s
        """, (material_id,))
        
        conn.commit()
        cursor.close()
        conn.close()
        
        print(f"[OK] Sending file: {file_name}")
        
        # Send file
        from flask import send_file
        return send_file(
            file_path,
            as_attachment=True,
            download_name=file_name,
            mimetype=file_type or 'application/octet-stream'
        )
        
    except Exception as e:
        print(f"[ERROR] Error downloading file: {e}")
        traceback.print_exc()
        return jsonify({
            "success": False,
            "error": f"Failed to download: {str(e)}"
        }), 500