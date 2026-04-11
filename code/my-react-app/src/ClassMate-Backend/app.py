from db import getDbConnection
from flask import Flask, send_from_directory, request, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room, leave_room
import os
import sys
import logging
import traceback
import importlib
from datetime import date, timedelta
from models import create_tables
from dotenv import load_dotenv

# Load environment variables from .env file (development only)
load_dotenv()

logging.basicConfig(stream=sys.stdout, level=logging.DEBUG)
print('Starting app.py...', flush=True)
print(f"Python executable: {sys.executable}", flush=True)
print(f"PORT={os.environ.get('PORT', '5000')}", flush=True)
print(f"LIVEKIT_API_KEY set={bool(os.environ.get('LIVEKIT_API_KEY'))}", flush=True)
print(f"LIVEKIT_API_SECRET set={bool(os.environ.get('LIVEKIT_API_SECRET'))}", flush=True)
print(f"LIVEKIT_URL set={bool(os.environ.get('LIVEKIT_URL'))}", flush=True)

app = Flask(__name__)

# CORS Configuration - Support both hardcoded (dev) and environment-based (prod) URLs
ALLOWED_ORIGINS = [
    "http://localhost:5173",  # Local development
    "http://localhost:3000",  # Alternative local dev
]

# Add production Vercel URLs from environment or defaults
VERCEL_URL = os.environ.get('VERCEL_DEPLOYMENT_URL', '').strip()
if VERCEL_URL:
    ALLOWED_ORIGINS.append(f"https://{VERCEL_URL}")
    ALLOWED_ORIGINS.append(f"https://www.{VERCEL_URL}")

# Add specific production domain
PROD_FRONTEND = os.environ.get('FRONTEND_URL', 'https://classmate-virtual-classroom-and-meeting-platform.vercel.app')
if PROD_FRONTEND and PROD_FRONTEND not in ALLOWED_ORIGINS:
    ALLOWED_ORIGINS.append(PROD_FRONTEND)

# Allow wildcard in development only (NOT recommended for production)
IS_PRODUCTION = os.environ.get('ENVIRONMENT', 'development') == 'production'
CORS_ORIGINS = ALLOWED_ORIGINS if IS_PRODUCTION else ["*"]

print(f"🌐 CORS Origins: {CORS_ORIGINS}")

CORS(app, resources={ 
    r"/api/*": {
        "origins": CORS_ORIGINS
    },
    r"/socket.io/*": {
        "origins": CORS_ORIGINS
    }
}, supports_credentials=True)

socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

app.config['UPLOAD_FOLDER'] = 'uploads/profile_images'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024

# Create database tables on startup
try:
    create_tables()
except Exception as e:
    print(f"Warning: Could not create tables: {e}")

# Import blueprints
from auth_routes import auth_bp
from loginRoutes import login_bp
from forgotRoutes import forgot_bp
from teacherRoutes import teacher_bp
from chatRoutes import chat_bp
from liveChat import live_chat_bp
from videoCall import video_call_bp
from courseRoutes import course_bp
from materialRoutes import material_bp
from uploadMaterialRoutes import upload_bp
from studentRoutes import student_bp
from attendanceRoutes import attendance_bp
from adminRoutes import admin_bp
from transcriptionRoutes import transcription_bp

# Register blueprints
app.register_blueprint(auth_bp)
app.register_blueprint(login_bp)
app.register_blueprint(forgot_bp)
app.register_blueprint(teacher_bp)
app.register_blueprint(chat_bp)
app.register_blueprint(live_chat_bp)
app.register_blueprint(video_call_bp)
app.register_blueprint(course_bp)
app.register_blueprint(material_bp)
app.register_blueprint(upload_bp)
app.register_blueprint(student_bp)
app.register_blueprint(attendance_bp)
app.register_blueprint(admin_bp)
app.register_blueprint(transcription_bp, url_prefix='/api')

