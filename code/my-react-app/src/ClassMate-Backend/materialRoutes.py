# materialRoutes.py - SIMPLIFIED VERSION
from flask import Blueprint, jsonify, request, send_file
import psycopg2
import os
from dotenv import load_dotenv
from datetime import datetime
import traceback

load_dotenv()

material_bp = Blueprint('material', __name__)

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
        print(f"[ERROR] Database connection FAILED: {e}")
        return None

@material_bp.route('/api/courses/<course_id>/materials', methods=['GET'])
def get_course_materials(course_id):
    """Get all materials for a course"""
    try:
        # Get teacher_id from query parameter
        teacher_id = request.args.get('teacher_id')
        
        print(f"📚 Getting materials for course: {course_id}, Teacher: {teacher_id}")
        
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        
        # First, verify course exists
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
        
        # Get materials - filter by course_id and optionally by teacher_id
        if teacher_id:
            # Show only materials uploaded by this teacher
            print(f"📚 Filtering materials for teacher: {teacher_id}")
            cursor.execute("""
                SELECT 
                    lm.material_id,
                    lm.title,
                    lm.description,
                    lm.file_name,
                    lm.file_path,
                    lm.file_size,
                    lm.file_type,
                    lm.material_type,
                    lm.uploaded_by,
                    t.name as teacher_name,
                    lm.uploaded_date,
                    lm.download_count,
                    lm.view_count,
                    lm.is_public,
                    lm.tags,
                    lm.session_id
                FROM lecture_material lm
                LEFT JOIN teacher t ON lm.uploaded_by = t.teacher_id
                WHERE lm.course_id = %s 
                    AND lm.uploaded_by = %s
                    AND lm.is_active = TRUE
                ORDER BY lm.uploaded_date DESC
            """, (course_id, teacher_id))
        else:
            # Show all materials for the course (for student view)
            cursor.execute("""
                SELECT 
                    lm.material_id,
                    lm.title,
                    lm.description,
                    lm.file_name,
                    lm.file_path,
                    lm.file_size,
                    lm.file_type,
                    lm.material_type,
                    lm.uploaded_by,
                    t.name as teacher_name,
                    lm.uploaded_date,
                    lm.download_count,
                    lm.view_count,
                    lm.is_public,
                    lm.tags,
                    lm.session_id
                FROM lecture_material lm
                LEFT JOIN teacher t ON lm.uploaded_by = t.teacher_id
                WHERE lm.course_id = %s 
                    AND lm.is_active = TRUE
                ORDER BY lm.uploaded_date DESC
            """, (course_id,))
        
        materials_raw = cursor.fetchall()
        
        materials = []
        for material in materials_raw:
            # Format file size
            file_size_bytes = material[5] or 0
            file_size = format_file_size(file_size_bytes)
            
            # Get file icon and color
            file_type = material[6] or ''
            icon = get_file_icon(file_type)
            color = get_file_color(file_type)
            
            materials.append({
                "material_id": material[0],
                "title": material[1],
                "description": material[2],
                "file_name": material[3],
                "file_path": material[4],
                "file_size": file_size,
                "file_size_bytes": file_size_bytes,
                "file_type": file_type,
                "material_type": material[7],
                "uploaded_by": material[8],
                "teacher_name": material[9],
                "uploaded_date": material[10].isoformat() if material[10] else None,
                "download_count": material[11] or 0,
                "view_count": material[12] or 0,
                "is_public": material[13],
                "tags": material[14] if material[14] else [],
                "session_id": material[15],  # Keep session_id if needed
                "icon": icon,
                "color": color,
                "download_url": f"/api/materials/{material[0]}/download"
            })
        
        cursor.close()
        conn.close()
        
        # Calculate stats
        total_downloads = sum(m.get('download_count', 0) for m in materials)
        total_views = sum(m.get('view_count', 0) for m in materials)
        
        return jsonify({
            "success": True,
            "course": {
                "id": course[0],
                "code": course[1],
                "title": course[2]
            },
            "materials": materials,
            "count": len(materials),
            "stats": {
                "total_materials": len(materials),
                "total_downloads": total_downloads,
                "total_views": total_views
            },
            "message": f"Found {len(materials)} materials"
        })
        
    except Exception as e:
        print(f"[ERROR] Error getting materials: {e}")
        traceback.print_exc()
        return jsonify({
            "success": False,
            "error": f"Failed to get materials: {str(e)}"
        }), 500

