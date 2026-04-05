from flask import Blueprint, jsonify, request
import psycopg2
import os
from dotenv import load_dotenv
from datetime import datetime

load_dotenv()

chat_bp = Blueprint('chat', __name__)

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

# ===== USER SEARCH API ENDPOINT =====

@chat_bp.route('/api/chat/search', methods=['GET'])
def search_users():
    """Search for users (students, teachers, admins) to chat with"""
    try:
        search_query = request.args.get('q', '')
        current_user_id = request.args.get('current_user_id')
        current_user_type = request.args.get('current_user_type')
        
        if not search_query:
            return jsonify({
                "success": False,
                "error": "Search query is required"
            }), 400
        
        if not current_user_id:
            return jsonify({
                "success": False,
                "error": "Current user ID is required"
            }), 400
        
        print(f"🔍 Searching users with query: '{search_query}' for user: {current_user_id} ({current_user_type})")
        
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        search_term = f"%{search_query}%"
        search_results = []
        
        # ===== 1. SEARCH TEACHERS =====
        cursor.execute("""
            SELECT 
                teacher_id as user_id,
                name,
                email,
                department,
                'teacher' as user_type,
                profile_image_url,
                created_at
            FROM teacher 
            WHERE (name ILIKE %s OR email ILIKE %s)
            ORDER BY name
            LIMIT 20
        """, (search_term, search_term))
        
        teachers = cursor.fetchall()
        for teacher in teachers:
            teacher_dict = row_to_dict(cursor, teacher)
            if teacher_dict and str(teacher_dict['user_id']) != str(current_user_id):
                search_results.append({
                    "id": teacher_dict['user_id'],
                    "name": teacher_dict['name'],
                    "email": teacher_dict['email'],
                    "role": "Teacher",
                    "user_type": teacher_dict['user_type'],
                    "department": teacher_dict['department'] or "Not specified",
                    "profile_image_url": teacher_dict['profile_image_url'] or "",
                    "created_at": teacher_dict['created_at'].isoformat() if teacher_dict['created_at'] else None,
                    "avatar": teacher_dict['name'][0].upper() if teacher_dict['name'] else 'T'
                })
        
        # ===== 2. SEARCH STUDENTS =====
        cursor.execute("""
            SELECT 
                student_id as user_id,
                name,
                email,
                semester,
                phone,
                'student' as user_type,
                profile_image_url,
                created_at
            FROM student 
            WHERE (name ILIKE %s OR email ILIKE %s)
            ORDER BY name
            LIMIT 20
        """, (search_term, search_term))
        
        students = cursor.fetchall()
        for student in students:
            student_dict = row_to_dict(cursor, student)
            if student_dict and str(student_dict['user_id']) != str(current_user_id):
                search_results.append({
                    "id": student_dict['user_id'],
                    "name": student_dict['name'],
                    "email": student_dict['email'],
                    "role": "Student",
                    "user_type": student_dict['user_type'],
                    "semester": student_dict.get('semester'),
                    "phone": student_dict.get('phone'),
                    "department": f"Semester {student_dict.get('semester', 'N/A')}",
                    "profile_image_url": student_dict['profile_image_url'] or "",
                    "created_at": student_dict['created_at'].isoformat() if student_dict['created_at'] else None,
                    "avatar": student_dict['name'][0].upper() if student_dict['name'] else 'S'
                })
        
        # ===== 3. SEARCH ADMINS =====
        # FIXED: Admin table doesn't have department column!
        cursor.execute("""
            SELECT 
                admin_id as user_id,
                name,
                email,
                'admin' as user_type,
                profile_image_url,
                created_at
            FROM admin 
            WHERE (name ILIKE %s OR email ILIKE %s)
            ORDER BY name
            LIMIT 10
        """, (search_term, search_term))
        
        admins = cursor.fetchall()
        for admin in admins:
            admin_dict = row_to_dict(cursor, admin)
            if admin_dict and str(admin_dict['user_id']) != str(current_user_id):
                search_results.append({
                    "id": admin_dict['user_id'],
                    "name": admin_dict['name'],
                    "email": admin_dict['email'],
                    "role": "Admin",
                    "user_type": admin_dict['user_type'],
                    "department": "Administration",  # Hardcoded since no department column
                    "profile_image_url": admin_dict['profile_image_url'] or "",
                    "created_at": admin_dict['created_at'].isoformat() if admin_dict['created_at'] else None,
                    "avatar": admin_dict['name'][0].upper() if admin_dict['name'] else 'A'
                })
        
        cursor.close()
        conn.close()
        
        print(f"[OK] Found {len(search_results)} users matching '{search_query}'")
        
        return jsonify({
            "success": True,
            "query": search_query,
            "results": search_results,
            "count": len(search_results),
            "timestamp": datetime.now().isoformat()
        })
        
    except Exception as e:
        print(f"[ERROR] Error in search_users: {e}")
        if 'conn' in locals() and conn:
            try:
                cursor.close()
                conn.close()
            except:
                pass
        return jsonify({
            "success": False,
            "error": f"Search failed: {str(e)}"
        }), 500

# ===== GET USER BY ID =====

@chat_bp.route('/api/chat/user/<string:user_id>', methods=['GET'])
def get_user_by_id(user_id):
    """Get user details by ID and type"""
    try:
        user_type = request.args.get('type')
        
        if not user_type:
            return jsonify({
                "success": False,
                "error": "User type is required (teacher/student/admin)"
            }), 400
        
        print(f"🔍 Getting user details: ID={user_id}, Type={user_type}")
        
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        user_data = None
        
        if user_type == 'teacher':
            cursor.execute("""
                SELECT 
                    teacher_id as user_id,
                    name,
                    email,
                    department,
                    'teacher' as user_type,
                    profile_image_url,
                    created_at
                FROM teacher 
                WHERE teacher_id = %s
            """, (user_id,))
            
        elif user_type == 'student':
            cursor.execute("""
                SELECT 
                    student_id as user_id,
                    name,
                    email,
                    semester,
                    phone,
                    'student' as user_type,
                    profile_image_url,
                    created_at
                FROM student 
                WHERE student_id = %s
            """, (user_id,))
            
        elif user_type == 'admin':
            # FIXED: Admin table doesn't have department column!
            cursor.execute("""
                SELECT 
                    admin_id as user_id,
                    name,
                    email,
                    'admin' as user_type,
                    profile_image_url,
                    created_at
                FROM admin 
                WHERE admin_id = %s
            """, (user_id,))
            
        else:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": "Invalid user type"
            }), 400
        
        user_row = cursor.fetchone()
        
        if user_row:
            user_dict = row_to_dict(cursor, user_row)
            if user_dict:
                user_data = {
                    "id": user_dict['user_id'],
                    "name": user_dict['name'],
                    "email": user_dict['email'],
                    "role": user_type.capitalize(),
                    "user_type": user_dict['user_type'],
                    "profile_image_url": user_dict.get('profile_image_url', ''),
                    "avatar": user_dict['name'][0].upper() if user_dict['name'] else user_type[0].upper(),
                    "created_at": user_dict['created_at'].isoformat() if user_dict['created_at'] else None
                }
                
                # Add type-specific fields
                if user_type == 'teacher':
                    user_data["department"] = user_dict.get('department', 'Not specified')
                elif user_type == 'student':
                    user_data["semester"] = user_dict.get('semester')
                    user_data["phone"] = user_dict.get('phone')
                    user_data["department"] = f"Semester {user_dict.get('semester', 'N/A')}"
                elif user_type == 'admin':
                    user_data["department"] = "Administration"  # Hardcoded
        
        cursor.close()
        conn.close()
        
        if not user_data:
            return jsonify({
                "success": False,
                "error": f"User not found"
            }), 404
        
        print(f"[OK] Retrieved user details for {user_data['name']}")
        
        return jsonify({
            "success": True,
            "user": user_data
        })
        
    except Exception as e:
        print(f"[ERROR] Error in get_user_by_id: {e}")
        return jsonify({
            "success": False,
            "error": f"Failed to get user: {str(e)}"
        }), 500

# ===== TEST ENDPOINT =====

@chat_bp.route('/api/chat/test', methods=['GET'])
def test_chat_route():
    return jsonify({
        "success": True,
        "message": "Chat API is working!",
        "endpoints": {
            "search_users": "/api/chat/search?q=SEARCH_TERM&current_user_id=ID&current_user_type=TYPE",
            "get_user": "/api/chat/user/{id}?type=TYPE",
            "test": "/api/chat/test"
        },
        "timestamp": datetime.now().isoformat()
    })

