from db import getDbConnection
from flask import Flask, send_from_directory, request
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room, leave_room
import os
from models import create_tables

app = Flask(__name__)
CORS(app, resources={ 
    r"/api/*": {
        "origins": ["https://your-vercel-app.vercel.app", "http://localhost:5173", "*"]
    },
    r"/socket.io/*": {
        "origins": ["https://your-vercel-app.vercel.app", "http://localhost:5173", "*"]
    }
}, supports_credentials=True)

socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

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

if __name__ == '__main__':
    socketio.run(app, debug=True, port=5000, host='0.0.0.0')