@app.route('/api/livekit/token', methods=['POST', 'OPTIONS'])
def get_livekit_token():
    if request.method == 'OPTIONS':
        return ('', 200)

    try:
        import base64
        import json
        from livekit.api import AccessToken, VideoGrants

        data = request.get_json(silent=True) or {}
        room_name = data.get('roomName')
        participant_name = data.get('participantName')
        user_type = str(data.get('userType') or 'student').lower()

        if not room_name or not participant_name:
            return jsonify({
                'success': False,
                'error': 'Missing required fields: roomName and participantName'
            }), 400
        
        # Get LiveKit credentials from environment variables
        api_key = os.environ.get('LIVEKIT_API_KEY')
        api_secret = os.environ.get('LIVEKIT_API_SECRET')
        livekit_url = os.environ.get('LIVEKIT_URL')
        
        # Validate credentials
        if not api_key or not api_secret:
            return jsonify({
                'success': False,
                'error': 'LiveKit not configured'
            }), 500
        
        if not livekit_url:
            livekit_url = "wss://your-project.livekit.cloud"

        print(f"[LiveKit] Token requested for: {participant_name} (type: {user_type})", flush=True)
        print(f"[LiveKit] Room name for {participant_name}: {room_name}", flush=True)
        if user_type == 'student':
            print(f"[LiveKit] Student token requested for: {participant_name} (type: {user_type})", flush=True)

        # Build token with explicit room permissions to avoid 401 unauthorized on join.
        token_builder = AccessToken(api_key, api_secret)
        token_builder = token_builder.with_identity(participant_name)
        token_builder = token_builder.with_name(participant_name)
        token_builder = token_builder.with_ttl(timedelta(seconds=3600))
        token_builder = token_builder.with_metadata(json.dumps({'room': room_name}))
        token_builder = token_builder.with_grants(VideoGrants(
            room_join=True,
            room=room_name,
            can_publish=True,
            can_subscribe=True,
            can_publish_data=True,
        ))

        jwt_token = token_builder.to_jwt()

        # Decode JWT payload (without verification) to inspect granted permissions in logs.
        payload_segment = jwt_token.split('.')[1]
        payload_segment += '=' * (-len(payload_segment) % 4)
        decoded_payload = json.loads(base64.urlsafe_b64decode(payload_segment).decode('utf-8'))

        print("[LiveKit] Token created successfully", flush=True)
        print(f"[LiveKit] Token payload: {decoded_payload}", flush=True)
        
        return jsonify({
            'success': True,
            'token': jwt_token,
            'url': livekit_url
        })
        
    except Exception as e:
        print(f"Error: {e}")
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/debug/livekit', methods=['GET'])
def debug_livekit():
    """Debug endpoint to inspect LiveKit module"""
    try:
        import livekit
        import livekit.api
        from livekit.api import AccessToken

        # Create a test token to inspect its attributes and methods.
        test_token = AccessToken('test_key', 'test_secret')

        return jsonify({
            'livekit_version': getattr(livekit, '__version__', 'unknown'),
            'livekit_api_dir': [x for x in dir(livekit.api) if not x.startswith('_')],
            'access_token_methods': [x for x in dir(AccessToken) if not x.startswith('_')],
            'token_instance_methods': [x for x in dir(test_token) if not x.startswith('_')],
            'has_identity': hasattr(test_token, 'identity'),
            'has_ttl': hasattr(test_token, 'ttl'),
            'has_metadata': hasattr(test_token, 'metadata'),
        })
    except Exception as e:
        print(f"[DEBUG] Error in /api/debug/livekit: {e}", flush=True)
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/livekit/status', methods=['GET'])
def livekit_status():
    """Check LiveKit configuration status"""
    api_key = os.environ.get('LIVEKIT_API_KEY')
    api_secret = os.environ.get('LIVEKIT_API_SECRET')
    livekit_url = os.environ.get('LIVEKIT_URL')
    
    return jsonify({
        'configured': bool(api_key and api_secret),
        'url_configured': bool(livekit_url),
        'url': livekit_url if livekit_url else None,
        'message': 'LiveKit is configured' if (api_key and api_secret) else 'LiveKit credentials missing'
    })


@app.route('/api/livekit/token-test', methods=['GET'])
def livekit_token_test():
    """Quick diagnostics endpoint for LiveKit token prerequisites (no token issued)."""
    room_name = request.args.get('room', 'test-room')
    participant_name = request.args.get('participant', 'test-user')
    api_key = os.environ.get('LIVEKIT_API_KEY')
    api_secret = os.environ.get('LIVEKIT_API_SECRET')
    livekit_url = os.environ.get('LIVEKIT_URL')

    return jsonify({
        'success': True,
        'received': {
            'roomName': room_name,
            'participantName': participant_name
        },
        'configured': {
            'LIVEKIT_API_KEY': bool(api_key),
            'LIVEKIT_API_SECRET': bool(api_secret),
            'LIVEKIT_URL': bool(livekit_url)
        },
        'livekit_url': livekit_url if livekit_url else None
    }), 200