# ===== CHECK IF USER EXISTS =====

@chat_bp.route('/api/chat/check-user', methods=['GET'])
def check_user_exists():
    """Check if a user exists (for validation before starting chat)"""
    try:
        user_id = request.args.get('user_id')
        user_type = request.args.get('user_type')
        
        if not user_id or not user_type:
            return jsonify({
                "success": False,
                "error": "Both user_id and user_type are required"
            }), 400
        
        print(f"🔍 Checking if user exists: ID={user_id}, Type={user_type}")
        
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        exists = False
        user_name = None
        
        if user_type == 'teacher':
            cursor.execute("SELECT name FROM teacher WHERE teacher_id = %s", (user_id,))
        elif user_type == 'student':
            cursor.execute("SELECT name FROM student WHERE student_id = %s", (user_id,))
        elif user_type == 'admin':
            cursor.execute("SELECT name FROM admin WHERE admin_id = %s", (user_id,))
        else:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": "Invalid user type"
            }), 400
        
        result = cursor.fetchone()
        if result:
            exists = True
            user_name = result[0]
        
        cursor.close()
        conn.close()
        
        return jsonify({
            "success": True,
            "exists": exists,
            "user_name": user_name,
            "user_id": user_id,
            "user_type": user_type
        })
        
    except Exception as e:
        print(f"[ERROR] Error in check_user_exists: {e}")
        return jsonify({
            "success": False,
            "error": f"Failed to check user: {str(e)}"
        }), 500
    
# ===== CREATE/GET CONVERSATION (Using existing chat_message table) =====

# ===== CREATE/GET CONVERSATION (Using existing chat_message table) =====

@chat_bp.route('/api/chat/conversation', methods=['POST', 'GET'])
def handle_conversation():
    """Create a new conversation or get existing conversation between two users"""
    try:
        # Get data based on request method
        if request.method == 'POST':
            data = request.get_json()
            if not data:
                return jsonify({
                    "success": False,
                    "error": "No JSON data provided"
                }), 400
            
            sender_id = data.get('sender_id')
            sender_type = data.get('sender_type')
            receiver_id = data.get('receiver_id')
            receiver_type = data.get('receiver_type')
            message_text = data.get('message_text', '')
            
            # Validate all required fields
            if not all([sender_id, sender_type, receiver_id, receiver_type]):
                return jsonify({
                    "success": False,
                    "error": "All fields are required: sender_id, sender_type, receiver_id, receiver_type"
                }), 400
                
            # Validate user types
            valid_types = ['student', 'teacher', 'admin']
            if sender_type not in valid_types or receiver_type not in valid_types:
                return jsonify({
                    "success": False,
                    "error": f"Invalid user type. Must be one of: {', '.join(valid_types)}"
                }), 400
                
            # Check if it's the same user
            if sender_id == receiver_id and sender_type == receiver_type:
                return jsonify({
                    "success": False,
                    "error": "Cannot send message to yourself"
                }), 400
                
            # Check if users exist
            if not check_user_exists_db(sender_id, sender_type):
                return jsonify({
                    "success": False,
                    "error": f"Sender ({sender_type}) does not exist"
                }), 404
                
            if not check_user_exists_db(receiver_id, receiver_type):
                return jsonify({
                    "success": False,
                    "error": f"Receiver ({receiver_type}) does not exist"
                }), 404
                
        elif request.method == 'GET':
            user1_id = request.args.get('user1_id')
            user1_type = request.args.get('user1_type')
            user2_id = request.args.get('user2_id')
            user2_type = request.args.get('user2_type')
            
            if not all([user1_id, user1_type, user2_id, user2_type]):
                return jsonify({
                    "success": False,
                    "error": "All parameters are required: user1_id, user1_type, user2_id, user2_type"
                }), 400
            
            # For GET, we'll check if conversation exists and get last message
            sender_id = user1_id
            sender_type = user1_type
            receiver_id = user2_id
            receiver_type = user2_type
        
        print(f"🔍 Handling conversation between: {sender_type}:{sender_id} ↔ {receiver_type}:{receiver_id}")
        
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        
        if request.method == 'POST':
            # Only save message if user explicitly sends one
            if message_text and message_text.strip():
                cursor.execute("""
                    INSERT INTO chat_message 
                    (sender_id, sender_type, receiver_id, receiver_type, message_text, status, timestamp)
                    VALUES (%s, %s, %s, %s, %s, 'sent', CURRENT_TIMESTAMP)
                    RETURNING 
                        message_id,
                        sender_id,
                        sender_type,
                        receiver_id,
                        receiver_type,
                        message_text,
                        status,
                        timestamp,
                        is_read,
                        read_at
                """, (sender_id, sender_type, receiver_id, receiver_type, message_text))
                
                new_message = cursor.fetchone()
                conn.commit()
                message_dict = row_to_dict(cursor, new_message)
                
                # Get conversation info with last message
                conversation_info = {
                    "sender": {
                        "id": sender_id,
                        "type": sender_type,
                        "name": get_user_name(sender_id, sender_type)
                    },
                    "receiver": {
                        "id": receiver_id,
                        "type": receiver_type,
                        "name": get_user_name(receiver_id, receiver_type)
                    },
                    "last_message": {
                        "text": message_text,
                        "timestamp": message_dict['timestamp'].isoformat() if message_dict['timestamp'] else None,
                        "sender_id": sender_id,
                        "sender_type": sender_type
                    },
                    "message_count": 1,
                    "has_conversation": True
                }
                
                print(f"[OK] Started new conversation with message: {message_dict['message_id']}")
            else:
                # No message sent, just initialize conversation without any messages
                conversation_info = {
                    "sender": {
                        "id": sender_id,
                        "type": sender_type,
                        "name": get_user_name(sender_id, sender_type)
                    },
                    "receiver": {
                        "id": receiver_id,
                        "type": receiver_type,
                        "name": get_user_name(receiver_id, receiver_type)
                    },
                    "last_message": None,
                    "message_count": 0,
                    "has_conversation": False
                }
                
                print(f"[OK] Conversation initialized (waiting for first message)")
            
            cursor.close()
            conn.close()
            
            return jsonify({
                "success": True,
                "message": "Conversation started successfully",
                "conversation": conversation_info,
                "first_message": message_dict,
                "is_new": True
            }), 201
        
        else:  # GET request - check if conversation exists
            # FIXED: PostgreSQL compatible query without LIMIT in ARRAY_AGG
            cursor.execute("""
                SELECT 
                    COUNT(*) as message_count,
                    MAX(timestamp) as last_message_time
                FROM chat_message 
                WHERE (
                    (sender_id = %s AND sender_type = %s AND receiver_id = %s AND receiver_type = %s)
                    OR 
                    (sender_id = %s AND sender_type = %s AND receiver_id = %s AND receiver_type = %s)
                )
            """, (user1_id, user1_type, user2_id, user2_type,
                  user2_id, user2_type, user1_id, user1_type))
            
            conversation_data = cursor.fetchone()
            conv_dict = row_to_dict(cursor, conversation_data)
            
            # Get last message separately (PostgreSQL compatible way)
            cursor.execute("""
                SELECT 
                    message_text,
                    sender_id,
                    sender_type,
                    timestamp
                FROM chat_message 
                WHERE (
                    (sender_id = %s AND sender_type = %s AND receiver_id = %s AND receiver_type = %s)
                    OR 
                    (sender_id = %s AND sender_type = %s AND receiver_id = %s AND receiver_type = %s)
                )
                ORDER BY timestamp DESC
                LIMIT 1
            """, (user1_id, user1_type, user2_id, user2_type,
                  user2_id, user2_type, user1_id, user1_type))
            
            last_message_row = cursor.fetchone()
            last_message_dict = row_to_dict(cursor, last_message_row) if last_message_row else None
            
            cursor.close()
            conn.close()
            
            if conv_dict['message_count'] > 0:
                # Conversation exists
                sender_name = get_user_name(user1_id, user1_type)
                receiver_name = get_user_name(user2_id, user2_type)
                
                conversation_info = {
                    "sender": {
                        "id": user1_id,
                        "type": user1_type,
                        "name": sender_name
                    },
                    "receiver": {
                        "id": user2_id,
                        "type": user2_type,
                        "name": receiver_name
                    },
                    "last_message": {
                        "text": last_message_dict['message_text'] if last_message_dict else "",
                        "timestamp": last_message_dict['timestamp'].isoformat() if last_message_dict and last_message_dict['timestamp'] else None,
                        "sender_id": last_message_dict['sender_id'] if last_message_dict else None,
                        "sender_type": last_message_dict['sender_type'] if last_message_dict else None
                    },
                    "message_count": conv_dict['message_count'],
                    "has_conversation": True
                }
                
                print(f"[OK] Found existing conversation with {conv_dict['message_count']} messages")
                
                return jsonify({
                    "success": True,
                    "message": "Conversation exists",
                    "conversation": conversation_info,
                    "is_new": False
                })
            else:
                # No conversation yet
                print(f"ℹ️ No existing conversation found")
                
                return jsonify({
                    "success": True,
                    "message": "No conversation exists yet",
                    "conversation": {
                        "sender": {
                            "id": user1_id,
                            "type": user1_type,
                            "name": get_user_name(user1_id, user1_type)
                        },
                        "receiver": {
                            "id": user2_id,
                            "type": user2_type,
                            "name": get_user_name(user2_id, user2_type)
                        },
                        "has_conversation": False,
                        "message_count": 0
                    },
                    "is_new": True
                })
            
    except Exception as e:
        print(f"[ERROR] Error in handle_conversation: {e}")
        if 'conn' in locals() and conn:
            try:
                cursor.close()
                conn.close()
            except:
                pass
        return jsonify({
            "success": False,
            "error": f"Failed to handle conversation: {str(e)}"
        }), 500
    
