from flask import Blueprint, jsonify, request
from models import VideoCall
import psycopg2
import uuid
import os
from dotenv import load_dotenv

load_dotenv()

video_call_bp = Blueprint('video_call', __name__)


def _call_room(user_id, user_type):
    return f"user_{user_type}_{user_id}"


def _emit_call_event(event_name, payload, user_id, user_type):
    try:
        from app import socketio
        socketio.emit(event_name, payload, room=_call_room(user_id, user_type))
    except Exception as error:
        print(f"Warning: failed to emit {event_name} to {_call_room(user_id, user_type)}: {error}")


def _serialize_call(call, call_type=None):
    if not call:
        return None

    payload = dict(call)
    if call_type:
        payload['call_type'] = call_type
    return payload


# ===== INITIATE VIDEO CALL =====
@video_call_bp.route('/api/video-call/initiate', methods=['POST'])
def initiate_call():
    """Initiate a video call between two users"""
    try:
        data = request.json
        
        initiator_id = data.get('initiator_id')
        initiator_type = data.get('initiator_type')
        receiver_id = data.get('receiver_id')
        receiver_type = data.get('receiver_type')
        call_type = str(data.get('call_type') or 'video').lower()
        
        if not all([initiator_id, initiator_type, receiver_id, receiver_type]):
            return jsonify({
                "success": False,
                "error": "Missing required fields"
            }), 400
        
        # Ensure muted_all column exists (for mute-all feature)
        try:
            conn_check = None
            conn_check = psycopg2.connect(
                host=os.getenv('DB_HOST', 'localhost'),
                database=os.getenv('DB_NAME', 'ClassMate'),
                user=os.getenv('DB_USER', 'postgres'),
                password=os.getenv('DB_PASSWORD', 'Hifza12#'),
                port=os.getenv('DB_PORT', 5432)
            )
            cur_check = conn_check.cursor()
            cur_check.execute("ALTER TABLE video_calls ADD COLUMN IF NOT EXISTS muted_all BOOLEAN DEFAULT FALSE")
            conn_check.commit()
            cur_check.close()
            conn_check.close()
        except Exception:
            pass

        # Generate unique room ID
        room_id = str(uuid.uuid4())
        
        result = VideoCall.create_call(
            initiator_id, initiator_type, receiver_id, receiver_type, room_id
        )
        
        if result:
            call = VideoCall.get_call(result['call_id'])
            call_payload = _serialize_call(call, call_type)
            _emit_call_event('video_call_incoming', call_payload, receiver_id, receiver_type)
            _emit_call_event('video_call_outgoing', call_payload, initiator_id, initiator_type)
            return jsonify({
                "success": True,
                "call_id": result['call_id'],
                "room_id": result['room_id'],
                "call": call_payload,
                "message": "Call initiated successfully"
            }), 201
        else:
            return jsonify({
                "success": False,
                "error": "Failed to initiate call"
            }), 500
            
    except Exception as e:
        print(f"Error initiating call: {e}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


# ===== ACCEPT CALL =====
@video_call_bp.route('/api/video-call/<int:call_id>/accept', methods=['PUT'])
def accept_call(call_id):
    """Accept an incoming video call"""
    try:
        data = request.get_json(silent=True) or {}
        user_id = data.get('user_id')
        user_type = data.get('user_type')
        call_type = str(data.get('call_type') or 'video').lower()
        call = VideoCall.get_call(call_id)

        if not call:
            return jsonify({"success": False, "error": "Call not found"}), 404

        if user_id and user_type and (str(user_id) != str(call['receiver_id']) or str(user_type) != str(call['receiver_type'])):
            return jsonify({"success": False, "error": "Only the invited receiver can accept this call"}), 403

        success = VideoCall.update_call_status(call_id, 'active')
        
        if success:
            call = VideoCall.get_call(call_id)
            call_payload = _serialize_call(call, call_type)
            _emit_call_event('video_call_accepted', call_payload, call['initiator_id'], call['initiator_type'])
            _emit_call_event('video_call_accepted', call_payload, call['receiver_id'], call['receiver_type'])
            return jsonify({
                "success": True,
                "message": "Call accepted",
                "call": call_payload
            }), 200
        else:
            return jsonify({
                "success": False,
                "error": "Failed to accept call"
            }), 500
            
    except Exception as e:
        print(f"Error accepting call: {e}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


# ===== DECLINE CALL =====
@video_call_bp.route('/api/video-call/<int:call_id>/decline', methods=['PUT'])
def decline_call(call_id):
    """Decline an incoming video call"""
    try:
        data = request.get_json(silent=True) or {}
        user_id = data.get('user_id')
        user_type = data.get('user_type')
        call_type = str(data.get('call_type') or 'video').lower()
        call = VideoCall.get_call(call_id)

        if not call:
            return jsonify({"success": False, "error": "Call not found"}), 404

        if user_id and user_type and (str(user_id) != str(call['receiver_id']) or str(user_type) != str(call['receiver_type'])):
            return jsonify({"success": False, "error": "Only the invited receiver can decline this call"}), 403

        success = VideoCall.update_call_status(call_id, 'declined')
        
        if success:
            call_payload = _serialize_call(VideoCall.get_call(call_id), call_type)
            _emit_call_event('video_call_declined', call_payload, call['initiator_id'], call['initiator_type'])
            _emit_call_event('video_call_declined', call_payload, call['receiver_id'], call['receiver_type'])
            return jsonify({
                "success": True,
                "message": "Call declined"
            }), 200
        else:
            return jsonify({
                "success": False,
                "error": "Failed to decline call"
            }), 500
            
    except Exception as e:
        print(f"Error declining call: {e}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


# ===== END CALL =====
@video_call_bp.route('/api/video-call/<int:call_id>/end', methods=['PUT'])
def end_call(call_id):
    """End an active video call"""
    try:
        data = request.get_json(silent=True) or {}
        call_type = str(data.get('call_type') or 'video').lower()
        call = VideoCall.get_call(call_id)

        if not call:
            return jsonify({"success": False, "error": "Call not found"}), 404

        success = VideoCall.update_call_status(call_id, 'ended')
        
        if success:
            call_payload = _serialize_call(VideoCall.get_call(call_id), call_type)
            _emit_call_event('video_call_ended', call_payload, call['initiator_id'], call['initiator_type'])
            _emit_call_event('video_call_ended', call_payload, call['receiver_id'], call['receiver_type'])
            return jsonify({
                "success": True,
                "message": "Call ended",
                "call": call_payload
            }), 200
        else:
            return jsonify({
                "success": False,
                "error": "Failed to end call"
            }), 500
            
    except Exception as e:
        print(f"Error ending call: {e}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


# ===== MUTE ALL PARTICIPANTS =====
@video_call_bp.route('/api/video-call/<int:call_id>/mute-all', methods=['PUT'])
def mute_all(call_id):
    """Set muted_all flag for a call so clients can auto-mute themselves"""
    try:
        import psycopg2
        from dotenv import load_dotenv

        load_dotenv()

        conn = psycopg2.connect(
            host=os.getenv('DB_HOST', 'localhost'),
            database=os.getenv('DB_NAME', 'ClassMate'),
            user=os.getenv('DB_USER', 'postgres'),
            password=os.getenv('DB_PASSWORD', 'Hifza12#'),
            port=os.getenv('DB_PORT', 5432)
        )

        cursor = conn.cursor()
        # Ensure column exists
        try:
            cursor.execute("ALTER TABLE video_calls ADD COLUMN IF NOT EXISTS muted_all BOOLEAN DEFAULT FALSE")
            conn.commit()
        except Exception:
            pass

        cursor.execute("UPDATE video_calls SET muted_all = TRUE WHERE call_id = %s", (call_id,))
        conn.commit()
        cursor.close()
        conn.close()

        return jsonify({"success": True, "message": "All participants muted"}), 200
    except Exception as e:
        print(f"Error muting all: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


# ===== UNMUTE ALL PARTICIPANTS =====
@video_call_bp.route('/api/video-call/<int:call_id>/unmute-all', methods=['PUT'])
def unmute_all(call_id):
    """Clear muted_all flag for a call"""
    try:
        import psycopg2
        from dotenv import load_dotenv

        load_dotenv()

        conn = psycopg2.connect(
            host=os.getenv('DB_HOST', 'localhost'),
            database=os.getenv('DB_NAME', 'ClassMate'),
            user=os.getenv('DB_USER', 'postgres'),
            password=os.getenv('DB_PASSWORD', 'Hifza12#'),
            port=os.getenv('DB_PORT', 5432)
        )

        cursor = conn.cursor()
        cursor.execute("UPDATE video_calls SET muted_all = FALSE WHERE call_id = %s", (call_id,))
        conn.commit()
        cursor.close()
        conn.close()

        return jsonify({"success": True, "message": "Participants unmuted"}), 200
    except Exception as e:
        print(f"Error unmuting all: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


# ===== GET CALL DETAILS =====
@video_call_bp.route('/api/video-call/<int:call_id>', methods=['GET'])
def get_call_details(call_id):
    """Get details of a specific call"""
    try:
        call = VideoCall.get_call(call_id)
        
        if call:
            return jsonify({
                "success": True,
                "call": call
            }), 200
        else:
            return jsonify({
                "success": False,
                "error": "Call not found"
            }), 404
            
    except Exception as e:
        print(f"Error getting call details: {e}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


# ===== GET CALL BY ROOM ID =====
@video_call_bp.route('/api/video-call/room/<room_id>', methods=['GET'])
def get_call_by_room(room_id):
    """Get call details by room ID"""
    try:
        import psycopg2
        from dotenv import load_dotenv
        
        load_dotenv()
        
        conn = psycopg2.connect(
            host=os.getenv('DB_HOST', 'localhost'),
            database=os.getenv('DB_NAME', 'ClassMate'),
            user=os.getenv('DB_USER', 'postgres'),
            password=os.getenv('DB_PASSWORD', 'Hifza12#'),
            port=os.getenv('DB_PORT', 5432)
        )
        
        cursor = conn.cursor()
        # Ensure muted_all column exists and include it in the select
        try:
            cursor.execute("ALTER TABLE video_calls ADD COLUMN IF NOT EXISTS muted_all BOOLEAN DEFAULT FALSE")
            conn.commit()
        except Exception:
            pass

        cursor.execute("""
            SELECT call_id, initiator_id, initiator_type, receiver_id, receiver_type,
                   status, started_at, ended_at, duration_seconds, created_at, room_id, muted_all
            FROM video_calls
            WHERE room_id = %s
        """, (room_id,))
        
        result = cursor.fetchone()
        cursor.close()
        conn.close()
        
        if result:
            call = {
                'call_id': result[0],
                'initiator_id': result[1],
                'initiator_type': result[2],
                'receiver_id': result[3],
                'receiver_type': result[4],
                'status': result[5],
                'started_at': result[6].isoformat() if result[6] else None,
                'ended_at': result[7].isoformat() if result[7] else None,
                'duration_seconds': result[8],
                'created_at': result[9].isoformat() if result[9] else None,
                'room_id': result[10],
                'muted_all': bool(result[11]) if result[11] is not None else False
            }
            return jsonify({
                "success": True,
                "call": call
            }), 200
        else:
            return jsonify({
                "success": False,
                "error": "Call not found"
            }), 404
            
    except Exception as e:
        print(f"Error getting call by room ID: {e}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


# ===== GET PENDING CALLS FOR USER =====
@video_call_bp.route('/api/video-call/pending/<user_id>/<user_type>', methods=['GET'])
def get_pending_calls(user_id, user_type):
    """Get all pending incoming calls for a user"""
    try:
        import psycopg2
        from dotenv import load_dotenv
        
        load_dotenv()
        
        conn = psycopg2.connect(
            host=os.getenv('DB_HOST', 'localhost'),
            database=os.getenv('DB_NAME', 'ClassMate'),
            user=os.getenv('DB_USER', 'postgres'),
            password=os.getenv('DB_PASSWORD', 'Hifza12#'),
            port=os.getenv('DB_PORT', 5432)
        )
        
        cursor = conn.cursor()
        # Ensure muted_all exists
        try:
            cursor.execute("ALTER TABLE video_calls ADD COLUMN IF NOT EXISTS muted_all BOOLEAN DEFAULT FALSE")
            conn.commit()
        except Exception:
            pass

        cursor.execute("""
            SELECT call_id, initiator_id, initiator_type, receiver_id, receiver_type,
                   status, started_at, ended_at, duration_seconds, created_at, room_id, muted_all
            FROM video_calls
            WHERE receiver_id = %s AND receiver_type = %s AND status = 'pending'
            ORDER BY created_at DESC
        """, (user_id, user_type))
        
        results = cursor.fetchall()
        calls = []
        
        for result in results:
            call = {
                'call_id': result[0],
                'initiator_id': result[1],
                'initiator_type': result[2],
                'receiver_id': result[3],
                'receiver_type': result[4],
                'status': result[5],
                'started_at': result[6].isoformat() if result[6] else None,
                'ended_at': result[7].isoformat() if result[7] else None,
                'duration_seconds': result[8],
                'created_at': result[9].isoformat() if result[9] else None,
                'room_id': result[10],
                'muted_all': bool(result[11]) if result[11] is not None else False
            }
            calls.append(call)
        
        cursor.close()
        conn.close()
        
        return jsonify({
            "success": True,
            "calls": calls,
            "count": len(calls)
        }), 200
        
    except Exception as e:
        print(f"Error getting pending calls: {e}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


# ===== GET CALL HISTORY =====
@video_call_bp.route('/api/video-call/history/<user_id>/<user_type>', methods=['GET'])
def get_call_history(user_id, user_type):
    """Get call history for a user"""
    try:
        import psycopg2
        from dotenv import load_dotenv
        
        load_dotenv()
        
        conn = psycopg2.connect(
            host=os.getenv('DB_HOST', 'localhost'),
            database=os.getenv('DB_NAME', 'ClassMate'),
            user=os.getenv('DB_USER', 'postgres'),
            password=os.getenv('DB_PASSWORD', 'Hifza12#'),
            port=os.getenv('DB_PORT', 5432)
        )
        
        cursor = conn.cursor()
        limit = request.args.get('limit', 50, type=int)
        
        cursor.execute("""
            SELECT call_id, initiator_id, initiator_type, receiver_id, receiver_type,
                   status, started_at, ended_at, duration_seconds, created_at, room_id
            FROM video_calls
            WHERE (initiator_id = %s AND initiator_type = %s) 
               OR (receiver_id = %s AND receiver_type = %s)
            ORDER BY created_at DESC
            LIMIT %s
        """, (user_id, user_type, user_id, user_type, limit))
        
        results = cursor.fetchall()
        calls = []
        
        for result in results:
            call = {
                'call_id': result[0],
                'initiator_id': result[1],
                'initiator_type': result[2],
                'receiver_id': result[3],
                'receiver_type': result[4],
                'status': result[5],
                'started_at': result[6].isoformat() if result[6] else None,
                'ended_at': result[7].isoformat() if result[7] else None,
                'duration_seconds': result[8],
                'created_at': result[9].isoformat() if result[9] else None,
                'room_id': result[10]
            }
            calls.append(call)
        
        cursor.close()
        conn.close()
        
        return jsonify({
            "success": True,
            "calls": calls,
            "count": len(calls)
        }), 200
        
    except Exception as e:
        print(f"Error getting call history: {e}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500