def _rows_to_dicts(cursor, rows):
    columns = [desc[0] for desc in cursor.description]
    return [dict(zip(columns, row)) for row in rows], columns


@app.route('/api/debug/all-sessions', methods=['GET'])
def debug_all_sessions():
    """Debug endpoint to see all sessions in database"""
    conn = None
    cursor = None
    try:
        conn = getDbConnection()
        if not conn:
            return jsonify({'success': False, 'error': 'Database connection failed'}), 500

        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, session_name, teacher_id, scheduled_date, status, created_at
            FROM sessions
            ORDER BY created_at DESC
            LIMIT 20
        """)

        sessions = cursor.fetchall()
        result, columns = _rows_to_dicts(cursor, sessions)

        return jsonify({
            'success': True,
            'count': len(result),
            'sessions': result,
            'columns': columns
        })

    except Exception as e:
        print(f"[DEBUG] Error in /api/debug/all-sessions: {e}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@app.route('/api/debug/teacher-sessions/<teacher_id>', methods=['GET'])
def debug_teacher_sessions(teacher_id):
    """Debug endpoint to see all sessions for a teacher"""
    conn = None
    cursor = None
    try:
        conn = getDbConnection()
        if not conn:
            return jsonify({'success': False, 'error': 'Database connection failed'}), 500

        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, session_name, teacher_id, scheduled_date, status,
                   to_char(scheduled_date, 'YYYY-MM-DD') as date_only
            FROM sessions
            WHERE teacher_id = %s
            ORDER BY scheduled_date DESC
        """, (teacher_id,))

        sessions = cursor.fetchall()
        result, _columns = _rows_to_dicts(cursor, sessions)

        return jsonify({
            'success': True,
            'teacher_id': teacher_id,
            'count': len(result),
            'sessions': result
        })

    except Exception as e:
        print(f"[DEBUG] Error in /api/debug/teacher-sessions/{teacher_id}: {e}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@app.route('/api/debug/create-test-session', methods=['POST'])
def create_test_session():
    """Create a test session for today"""
    conn = None
    cursor = None
    try:
        conn = getDbConnection()
        if not conn:
            return jsonify({'success': False, 'error': 'Database connection failed'}), 500

        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO sessions (session_name, teacher_id, scheduled_date, status, created_at)
            VALUES (%s, %s, %s, %s, NOW())
            RETURNING id
        """, ('Test Session Today', 'TCH20260126155703319', date.today(), 'scheduled'))

        session_id = cursor.fetchone()[0]
        conn.commit()

        return jsonify({
            'success': True,
            'message': 'Test session created',
            'session_id': session_id,
            'date': str(date.today())
        })

    except Exception as e:
        print(f"[DEBUG] Error in /api/debug/create-test-session: {e}")
        traceback.print_exc()
        if conn:
            conn.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

@app.route('/uploads/profile_images/<filename>')
def serve_profile_image(filename):
    return send_from_directory('uploads/profile_images', filename)

# Create uploads directory if it doesn't exist
if not os.path.exists('uploads/profile_images'):
    os.makedirs('uploads/profile_images')

# ===== HEALTH CHECK AND DEBUG ENDPOINTS =====

@app.route('/health', methods=['GET'])
def health_check():
    return {'status': 'healthy', 'message': 'ClassMate backend is running'}, 200

@app.route('/', methods=['GET'])
def home():
    return {'message': 'ClassMate API is running', 'status': 'online'}, 200

@app.route('/debug/db-status', methods=['GET'])
def db_status():
    from db import getDbConnection
    try:
        conn = getDbConnection()
        if conn:
            return {'status': 'connected', 'message': 'Database connection successful'}
        else:
            return {'status': 'failed', 'message': 'Database connection returned None'}
    except Exception as e:
        return {'status': 'error', 'message': str(e)}

# ===== SOCKETIO EVENTS FOR REAL-TIME CHAT =====

@socketio.on('connect')
def handle_connect():
    """Handle client connection"""
    print(f'Client connected: {request.sid}')
    emit('connect_response', {'data': 'Connected to server'})

@socketio.on('disconnect')
def handle_disconnect():
    """Handle client disconnection"""
    print(f'Client disconnected: {request.sid}')

@socketio.on('join_chat_room')
def on_join_chat_room(data):
    """Join a chat room (1-to-1 conversation)"""
    user_id = data.get('user_id')
    other_user_id = data.get('other_user_id')
    
    # Create a unique room ID for the conversation
    room_id = f"chat_{min(user_id, other_user_id)}_{max(user_id, other_user_id)}"
    
    join_room(room_id)
    print(f'User {user_id} joined room {room_id}')
    emit('room_joined', {'room_id': room_id, 'status': 'success'})

@socketio.on('send_message')
def on_send_message(data):
    """Receive and broadcast message"""
    room_id = data.get('room_id')
    message = data.get('message')
    sender_id = data.get('sender_id')
    timestamp = data.get('timestamp')
    
    # Broadcast message to all users in the room
    emit('new_message', {
        'message': message,
        'sender_id': sender_id,
        'timestamp': timestamp
    }, room=room_id)
    
    print(f'Message from {sender_id} in room {room_id}: {message}')

@socketio.on('typing')
def on_typing(data):
    """Notify others that user is typing"""
    room_id = data.get('room_id')
    user_id = data.get('user_id')
    
    emit('user_typing', {'user_id': user_id}, room=room_id, skip_sid=request.sid)

@socketio.on('stop_typing')
def on_stop_typing(data):
    """Notify others that user stopped typing"""
    room_id = data.get('room_id')
    user_id = data.get('user_id')
    
    emit('user_stopped_typing', {'user_id': user_id}, room=room_id, skip_sid=request.sid)

# ===== SOCKETIO EVENTS FOR VIDEO CALLS =====

@socketio.on('join_video_call')
def on_join_video_call(data):
    """Join a video call room"""
    call_id = data.get('call_id')
    room_id = data.get('room_id')
    user_id = data.get('user_id')
    user_type = data.get('user_type')
    
    join_room(room_id)
    print(f'User {user_id} ({user_type}) joined video call room {room_id}')
    
    emit('user_joined', {
        'user_id': user_id,
        'user_type': user_type,
        'call_id': call_id
    }, room=room_id, skip_sid=request.sid)

@socketio.on('offer')
def on_offer(data):
    """Handle WebRTC offer"""
    room_id = data.get('room_id')
    offer = data.get('offer')
    
    emit('offer', {'offer': offer}, room=room_id, skip_sid=request.sid)

@socketio.on('answer')
def on_answer(data):
    """Handle WebRTC answer"""
    room_id = data.get('room_id')
    answer = data.get('answer')
    
    emit('answer', {'answer': answer}, room=room_id, skip_sid=request.sid)

@socketio.on('ice_candidate')
def on_ice_candidate(data):
    """Handle ICE candidates"""
    room_id = data.get('room_id')
    candidate = data.get('candidate')
    
    emit('ice_candidate', {'candidate': candidate}, room=room_id, skip_sid=request.sid)

@socketio.on('leave_video_call')
def on_leave_video_call(data):
    """Leave a video call room"""
    room_id = data.get('room_id')
    user_id = data.get('user_id')
    
    leave_room(room_id)
    print(f'User {user_id} left video call room {room_id}')
    
    emit('user_left', {'user_id': user_id}, room=room_id)

# Health check endpoint for Railway deployments
@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint for monitoring and load balancers"""
    try:
        # Try to get a database connection to ensure DB is up
        conn = getDbConnection()
        if conn:
            conn.close()
            return jsonify({
                'status': 'healthy',
                'database': 'connected',
                'environment': os.environ.get('ENVIRONMENT', 'development')
            }), 200
        else:
            return jsonify({
                'status': 'degraded',
                'database': 'disconnected',
                'environment': os.environ.get('ENVIRONMENT', 'development')
            }), 503
    except Exception as e:
        print(f"Health check failed: {e}")
        return jsonify({
            'status': 'unhealthy',
            'error': str(e)
        }), 503

@app.route('/', methods=['GET'])
def root():
    """Root endpoint"""
    return jsonify({
        'message': 'ClassMate Backend API',
        'version': '1.0.0',
        'status': 'running',
        'endpoints': ['/api/*', '/health', '/socket.io']
    }), 200

if __name__ == '__main__':
    # Get port from environment variable or use default
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('ENVIRONMENT', 'development') != 'production'
    
    print(f"🚀 Starting ClassMate Backend")
    print(f"   Port: {port}")
    print(f"   Debug: {debug}")
    print(f"   Environment: {os.environ.get('ENVIRONMENT', 'development')}")
    
    socketio.run(app, debug=debug, port=port, host='0.0.0.0')