# ===== HELPER FUNCTIONS =====

def check_user_exists_db(user_id, user_type):
    """Check if a user exists in the database"""
    try:
        conn = getDbConnection()
        if not conn:
            return False
        
        cursor = conn.cursor()
        
        if user_type == 'teacher':
            cursor.execute("SELECT 1 FROM teacher WHERE teacher_id = %s", (user_id,))
        elif user_type == 'student':
            cursor.execute("SELECT 1 FROM student WHERE student_id = %s", (user_id,))
        elif user_type == 'admin':
            cursor.execute("SELECT 1 FROM admin WHERE admin_id = %s", (user_id,))
        else:
            cursor.close()
            conn.close()
            return False
        
        exists = cursor.fetchone() is not None
        
        cursor.close()
        conn.close()
        
        return exists
        
    except Exception as e:
        print(f"[ERROR] Error in check_user_exists_db: {e}")
        return False

def get_user_name(user_id, user_type):
    """Get user's name from database"""
    try:
        conn = getDbConnection()
        if not conn:
            return "Unknown User"
        
        cursor = conn.cursor()
        
        if user_type == 'teacher':
            cursor.execute("SELECT name FROM teacher WHERE teacher_id = %s", (user_id,))
        elif user_type == 'student':
            cursor.execute("SELECT name FROM student WHERE student_id = %s", (user_id,))
        elif user_type == 'admin':
            cursor.execute("SELECT name FROM admin WHERE admin_id = %s", (user_id,))
        else:
            cursor.close()
            conn.close()
            return "Unknown User"
        
        result = cursor.fetchone()
        cursor.close()
        conn.close()
        
        return result[0] if result else "Unknown User"
        
    except Exception as e:
        print(f"[ERROR] Error in get_user_name: {e}")
        return "Unknown User"
    
# ===== GET USER'S CONVERSATIONS =====

@chat_bp.route('/api/chat/conversations', methods=['GET'])
def get_user_conversations():
    """Get all conversations for a specific user"""
    try:
        user_id = request.args.get('user_id')
        user_type = request.args.get('user_type')
        
        if not user_id or not user_type:
            return jsonify({
                "success": False,
                "error": "Both user_id and user_type are required"
            }), 400
        
        # Validate user type
        valid_types = ['student', 'teacher', 'admin']
        if user_type not in valid_types:
            return jsonify({
                "success": False,
                "error": f"Invalid user type. Must be one of: {', '.join(valid_types)}"
            }), 400
        
        print(f"🔍 Getting conversations for: {user_type}:{user_id}")
        
        # Check if user exists
        if not check_user_exists_db(user_id, user_type):
            return jsonify({
                "success": False,
                "error": f"User ({user_type}) not found"
            }), 404
        
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        
        # Get all conversations where user is either sender or receiver
        # We'll get distinct conversations with the last message info
        cursor.execute("""
            WITH user_conversations AS (
                -- Get all messages where user is involved
                SELECT 
                    CASE 
                        WHEN sender_id = %s AND sender_type = %s THEN receiver_id
                        ELSE sender_id
                    END as other_user_id,
                    CASE 
                        WHEN sender_id = %s AND sender_type = %s THEN receiver_type
                        ELSE sender_type
                    END as other_user_type,
                    message_id,
                    sender_id,
                    sender_type,
                    receiver_id,
                    receiver_type,
                    message_text,
                    timestamp,
                    is_read
                FROM chat_message 
                WHERE (sender_id = %s AND sender_type = %s)
                   OR (receiver_id = %s AND receiver_type = %s)
            ),
            latest_messages AS (
                -- Get the latest message for each conversation
                SELECT 
                    other_user_id,
                    other_user_type,
                    MAX(timestamp) as last_message_time
                FROM user_conversations
                GROUP BY other_user_id, other_user_type
            ),
            conversation_details AS (
                -- Get details of latest messages
                SELECT 
                    uc.other_user_id,
                    uc.other_user_type,
                    uc.message_id,
                    uc.message_text as last_message_text,
                    uc.sender_id,
                    uc.sender_type,
                    uc.timestamp as last_message_time,
                    uc.is_read,
                    -- Count unread messages
                    (SELECT COUNT(*) 
                     FROM user_conversations uc2 
                     WHERE uc2.other_user_id = uc.other_user_id 
                       AND uc2.other_user_type = uc.other_user_type
                       AND uc2.is_read = FALSE
                       AND uc2.receiver_id = %s
                       AND uc2.receiver_type = %s) as unread_count,
                    -- Total message count
                    (SELECT COUNT(*) 
                     FROM user_conversations uc3 
                     WHERE uc3.other_user_id = uc.other_user_id 
                       AND uc3.other_user_type = uc.other_user_type) as total_messages
                FROM user_conversations uc
                INNER JOIN latest_messages lm ON uc.other_user_id = lm.other_user_id 
                    AND uc.other_user_type = lm.other_user_type 
                    AND uc.timestamp = lm.last_message_time
                ORDER BY lm.last_message_time DESC
            )
            SELECT * FROM conversation_details
        """, (user_id, user_type, user_id, user_type, 
              user_id, user_type, user_id, user_type,
              user_id, user_type))
        
        conversations_raw = cursor.fetchall()
        conversations = []
        
        for conv in conversations_raw:
            conv_dict = row_to_dict(cursor, conv)
            if conv_dict:
                # Get other user's details
                other_user_name = get_user_name(conv_dict['other_user_id'], conv_dict['other_user_type'])
                
                conversation = {
                    "other_user": {
                        "id": conv_dict['other_user_id'],
                        "type": conv_dict['other_user_type'],
                        "name": other_user_name,
                        "avatar": other_user_name[0].upper() if other_user_name else 'U'
                    },
                    "last_message": {
                        "id": conv_dict['message_id'],
                        "text": conv_dict['last_message_text'],
                        "timestamp": conv_dict['last_message_time'].isoformat() if conv_dict['last_message_time'] else None,
                        "sender_id": conv_dict['sender_id'],
                        "sender_type": conv_dict['sender_type'],
                        "is_from_me": conv_dict['sender_id'] == user_id and conv_dict['sender_type'] == user_type
                    },
                    "unread_count": conv_dict['unread_count'] or 0,
                    "total_messages": conv_dict['total_messages'] or 0,
                    "is_read": conv_dict['is_read'] or False
                }
                conversations.append(conversation)
        
        cursor.close()
        conn.close()
        
        print(f"[OK] Found {len(conversations)} conversations for {user_type}:{user_id}")
        
        return jsonify({
            "success": True,
            "user_id": user_id,
            "user_type": user_type,
            "conversations": conversations,
            "count": len(conversations),
            "total_unread": sum(conv['unread_count'] for conv in conversations),
            "timestamp": datetime.now().isoformat()
        })
        
    except Exception as e:
        print(f"[ERROR] Error in get_user_conversations: {e}")
        if 'conn' in locals() and conn:
            try:
                cursor.close()
                conn.close()
            except:
                pass
        return jsonify({
            "success": False,
            "error": f"Failed to get conversations: {str(e)}"
        }), 500
    