@material_bp.route('/api/materials/<material_id>', methods=['DELETE'])
def delete_material(material_id):
    """Delete a material file"""
    try:
        print(f"🗑️ Delete request for material: {material_id}")
        
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        
        # First get material info
        cursor.execute("""
            SELECT 
                material_id,
                file_name,
                file_path,
                title
            FROM lecture_material 
            WHERE material_id = %s AND is_active = TRUE
        """, (material_id,))
        
        material = cursor.fetchone()
        
        if not material:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": "Material not found or already deleted"
            }), 404
        
        material_id, file_name, file_path, title = material
        
        # Delete the physical file if it exists
        file_deleted = False
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
                file_deleted = True
                print(f"🗑️ Physical file deleted: {file_path}")
            except Exception as file_error:
                print(f"⚠️ Could not delete physical file: {file_error}")
        
        # Soft delete - set is_active to FALSE
        cursor.execute("""
            UPDATE lecture_material 
            SET is_active = FALSE
            WHERE material_id = %s
        """, (material_id,))
        
        conn.commit()
        cursor.close()
        conn.close()
        
        print(f"[OK] Material deleted from database: {material_id}")
        
        return jsonify({
            "success": True,
            "message": f"Material '{title}' deleted successfully",
            "file_deleted": file_deleted,
            "material_id": material_id
        })
        
    except Exception as e:
        print(f"[ERROR] Error deleting material: {e}")
        traceback.print_exc()
        if 'conn' in locals():
            conn.close()
        return jsonify({
            "success": False,
            "error": f"Failed to delete material: {str(e)}"
        }), 500

@material_bp.route('/api/materials/<material_id>/download', methods=['GET'])
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
                title,
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
                "error": "Material not found"
            }), 404
        
        mat_id, file_name, file_path, title, download_count = material
        
        # Check if file exists
        if not os.path.exists(file_path):
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": "File not found on server"
            }), 404
        
        # Update download count
        try:
            cursor.execute("""
                UPDATE lecture_material 
                SET download_count = download_count + 1
                WHERE material_id = %s
            """, (material_id,))
            conn.commit()
            print(f"[OK] Download count updated for material: {material_id}")
        except Exception as e:
            print(f"⚠️ Could not update download count: {e}")
            conn.rollback()
        
        cursor.close()
        conn.close()
        
        # Send file
        print(f"📤 Sending file: {file_path}")
        return send_file(
            file_path,
            as_attachment=True,
            download_name=file_name,
            mimetype='application/octet-stream'
        )
        
    except Exception as e:
        print(f"[ERROR] Error downloading material: {e}")
        traceback.print_exc()
        if 'conn' in locals():
            conn.close()
        return jsonify({
            "success": False,
            "error": f"Failed to download material: {str(e)}"
        }), 500

def format_file_size(bytes_size):
    """Convert bytes to human readable format"""
    if not bytes_size or bytes_size == 0:
        return "0 B"
    
    for unit in ['B', 'KB', 'MB', 'GB']:
        if bytes_size < 1024.0:
            return f"{bytes_size:.1f} {unit}"
        bytes_size /= 1024.0
    return f"{bytes_size:.1f} GB"

def get_file_icon(file_type):
    """Get appropriate icon based on file type"""
    if not file_type:
        return "📄"
    
    file_type_lower = file_type.lower()
    
    if 'pdf' in file_type_lower:
        return "📕"
    elif 'word' in file_type_lower or 'doc' in file_type_lower:
        return "📝"
    elif 'powerpoint' in file_type_lower or 'ppt' in file_type_lower:
        return "📊"
    elif 'excel' in file_type_lower or 'spreadsheet' in file_type_lower or 'xls' in file_type_lower:
        return "📈"
    elif 'image' in file_type_lower:
        return "🖼️"
    elif 'video' in file_type_lower:
        return "🎬"
    elif 'audio' in file_type_lower:
        return "🎵"
    elif 'zip' in file_type_lower or 'rar' in file_type_lower:
        return "🗜️"
    elif 'text' in file_type_lower:
        return "📄"
    else:
        return "📄"

def get_file_color(file_type):
    """Get color based on file type"""
    if not file_type:
        return "#7f6269"
    
    file_type_lower = file_type.lower()
    
    if 'pdf' in file_type_lower:
        return "#ef4444"      # Red
    elif 'word' in file_type_lower or 'doc' in file_type_lower:
        return "#3b82f6"      # Blue
    elif 'powerpoint' in file_type_lower or 'ppt' in file_type_lower:
        return "#f59e0b"      # Orange
    elif 'excel' in file_type_lower or 'xls' in file_type_lower:
        return "#10b981"      # Green
    elif 'image' in file_type_lower:
        return "#8b5cf6"      # Purple
    elif 'video' in file_type_lower:
        return "#ec4899"      # Pink
    elif 'audio' in file_type_lower:
        return "#6366f1"      # Indigo
    elif 'zip' in file_type_lower or 'rar' in file_type_lower:
        return "#6b7280"      # Gray
    elif 'text' in file_type_lower:
        return "#718096"      # Dark Gray
    else:
        return "#7f6269"      # Theme color

# Health check endpoint
@material_bp.route('/api/materials/health', methods=['GET'])
def material_health_check():
    """Health check endpoint"""
    return jsonify({
        "success": True,
        "message": "Material API is running",
        "timestamp": datetime.now().isoformat(),
        "endpoints": {
            "get_materials": "/api/courses/<course_id>/materials",
            "upload": "/api/courses/<course_id>/materials/upload",
            "download": "/api/materials/<material_id>/download",
            "health": "/api/materials/health"
        }
    })

# Test endpoint
@material_bp.route('/api/materials/test', methods=['GET'])
def test_materials():
    """Test endpoint to verify API is working"""
    return jsonify({
        "success": True,
        "message": "Materials API is working",
        "timestamp": datetime.now().isoformat()
    })