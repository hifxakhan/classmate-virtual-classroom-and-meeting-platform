from flask import Blueprint, jsonify, request
from models import Message
from datetime import datetime
import psycopg2
import os
from dotenv import load_dotenv

load_dotenv()

live_chat_bp = Blueprint('live_chat', __name__)

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


# ===== GET CONVERSATION =====
@live_chat_bp.route('/api/chat/messages/<user_id>/<user_type>/<other_user_id>/<other_user_type>', methods=['GET'])
def get_messages(user_id, user_type, other_user_id, other_user_type):
    """Get all messages between two users"""
    try:
        limit = request.args.get('limit', 50, type=int)
        offset = request.args.get('offset', 0, type=int)
        
        messages = Message.get_conversation(
            user_id, user_type, other_user_id, other_user_type, limit, offset
        )
        
        return jsonify({
            "success": True,
            "messages": messages,
            "count": len(messages)
        }), 200
        
    except Exception as e:
        print(f"Error getting messages: {e}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


# ===== SEND MESSAGE =====
@live_chat_bp.route('/api/chat/send', methods=['POST'])
def send_message():
    """Send a message from one user to another"""
    try:
        data = request.json
        
        sender_id = data.get('sender_id')
        sender_type = data.get('sender_type')
        receiver_id = data.get('receiver_id')
        receiver_type = data.get('receiver_type')
        content = data.get('content')
        message_type = data.get('message_type', 'text')
        file_url = data.get('file_url')
        file_name = data.get('file_name')
        
        if not all([sender_id, sender_type, receiver_id, receiver_type, content]):
            return jsonify({
                "success": False,
                "error": "Missing required fields"
            }), 400
        
        result = Message.save_message(
            sender_id, sender_type, receiver_id, receiver_type, 
            content, message_type, file_url, file_name
        )
        
        if result:
            return jsonify({
                "success": True,
                "message_id": result['message_id'],
                "created_at": result['created_at'].isoformat() if isinstance(result['created_at'], datetime) else result['created_at']
            }), 201
        else:
            return jsonify({
                "success": False,
                "error": "Failed to save message"
            }), 500
            
    except Exception as e:
        print(f"Error sending message: {e}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


# ===== MARK MESSAGE AS READ =====
@live_chat_bp.route('/api/chat/mark-read/<int:message_id>', methods=['PUT'])
def mark_read(message_id):
    """Mark a message as read"""
    try:
        success = Message.mark_as_read(message_id)
        
        if success:
            return jsonify({
                "success": True,
                "message": "Message marked as read"
            }), 200
        else:
            return jsonify({
                "success": False,
                "error": "Failed to mark message as read"
            }), 500
            
    except Exception as e:
        print(f"Error marking message as read: {e}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


# ===== GET UNREAD COUNT =====
@live_chat_bp.route('/api/chat/unread-count/<user_id>/<user_type>', methods=['GET'])
def get_unread_count(user_id, user_type):
    """Get count of unread messages for a user"""
    try:
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        cursor.execute("""
            SELECT COUNT(*) FROM messages
            WHERE receiver_id = %s AND receiver_type = %s AND is_read = FALSE
        """, (user_id, user_type))
        
        count = cursor.fetchone()[0]
        cursor.close()
        conn.close()
        
        return jsonify({
            "success": True,
            "unread_count": count
        }), 200
        
    except Exception as e:
        print(f"Error getting unread count: {e}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


# ===== GET ALL CONVERSATIONS (RECENT) =====
@live_chat_bp.route('/api/chat/conversations/<user_id>/<user_type>', methods=['GET'])
def get_conversations(user_id, user_type):
    """Get all recent conversations for a user"""
    try:
        conn = getDbConnection()
        if not conn:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
        
        cursor = conn.cursor()
        
        # Get unique conversations with last message
        cursor.execute("""
            SELECT DISTINCT
                CASE 
                    WHEN sender_id = %s THEN receiver_id
                    ELSE sender_id
                END as other_user_id,
                CASE 
                    WHEN sender_id = %s THEN receiver_type
                    ELSE sender_type
                END as other_user_type,
                MAX(created_at) as last_message_at,
                (SELECT content FROM messages m2 WHERE 
                    (m2.sender_id = messages.sender_id AND m2.receiver_id = messages.receiver_id)
                    OR (m2.sender_id = messages.receiver_id AND m2.receiver_id = messages.sender_id)
                    ORDER BY m2.created_at DESC LIMIT 1) as last_message,
                COUNT(CASE WHEN is_read = FALSE AND receiver_id = %s THEN 1 END) as unread_count
            FROM messages
            WHERE sender_id = %s OR receiver_id = %s
            GROUP BY other_user_id, other_user_type
            ORDER BY last_message_at DESC
            LIMIT 50
        """, (user_id, user_id, user_id, user_id, user_id))
        
        conversations = cursor.fetchall()
        result = []
        
        for conv in conversations:
            result.append({
                "other_user_id": conv[0],
                "other_user_type": conv[1],
                "last_message_at": conv[2].isoformat() if conv[2] else None,
                "last_message": conv[3],
                "unread_count": conv[4]
            })
        
        cursor.close()
        conn.close()
        
        return jsonify({
            "success": True,
            "conversations": result
        }), 200
        
    except Exception as e:
        print(f"Error getting conversations: {e}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500