# ===== SEND MESSAGE =====

@chat_bp.route('/api/chat/send-message', methods=['POST'])
def send_message():
    """Send a new message"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({
                "success": False,
                "error": "No JSON data provided"
            }), 400
        
        # Extract data
        sender_id = data.get('sender_id')
        sender_type = data.get('sender_type')
        receiver_id = data.get('receiver_id')
        receiver_type = data.get('receiver_type')
        message_text = data.get('message_text', '').strip()
        
        # Validate required fields
        if not all([sender_id, sender_type, receiver_id, receiver_type]):
            return jsonify({
                "success": False,
                "error": "Missing required fields: sender_id, sender_type, receiver_id, receiver_type"
            }), 400
        
        if not message_text:
            return jsonify({
                "success": False,
                "error": "Message text cannot be empty"
            }), 400
            
        # Validate user types
        valid_types = ['student', 'teacher', 'admin']
        if sender_type not in valid_types or receiver_type not in valid_types:
            return jsonify({
                "success": False,
                "error": f"Invalid user type. Must be one of: {', '.join(valid_types)}"
            }), 400
            
        # Check if it's the same user
        if sender_id == receiver_id and sender_type == receiver_type:
            return jsonify({
                "success": False,
                "error": "Cannot send message to yourself"
            }), 400
            
        # Check if users exist
        if not check_user_exists_db(sender_id, sender_type):
            return jsonify({
                "success": False,
                "error": f"Sender ({sender_type}) does not exist"
            }), 404
            
        if not check_user_exists_db(receiver_id, receiver_type):
            return jsonify({
                "success": False,
                "error": f"Receiver ({receiver_type}) does not exist"
            }), 404
        
        print(f"📨 Sending message: {sender_type}:{sender_id} → {receiver_type}:{receiver_id}")
        print(f"   Message: {message_text[:50]}...")
        
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        
        # Insert the message
        cursor.execute("""
            INSERT INTO chat_message 
            (sender_id, sender_type, receiver_id, receiver_type, message_text, status, timestamp)
            VALUES (%s, %s, %s, %s, %s, 'sent', CURRENT_TIMESTAMP)
            RETURNING 
                message_id,
                sender_id,
                sender_type,
                receiver_id,
                receiver_type,
                message_text,
                status,
                timestamp,
                is_read,
                read_at
        """, (sender_id, sender_type, receiver_id, receiver_type, message_text))
        
        new_message = cursor.fetchone()
        conn.commit()
        message_dict = row_to_dict(cursor, new_message)
        
        # Get sender and receiver names for response
        sender_name = get_user_name(sender_id, sender_type)
        receiver_name = get_user_name(receiver_id, receiver_type)
        
        cursor.close()
        conn.close()
        
        print(f"[OK] Message sent successfully: ID {message_dict['message_id']}")
        
        # Prepare response
        response_data = {
            "success": True,
            "message": "Message sent successfully",
            "message_id": message_dict['message_id'],
            "message": {
                "id": message_dict['message_id'],
                "sender_id": message_dict['sender_id'],
                "sender_type": message_dict['sender_type'],
                "sender_name": sender_name,
                "receiver_id": message_dict['receiver_id'],
                "receiver_type": message_dict['receiver_type'],
                "receiver_name": receiver_name,
                "text": message_dict['message_text'],
                "timestamp": message_dict['timestamp'].isoformat() if message_dict['timestamp'] else None,
                "status": message_dict['status'],
                "is_read": message_dict['is_read']
            },
            "timestamp": datetime.now().isoformat()
        }
        
        return jsonify(response_data), 201
        
    except Exception as e:
        print(f"[ERROR] Error in send_message: {e}")
        if 'conn' in locals() and conn:
            try:
                cursor.close()
                conn.close()
            except:
                pass
        return jsonify({
            "success": False,
            "error": f"Failed to send message: {str(e)}"
        }), 500
    
# ===== GET MESSAGES BETWEEN USERS =====

@chat_bp.route('/api/chat/messages', methods=['GET'])
def get_messages():
    """Get messages between two users with file info"""
    try:
        # Get parameters
        user1_id = request.args.get('user1_id')
        user1_type = request.args.get('user1_type')
        user2_id = request.args.get('user2_id')
        user2_type = request.args.get('user2_type')
        limit = request.args.get('limit', 50, type=int)
        offset = request.args.get('offset', 0, type=int)
        
        # Validate required parameters
        if not all([user1_id, user1_type, user2_id, user2_type]):
            return jsonify({
                "success": False,
                "error": "Missing required parameters: user1_id, user1_type, user2_id, user2_type"
            }), 400
            
        # Validate user types
        valid_types = ['student', 'teacher', 'admin']
        if user1_type not in valid_types or user2_type not in valid_types:
            return jsonify({
                "success": False,
                "error": f"Invalid user type. Must be one of: {', '.join(valid_types)}"
            }), 400
        
        print(f"📨 Getting messages between: {user1_type}:{user1_id} ↔ {user2_type}:{user2_id}")
        
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        
        # Get total count first
        cursor.execute("""
            SELECT COUNT(*) as total_messages
            FROM chat_message 
            WHERE ((sender_id = %s AND sender_type = %s AND receiver_id = %s AND receiver_type = %s)
                OR (sender_id = %s AND sender_type = %s AND receiver_id = %s AND receiver_type = %s))
        """, (user1_id, user1_type, user2_id, user2_type,
              user2_id, user2_type, user1_id, user1_type))
        
        total_result = cursor.fetchone()
        total_messages = total_result[0] if total_result else 0
        
        # Get messages WITH FILE COLUMNS
        cursor.execute("""
            SELECT 
                message_id,
                sender_id,
                sender_type,
                receiver_id,
                receiver_type,
                message_text,
                status,
                timestamp,
                is_read,
                read_at,
                file_name,       -- ADDED
                file_size,       -- ADDED
                file_type,       -- ADDED
                file_mime        -- ADDED
            FROM chat_message 
            WHERE ((sender_id = %s AND sender_type = %s AND receiver_id = %s AND receiver_type = %s)
                OR (sender_id = %s AND sender_type = %s AND receiver_id = %s AND receiver_type = %s))
            ORDER BY timestamp DESC
            LIMIT %s OFFSET %s
        """, (user1_id, user1_type, user2_id, user2_type,
              user2_id, user2_type, user1_id, user1_type,
              limit, offset))
        
        messages_raw = cursor.fetchall()
        messages = []
        
        for msg in messages_raw:
            msg_dict = row_to_dict(cursor, msg)
            if msg_dict:
                sender_name = get_user_name(msg_dict['sender_id'], msg_dict['sender_type'])
                receiver_name = get_user_name(msg_dict['receiver_id'], msg_dict['receiver_type'])
                
                # Build message object
                message = {
                    "id": msg_dict['message_id'],
                    "sender": {
                        "id": msg_dict['sender_id'],
                        "type": msg_dict['sender_type'],
                        "name": sender_name
                    },
                    "receiver": {
                        "id": msg_dict['receiver_id'],
                        "type": msg_dict['receiver_type'],
                        "name": receiver_name
                    },
                    "text": msg_dict['message_text'],
                    "timestamp": msg_dict['timestamp'].isoformat() if msg_dict['timestamp'] else None,
                    "status": msg_dict['status'],
                    "is_read": msg_dict['is_read'],
                    "read_at": msg_dict['read_at'].isoformat() if msg_dict['read_at'] else None,
                    "is_from_me": msg_dict['sender_id'] == user1_id and msg_dict['sender_type'] == user1_type,
                    
                    # ADD FILE INFO HERE
                    "has_file": msg_dict['file_name'] is not None,
                    "file": {
                        "name": msg_dict['file_name'],
                        "size": msg_dict['file_size'],
                        "type": msg_dict['file_type'],
                        "mime": msg_dict['file_mime'],
                        "download_url": f"/api/chat/download/{msg_dict['message_id']}"
                    } if msg_dict['file_name'] else None
                }
                messages.append(message)
        
        # Mark messages as read if user1 is the receiver
        if messages:
            cursor.execute("""
                UPDATE chat_message 
                SET is_read = TRUE, read_at = CURRENT_TIMESTAMP
                WHERE receiver_id = %s AND receiver_type = %s 
                  AND sender_id = %s AND sender_type = %s
                  AND is_read = FALSE
            """, (user1_id, user1_type, user2_id, user2_type))
            conn.commit()
        
        cursor.close()
        conn.close()
        
        print(f"[OK] Retrieved {len(messages)} messages (total: {total_messages})")
        
        return jsonify({
            "success": True,
            "user1": {
                "id": user1_id,
                "type": user1_type,
                "name": get_user_name(user1_id, user1_type)
            },
            "user2": {
                "id": user2_id,
                "type": user2_type,
                "name": get_user_name(user2_id, user2_type)
            },
            "messages": messages,
            "total_messages": total_messages,
            "returned": len(messages),
            "limit": limit,
            "offset": offset,
            "has_more": total_messages > (offset + len(messages)),
            "timestamp": datetime.now().isoformat()
        })
        
    except Exception as e:
        print(f"[ERROR] Error in get_messages: {e}")
        if 'conn' in locals() and conn:
            try:
                cursor.close()
                conn.close()
            except:
                pass
        return jsonify({
            "success": False,
            "error": f"Failed to get messages: {str(e)}"
        }), 500
    
@chat_bp.route('/api/chat/download/<int:message_id>', methods=['GET'])
def download_file(message_id):
    """Download file from database"""
    try:
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        
        # Get file data - FIXED: include file_type and file_mime
        cursor.execute("""
            SELECT file_name, file_data, file_mime, file_size, file_type
            FROM chat_message 
            WHERE message_id = %s AND file_data IS NOT NULL
        """, (message_id,))
        
        result = cursor.fetchone()
        
        if not result:
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": "File not found"}), 404
        
        filename, file_data, mime_type, file_size, file_type = result
        
        if not file_data:
            cursor.close()
            conn.close()
            return jsonify({"success": False, "error": "No file data"}), 404
        
        cursor.close()
        conn.close()
        
        # Create response
        from flask import Response
        
        response = Response(
            file_data,
            mimetype=mime_type,
            headers={
                'Content-Disposition': f'attachment; filename="{filename}"',
                'Content-Length': str(file_size)
            }
        )
        
        return response
        
    except Exception as e:
        print(f"[ERROR] Error downloading file: {e}")
        return jsonify({
            "success": False,
            "error": f"Failed to download file: {str(e)}"
        }), 500
    
# ===== POLL FOR NEW MESSAGES =====

@chat_bp.route('/api/chat/poll-messages', methods=['GET'])
def poll_messages():
    """Poll for new messages since a specific timestamp"""
    try:
        # Get parameters
        user_id = request.args.get('user_id')
        user_type = request.args.get('user_type')
        last_check_timestamp = request.args.get('last_check')
        
        if not all([user_id, user_type]):
            return jsonify({
                "success": False,
                "error": "Missing required parameters: user_id, user_type"
            }), 400
            
        # Validate user type
        valid_types = ['student', 'teacher', 'admin']
        if user_type not in valid_types:
            return jsonify({
                "success": False,
                "error": f"Invalid user type. Must be one of: {', '.join(valid_types)}"
            }), 400
        
        # Check if user exists
        if not check_user_exists_db(user_id, user_type):
            return jsonify({
                "success": False,
                "error": f"User ({user_type}) not found"
            }), 404
        
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        
        # Build query based on whether we have a last_check timestamp
        if last_check_timestamp:
            try:
                # Try to parse the timestamp
                last_check = datetime.fromisoformat(last_check_timestamp.replace('Z', '+00:00'))
                
                # Get new messages where user is receiver (messages sent to them)
                cursor.execute("""
                    SELECT 
                        message_id,
                        sender_id,
                        sender_type,
                        receiver_id,
                        receiver_type,
                        message_text,
                        status,
                        timestamp,
                        is_read,
                        read_at
                    FROM chat_message 
                    WHERE receiver_id = %s 
                      AND receiver_type = %s
                      AND timestamp > %s
                    ORDER BY timestamp DESC
                    LIMIT 50
                """, (user_id, user_type, last_check))
                
            except ValueError:
                cursor.close()
                conn.close()
                return jsonify({
                    "success": False,
                    "error": "Invalid timestamp format. Use ISO format (YYYY-MM-DDTHH:MM:SS)"
                }), 400
        else:
            # If no last_check, get all unread messages
            cursor.execute("""
                SELECT 
                    message_id,
                    sender_id,
                    sender_type,
                    receiver_id,
                    receiver_type,
                    message_text,
                    status,
                    timestamp,
                    is_read,
                    read_at
                FROM chat_message 
                WHERE receiver_id = %s 
                  AND receiver_type = %s
                  AND is_read = FALSE
                ORDER BY timestamp DESC
                LIMIT 50
            """, (user_id, user_type))
        
        new_messages_raw = cursor.fetchall()
        new_messages = []
        
        for msg in new_messages_raw:
            msg_dict = row_to_dict(cursor, msg)
            if msg_dict:
                sender_name = get_user_name(msg_dict['sender_id'], msg_dict['sender_type'])
                
                message = {
                    "id": msg_dict['message_id'],
                    "sender": {
                        "id": msg_dict['sender_id'],
                        "type": msg_dict['sender_type'],
                        "name": sender_name
                    },
                    "receiver": {
                        "id": msg_dict['receiver_id'],
                        "type": msg_dict['receiver_type'],
                        "name": get_user_name(msg_dict['receiver_id'], msg_dict['receiver_type'])
                    },
                    "text": msg_dict['message_text'],
                    "timestamp": msg_dict['timestamp'].isoformat() if msg_dict['timestamp'] else None,
                    "status": msg_dict['status'],
                    "is_read": msg_dict['is_read'],
                    "read_at": msg_dict['read_at'].isoformat() if msg_dict['read_at'] else None,
                    "is_new": True  # Flag to indicate this is a new message
                }
                new_messages.append(message)
        
        # Also check for updated read status on messages user sent
        if last_check_timestamp:
            try:
                last_check = datetime.fromisoformat(last_check_timestamp.replace('Z', '+00:00'))
                
                # Get messages where user is sender and read status changed
                cursor.execute("""
                    SELECT 
                        message_id,
                        sender_id,
                        sender_type,
                        receiver_id,
                        receiver_type,
                        message_text,
                        status,
                        timestamp,
                        is_read,
                        read_at
                    FROM chat_message 
                    WHERE sender_id = %s 
                      AND sender_type = %s
                      AND (read_at > %s OR (is_read = TRUE AND read_at IS NOT NULL))
                    ORDER BY timestamp DESC
                    LIMIT 20
                """, (user_id, user_type, last_check))
                
                read_updates_raw = cursor.fetchall()
                
                for msg in read_updates_raw:
                    msg_dict = row_to_dict(cursor, msg)
                    if msg_dict:
                        # Check if this message is already in new_messages
                        existing = next((m for m in new_messages if m['id'] == msg_dict['message_id']), None)
                        if not existing:
                            sender_name = get_user_name(msg_dict['sender_id'], msg_dict['sender_type'])
                            
                            message = {
                                "id": msg_dict['message_id'],
                                "sender": {
                                    "id": msg_dict['sender_id'],
                                    "type": msg_dict['sender_type'],
                                    "name": sender_name
                                },
                                "receiver": {
                                    "id": msg_dict['receiver_id'],
                                    "type": msg_dict['receiver_type'],
                                    "name": get_user_name(msg_dict['receiver_id'], msg_dict['receiver_type'])
                                },
                                "text": msg_dict['message_text'],
                                "timestamp": msg_dict['timestamp'].isoformat() if msg_dict['timestamp'] else None,
                                "status": msg_dict['status'],
                                "is_read": msg_dict['is_read'],
                                "read_at": msg_dict['read_at'].isoformat() if msg_dict['read_at'] else None,
                                "is_read_update": True  # Flag to indicate read status update
                            }
                            new_messages.append(message)
                
            except ValueError:
                # Ignore timestamp parsing error for read updates
                pass
        
        cursor.close()
        conn.close()
        
        print(f"🔍 Polling messages for {user_type}:{user_id}")
        print(f"   Found {len(new_messages)} new messages/updates")
        if last_check_timestamp:
            print(f"   Since: {last_check_timestamp}")
        
        return jsonify({
            "success": True,
            "user_id": user_id,
            "user_type": user_type,
            "new_messages": new_messages,
            "count": len(new_messages),
            "has_new_messages": len(new_messages) > 0,
            "current_timestamp": datetime.now().isoformat(),
            "last_check_timestamp": last_check_timestamp,
            "timestamp": datetime.now().isoformat()
        })
        
    except Exception as e:
        print(f"[ERROR] Error in poll_messages: {e}")
        if 'conn' in locals() and conn:
            try:
                cursor.close()
                conn.close()
            except:
                pass
        return jsonify({
            "success": False,
            "error": f"Failed to poll messages: {str(e)}"
        }), 500

@chat_bp.route('/api/chat/upload-file', methods=['POST'])
def upload_file():
    """Upload file to database with all file fields"""
    try:
        if 'file' not in request.files:
            return jsonify({"success": False, "error": "No file uploaded"}), 400
        
        file = request.files['file']
        
        if file.filename == '':
            return jsonify({"success": False, "error": "No file selected"}), 400
        
        # Read file bytes
        file_bytes = file.read()
        file_size = len(file_bytes)
        
        # Get form data
        sender_id = request.form.get('sender_id')
        sender_type = request.form.get('sender_type')
        receiver_id = request.form.get('receiver_id')
        receiver_type = request.form.get('receiver_type')
        
        if not all([sender_id, sender_type, receiver_id, receiver_type]):
            return jsonify({
                "success": False,
                "error": "Missing user information"
            }), 400
        
        # Check file size (max 10MB)
        MAX_SIZE = 10 * 1024 * 1024
        if file_size > MAX_SIZE:
            return jsonify({
                "success": False,
                "error": f"File too large. Maximum size is {MAX_SIZE // (1024*1024)}MB"
            }), 400
        
        # Get file info
        original_filename = file.filename
        file_ext = original_filename.rsplit('.', 1)[-1].lower() if '.' in original_filename else ''
        mime_type = file.content_type or 'application/octet-stream'
        
        print(f"📁 Uploading file: {original_filename} ({file_size} bytes)")
        
        # Store in database WITH ALL FILE FIELDS
        conn = getDbConnection()
        cursor = conn.cursor()
        
        cursor.execute("""
            INSERT INTO chat_message 
            (sender_id, sender_type, receiver_id, receiver_type,
             message_text, file_name, file_data, file_size, 
             file_type, file_mime, timestamp)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
            RETURNING message_id
        """, (
            sender_id,
            sender_type,
            receiver_id,
            receiver_type,
            f"📎 {original_filename}",  # Message text with file emoji
            original_filename,      # file_name
            file_bytes,             # file_data
            file_size,              # file_size
            file_ext,               # file_type (extension)
            mime_type               # file_mime
        ))
        
        message_id = cursor.fetchone()[0]
        conn.commit()
        cursor.close()
        conn.close()
        
        print(f"[OK] File uploaded to database: {original_filename} (ID: {message_id})")
        
        return jsonify({
            "success": True,
            "message": "File uploaded successfully!",
            "message_id": message_id,
            "file": {
                "name": original_filename,
                "size": file_size,
                "type": file_ext,
                "mime": mime_type,
                "download_url": f"/api/chat/download/{message_id}"
            }
        })
        
    except Exception as e:
        print(f"[ERROR] Error in upload_file: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

# ===== GET STUDENT'S CHAT CONVERSATIONS =====

@chat_bp.route('/api/chat/student-conversations', methods=['GET'])
def get_student_conversations():
    """Get all conversations for a specific student with all chat partners"""
    try:
        student_id = request.args.get('student_id')
        
        if not student_id:
            return jsonify({
                "success": False,
                "error": "Student ID is required"
            }), 400
        
        # Check if student exists
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        
        # Check if student exists
        cursor.execute("SELECT name FROM student WHERE student_id = %s", (student_id,))
        student_data = cursor.fetchone()
        
        if not student_data:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": f"Student with ID {student_id} not found"
            }), 404
        
        student_name = student_data[0]
        
        print(f"🔍 Getting all conversations for student: {student_name} ({student_id})")
        
        # Get all unique chat partners (both teachers and other students)
        # ===== 1. Get conversations with TEACHERS =====
        cursor.execute("""
            WITH teacher_conversations AS (
                SELECT DISTINCT ON (cm.sender_id, cm.sender_type) 
                    cm.sender_id as partner_id,
                    cm.sender_type as partner_type,
                    t.name as partner_name,
                    t.email as partner_email,
                    t.department as partner_department,
                    t.profile_image_url as partner_avatar,
                    cm.message_text as last_message,
                    cm.timestamp as last_message_time,
                    cm.is_read,
                    cm.message_id
                FROM chat_message cm
                JOIN teacher t ON cm.sender_id = t.teacher_id
                WHERE cm.receiver_id = %s 
                  AND cm.receiver_type = 'student'
                  AND cm.sender_type = 'teacher'
                
                UNION
                
                SELECT DISTINCT ON (cm.receiver_id, cm.receiver_type) 
                    cm.receiver_id as partner_id,
                    cm.receiver_type as partner_type,
                    t.name as partner_name,
                    t.email as partner_email,
                    t.department as partner_department,
                    t.profile_image_url as partner_avatar,
                    cm.message_text as last_message,
                    cm.timestamp as last_message_time,
                    cm.is_read,
                    cm.message_id
                FROM chat_message cm
                JOIN teacher t ON cm.receiver_id = t.teacher_id
                WHERE cm.sender_id = %s 
                  AND cm.sender_type = 'student'
                  AND cm.receiver_type = 'teacher'
                
                ORDER BY partner_type, partner_id, last_message_time DESC
            )
            SELECT 
                partner_id,
                partner_type,
                partner_name,
                partner_email,
                partner_department,
                partner_avatar,
                last_message,
                last_message_time,
                is_read,
                message_id,
                -- Get unread count
                (SELECT COUNT(*) 
                 FROM chat_message 
                 WHERE ((sender_id = %s AND sender_type = 'student' AND receiver_id = partner_id AND receiver_type = partner_type)
                     OR (sender_id = partner_id AND sender_type = partner_type AND receiver_id = %s AND receiver_type = 'student'))
                   AND is_read = FALSE
                   AND receiver_id = %s
                   AND receiver_type = 'student') as unread_count,
                -- Get total message count
                (SELECT COUNT(*) 
                 FROM chat_message 
                 WHERE (sender_id = %s AND sender_type = 'student' AND receiver_id = partner_id AND receiver_type = partner_type)
                    OR (sender_id = partner_id AND sender_type = partner_type AND receiver_id = %s AND receiver_type = 'student')) as total_messages
            FROM teacher_conversations
            ORDER BY last_message_time DESC
        """, (student_id, student_id, student_id, student_id, student_id, student_id, student_id))
        
        teacher_conversations = cursor.fetchall()
        
        # ===== 2. Get conversations with OTHER STUDENTS =====
        cursor.execute("""
            WITH student_conversations AS (
                SELECT DISTINCT ON (cm.sender_id, cm.sender_type) 
                    cm.sender_id as partner_id,
                    cm.sender_type as partner_type,
                    s.name as partner_name,
                    s.email as partner_email,
                    CONCAT('Semester ', s.semester) as partner_department,
                    s.profile_image_url as partner_avatar,
                    cm.message_text as last_message,
                    cm.timestamp as last_message_time,
                    cm.is_read,
                    cm.message_id
                FROM chat_message cm
                JOIN student s ON cm.sender_id = s.student_id
                WHERE cm.receiver_id = %s 
                  AND cm.receiver_type = 'student'
                  AND cm.sender_type = 'student'
                  AND cm.sender_id != %s  -- Exclude self
                
                UNION
                
                SELECT DISTINCT ON (cm.receiver_id, cm.receiver_type) 
                    cm.receiver_id as partner_id,
                    cm.receiver_type as partner_type,
                    s.name as partner_name,
                    s.email as partner_email,
                    CONCAT('Semester ', s.semester) as partner_department,
                    s.profile_image_url as partner_avatar,
                    cm.message_text as last_message,
                    cm.timestamp as last_message_time,
                    cm.is_read,
                    cm.message_id
                FROM chat_message cm
                JOIN student s ON cm.receiver_id = s.student_id
                WHERE cm.sender_id = %s 
                  AND cm.sender_type = 'student'
                  AND cm.receiver_type = 'student'
                  AND cm.receiver_id != %s  -- Exclude self
                
                ORDER BY partner_type, partner_id, last_message_time DESC
            )
            SELECT 
                partner_id,
                partner_type,
                partner_name,
                partner_email,
                partner_department,
                partner_avatar,
                last_message,
                last_message_time,
                is_read,
                message_id,
                -- Get unread count
                (SELECT COUNT(*) 
                 FROM chat_message 
                 WHERE ((sender_id = %s AND sender_type = 'student' AND receiver_id = partner_id AND receiver_type = partner_type)
                     OR (sender_id = partner_id AND sender_type = partner_type AND receiver_id = %s AND receiver_type = 'student'))
                   AND is_read = FALSE
                   AND receiver_id = %s
                   AND receiver_type = 'student') as unread_count,
                -- Get total message count
                (SELECT COUNT(*) 
                 FROM chat_message 
                 WHERE (sender_id = %s AND sender_type = 'student' AND receiver_id = partner_id AND receiver_type = partner_type)
                    OR (sender_id = partner_id AND sender_type = partner_type AND receiver_id = %s AND receiver_type = 'student')) as total_messages
            FROM student_conversations
            ORDER BY last_message_time DESC
        """, (student_id, student_id, student_id, student_id, student_id, student_id, student_id, student_id, student_id))
        
        student_conversations = cursor.fetchall()
        
        # ===== 3. Get conversations with ADMINS =====
        cursor.execute("""
            WITH admin_conversations AS (
                SELECT DISTINCT ON (cm.sender_id, cm.sender_type) 
                    cm.sender_id as partner_id,
                    cm.sender_type as partner_type,
                    a.name as partner_name,
                    a.email as partner_email,
                    'Administration' as partner_department,
                    a.profile_image_url as partner_avatar,
                    cm.message_text as last_message,
                    cm.timestamp as last_message_time,
                    cm.is_read,
                    cm.message_id
                FROM chat_message cm
                JOIN admin a ON cm.sender_id = a.admin_id
                WHERE cm.receiver_id = %s 
                  AND cm.receiver_type = 'student'
                  AND cm.sender_type = 'admin'
                
                UNION
                
                SELECT DISTINCT ON (cm.receiver_id, cm.receiver_type) 
                    cm.receiver_id as partner_id,
                    cm.receiver_type as partner_type,
                    a.name as partner_name,
                    a.email as partner_email,
                    'Administration' as partner_department,
                    a.profile_image_url as partner_avatar,
                    cm.message_text as last_message,
                    cm.timestamp as last_message_time,
                    cm.is_read,
                    cm.message_id
                FROM chat_message cm
                JOIN admin a ON cm.receiver_id = a.admin_id
                WHERE cm.sender_id = %s 
                  AND cm.sender_type = 'student'
                  AND cm.receiver_type = 'admin'
                
                ORDER BY partner_type, partner_id, last_message_time DESC
            )
            SELECT 
                partner_id,
                partner_type,
                partner_name,
                partner_email,
                partner_department,
                partner_avatar,
                last_message,
                last_message_time,
                is_read,
                message_id,
                -- Get unread count
                (SELECT COUNT(*) 
                 FROM chat_message 
                 WHERE ((sender_id = %s AND sender_type = 'student' AND receiver_id = partner_id AND receiver_type = partner_type)
                     OR (sender_id = partner_id AND sender_type = partner_type AND receiver_id = %s AND receiver_type = 'student'))
                   AND is_read = FALSE
                   AND receiver_id = %s
                   AND receiver_type = 'student') as unread_count,
                -- Get total message count
                (SELECT COUNT(*) 
                 FROM chat_message 
                 WHERE (sender_id = %s AND sender_type = 'student' AND receiver_id = partner_id AND receiver_type = partner_type)
                    OR (sender_id = partner_id AND sender_type = partner_type AND receiver_id = %s AND receiver_type = 'student')) as total_messages
            FROM admin_conversations
            ORDER BY last_message_time DESC
        """, (student_id, student_id, student_id, student_id, student_id, student_id, student_id))
        
        admin_conversations = cursor.fetchall()
        
        # Combine all conversations
        all_conversations = []
        
        # Process teacher conversations
        for conv in teacher_conversations:
            conv_dict = row_to_dict(cursor, conv)
            if conv_dict and conv_dict['partner_name']:
                all_conversations.append({
                    "partner": {
                        "id": conv_dict['partner_id'],
                        "type": conv_dict['partner_type'],
                        "name": conv_dict['partner_name'],
                        "email": conv_dict['partner_email'],
                        "role": "Teacher",
                        "department": conv_dict['partner_department'] or "Not specified",
                        "avatar": conv_dict['partner_avatar'] or conv_dict['partner_name'][0].upper()
                    },
                    "last_message": {
                        "id": conv_dict['message_id'],
                        "text": conv_dict['last_message'],
                        "timestamp": conv_dict['last_message_time'].isoformat() if conv_dict['last_message_time'] else None,
                        "is_read": conv_dict['is_read']
                    },
                    "unread_count": conv_dict['unread_count'] or 0,
                    "total_messages": conv_dict['total_messages'] or 0,
                    "is_last_message_from_me": False,  # Will update after checking
                    "last_interaction": conv_dict['last_message_time']
                })
        
        # Process student conversations
        for conv in student_conversations:
            conv_dict = row_to_dict(cursor, conv)
            if conv_dict and conv_dict['partner_name']:
                all_conversations.append({
                    "partner": {
                        "id": conv_dict['partner_id'],
                        "type": conv_dict['partner_type'],
                        "name": conv_dict['partner_name'],
                        "email": conv_dict['partner_email'],
                        "role": "Student",
                        "department": conv_dict['partner_department'] or "Not specified",
                        "avatar": conv_dict['partner_avatar'] or conv_dict['partner_name'][0].upper()
                    },
                    "last_message": {
                        "id": conv_dict['message_id'],
                        "text": conv_dict['last_message'],
                        "timestamp": conv_dict['last_message_time'].isoformat() if conv_dict['last_message_time'] else None,
                        "is_read": conv_dict['is_read']
                    },
                    "unread_count": conv_dict['unread_count'] or 0,
                    "total_messages": conv_dict['total_messages'] or 0,
                    "is_last_message_from_me": False,  # Will update after checking
                    "last_interaction": conv_dict['last_message_time']
                })
        
        # Process admin conversations
        for conv in admin_conversations:
            conv_dict = row_to_dict(cursor, conv)
            if conv_dict and conv_dict['partner_name']:
                all_conversations.append({
                    "partner": {
                        "id": conv_dict['partner_id'],
                        "type": conv_dict['partner_type'],
                        "name": conv_dict['partner_name'],
                        "email": conv_dict['partner_email'],
                        "role": "Admin",
                        "department": conv_dict['partner_department'] or "Administration",
                        "avatar": conv_dict['partner_avatar'] or conv_dict['partner_name'][0].upper()
                    },
                    "last_message": {
                        "id": conv_dict['message_id'],
                        "text": conv_dict['last_message'],
                        "timestamp": conv_dict['last_message_time'].isoformat() if conv_dict['last_message_time'] else None,
                        "is_read": conv_dict['is_read']
                    },
                    "unread_count": conv_dict['unread_count'] or 0,
                    "total_messages": conv_dict['total_messages'] or 0,
                    "is_last_message_from_me": False,  # Will update after checking
                    "last_interaction": conv_dict['last_message_time']
                })
        
        # Now, for each conversation, check if last message was sent by student
        for conv in all_conversations:
            cursor.execute("""
                SELECT sender_id, sender_type 
                FROM chat_message 
                WHERE message_id = %s
            """, (conv['last_message']['id'],))
            
            last_msg_sender = cursor.fetchone()
            if last_msg_sender:
                sender_id, sender_type = last_msg_sender
                conv['is_last_message_from_me'] = (sender_id == student_id and sender_type == 'student')
        
        # Sort all conversations by last interaction time (newest first)
        all_conversations.sort(key=lambda x: x['last_interaction'] or datetime.min, reverse=True)
        
        # Calculate totals
        total_conversations = len(all_conversations)
        total_unread = sum(conv['unread_count'] for conv in all_conversations)
        total_messages = sum(conv['total_messages'] for conv in all_conversations)
        
        cursor.close()
        conn.close()
        
        print(f"[OK] Found {total_conversations} conversations for student {student_name}")
        print(f"   Total messages: {total_messages}, Unread: {total_unread}")
        
        return jsonify({
            "success": True,
            "student": {
                "id": student_id,
                "name": student_name,
                "type": "student"
            },
            "conversations": all_conversations,
            "summary": {
                "total_conversations": total_conversations,
                "total_messages": total_messages,
                "total_unread": total_unread,
                "conversations_by_type": {
                    "teachers": len([c for c in all_conversations if c['partner']['type'] == 'teacher']),
                    "students": len([c for c in all_conversations if c['partner']['type'] == 'student']),
                    "admins": len([c for c in all_conversations if c['partner']['type'] == 'admin'])
                }
            },
            "timestamp": datetime.now().isoformat()
        })
        
    except Exception as e:
        print(f"[ERROR] Error in get_student_conversations: {e}")
        if 'conn' in locals() and conn:
            try:
                cursor.close()
                conn.close()
            except:
                pass
        return jsonify({
            "success": False,
            "error": f"Failed to get student conversations: {str(e)}"
        }), 500


# ===== SIMPLIFIED ALTERNATIVE (FASTER QUERY) =====

@chat_bp.route('/api/chat/student-conversations-simple', methods=['GET'])
def get_student_conversations_simple():
    """Simplified version to get student conversations (faster query)"""
    try:
        student_id = request.args.get('student_id')
        
        if not student_id:
            return jsonify({
                "success": False,
                "error": "Student ID is required"
            }), 400
        
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        
        # Check if student exists
        cursor.execute("SELECT name FROM student WHERE student_id = %s", (student_id,))
        student_data = cursor.fetchone()
        
        if not student_data:
            cursor.close()
            conn.close()
            return jsonify({
                "success": False,
                "error": f"Student with ID {student_id} not found"
            }), 404
        
        student_name = student_data[0]
        
        print(f"🔍 Getting conversations for student: {student_name}")
        
        # Get all unique conversations with detailed partner info
        cursor.execute("""
            WITH all_conversations AS (
                -- Messages where student is receiver
                SELECT 
                    cm.sender_id as partner_id,
                    cm.sender_type as partner_type,
                    cm.message_text as last_message,
                    cm.timestamp as last_message_time,
                    cm.is_read,
                    cm.message_id,
                    cm.file_name,
                    cm.file_size
                FROM chat_message cm
                WHERE cm.receiver_id = %s 
                  AND cm.receiver_type = 'student'
                
                UNION ALL
                
                -- Messages where student is sender
                SELECT 
                    cm.receiver_id as partner_id,
                    cm.receiver_type as partner_type,
                    cm.message_text as last_message,
                    cm.timestamp as last_message_time,
                    cm.is_read,
                    cm.message_id,
                    cm.file_name,
                    cm.file_size
                FROM chat_message cm
                WHERE cm.sender_id = %s 
                  AND cm.sender_type = 'student'
            ),
            latest_conversations AS (
                SELECT DISTINCT ON (partner_id, partner_type) 
                    partner_id,
                    partner_type,
                    last_message,
                    last_message_time,
                    is_read,
                    message_id,
                    file_name,
                    file_size
                FROM all_conversations
                ORDER BY partner_id, partner_type, last_message_time DESC
            )
            SELECT 
                lc.partner_id,
                lc.partner_type,
                lc.last_message,
                lc.last_message_time,
                lc.is_read,
                lc.message_id,
                lc.file_name,
                lc.file_size,
                -- Get partner details
                CASE 
                    WHEN lc.partner_type = 'teacher' THEN (SELECT name FROM teacher WHERE teacher_id = lc.partner_id)
                    WHEN lc.partner_type = 'student' THEN (SELECT name FROM student WHERE student_id = lc.partner_id)
                    WHEN lc.partner_type = 'admin' THEN (SELECT name FROM admin WHERE admin_id = lc.partner_id)
                END as partner_name,
                CASE 
                    WHEN lc.partner_type = 'teacher' THEN (SELECT email FROM teacher WHERE teacher_id = lc.partner_id)
                    WHEN lc.partner_type = 'student' THEN (SELECT email FROM student WHERE student_id = lc.partner_id)
                    WHEN lc.partner_type = 'admin' THEN (SELECT email FROM admin WHERE admin_id = lc.partner_id)
                END as partner_email,
                CASE 
                    WHEN lc.partner_type = 'teacher' THEN (SELECT department FROM teacher WHERE teacher_id = lc.partner_id)
                    WHEN lc.partner_type = 'student' THEN CONCAT('Semester ', (SELECT semester FROM student WHERE student_id = lc.partner_id))
                    WHEN lc.partner_type = 'admin' THEN 'Administration'
                END as partner_department,
                -- Get counts
                (SELECT COUNT(*) 
                 FROM chat_message 
                 WHERE ((sender_id = %s AND sender_type = 'student' AND receiver_id = lc.partner_id AND receiver_type = lc.partner_type)
                     OR (sender_id = lc.partner_id AND sender_type = lc.partner_type AND receiver_id = %s AND receiver_type = 'student'))
                   AND is_read = FALSE
                   AND receiver_id = %s
                   AND receiver_type = 'student') as unread_count,
                (SELECT COUNT(*) 
                 FROM chat_message 
                 WHERE (sender_id = %s AND sender_type = 'student' AND receiver_id = lc.partner_id AND receiver_type = lc.partner_type)
                    OR (sender_id = lc.partner_id AND sender_type = lc.partner_type AND receiver_id = %s AND receiver_type = 'student')) as total_messages
            FROM latest_conversations lc
            WHERE lc.partner_id IS NOT NULL
            ORDER BY lc.last_message_time DESC
        """, (student_id, student_id, student_id, student_id, student_id, student_id, student_id))
        
        conversations_raw = cursor.fetchall()
        conversations = []
        
        for conv in conversations_raw:
            conv_dict = row_to_dict(cursor, conv)
            if conv_dict and conv_dict['partner_name']:
                # Determine if last message has file
                has_file = conv_dict['file_name'] is not None
                
                conversations.append({
                    "partner": {
                        "id": conv_dict['partner_id'],
                        "type": conv_dict['partner_type'],
                        "name": conv_dict['partner_name'],
                        "email": conv_dict['partner_email'],
                        "role": conv_dict['partner_type'].capitalize(),
                        "department": conv_dict['partner_department'] or "Not specified",
                        "avatar": conv_dict['partner_name'][0].upper() if conv_dict['partner_name'] else conv_dict['partner_type'][0].upper()
                    },
                    "last_message": {
                        "id": conv_dict['message_id'],
                        "text": conv_dict['last_message'],
                        "timestamp": conv_dict['last_message_time'].isoformat() if conv_dict['last_message_time'] else None,
                        "is_read": conv_dict['is_read'],
                        "has_file": has_file,
                        "file_info": {
                            "name": conv_dict['file_name'],
                            "size": conv_dict['file_size']
                        } if has_file else None
                    },
                    "unread_count": conv_dict['unread_count'] or 0,
                    "total_messages": conv_dict['total_messages'] or 0
                })
        
        # Get summary counts
        cursor.execute("""
            SELECT 
                COUNT(DISTINCT CONCAT(sender_id, sender_type)) as total_chat_partners,
                COUNT(*) as total_all_messages,
                SUM(CASE WHEN is_read = FALSE AND receiver_id = %s AND receiver_type = 'student' THEN 1 ELSE 0 END) as total_unread
            FROM chat_message 
            WHERE (sender_id = %s AND sender_type = 'student')
               OR (receiver_id = %s AND receiver_type = 'student')
        """, (student_id, student_id, student_id))
        
        summary = cursor.fetchone()
        summary_dict = row_to_dict(cursor, summary)
        
        cursor.close()
        conn.close()
        
        print(f"[OK] Found {len(conversations)} conversations for student {student_name}")
        
        return jsonify({
            "success": True,
            "student": {
                "id": student_id,
                "name": student_name,
                "type": "student"
            },
            "conversations": conversations,
            "summary": {
                "total_conversations": len(conversations),
                "total_chat_partners": summary_dict['total_chat_partners'] if summary_dict else len(conversations),
                "total_messages": summary_dict['total_all_messages'] if summary_dict else sum(c['total_messages'] for c in conversations),
                "total_unread": summary_dict['total_unread'] if summary_dict else sum(c['unread_count'] for c in conversations)
            },
            "timestamp": datetime.now().isoformat()
        })
        
    except Exception as e:
        print(f"[ERROR] Error in get_student_conversations_simple: {e}")
        return jsonify({
            "success": False,
            "error": f"Failed to get student conversations: {str(e)}"
        }), 500