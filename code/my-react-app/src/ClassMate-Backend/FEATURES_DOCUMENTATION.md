# ClassMate - Live Chat & Video Call Features Documentation

## Overview
This document explains the implementation of **Live Chat** and **Live Video Call** features for the ClassMate Virtual Classroom platform.

---

## Features Added

### 1. **Live Chat Between Teacher and Student**
- Real-time messaging between teachers and students
- Message history stored in database
- Read receipts (✓ for sent, ✓✓ for read)
- Message polling for real-time updates
- Support for multiple conversations

### 2. **Live Video Call**
- Peer-to-peer video calls using WebRTC
- Call initiating, accepting, and declining
- Call duration tracking
- Audio and video toggle controls
- Incoming call notifications
- Call history

### 3. **Database Models**
- `messages` table: Stores all messages
- `video_calls` table: Stores call information
- `call_participants` table: Stores participants in group calls
- `message_threads` table: Organizes conversations

---

## Installation & Setup

### Backend Setup

1. **Install Python Dependencies**
```bash
cd src/ClassMate-Backend
pip install -r requirements.txt
```

The following packages have been added:
- `Flask-SocketIO==5.3.4` - Real-time communication
- `python-socketio==5.9.0` - Socket.io server support
- `python-engineio==4.7.1` - Engine.io support

2. **Create Database Tables**
```bash
python models.py
```

This will automatically create all required tables:
- `messages`
- `video_calls`
- `call_participants`
- `message_threads`

3. **Start the Backend Server**
```bash
python app.py
```

The server will run on `http://localhost:5000` with SocketIO enabled.

### Frontend Setup

1. **Install Node Dependencies**
```bash
npm install
```

New packages added to `package.json`:
- `socket.io-client^4.5.4` - Real-time client communication
- `simple-peer^9.11.1` - WebRTC simplification (optional, for advanced features)

2. **Start the Development Server**
```bash
npm run dev
```

---

## File Structure

### Backend Files Created
```
ClassMate-Backend/
├── models.py              # Database models and operations
├── liveChat.py            # Chat API routes
├── videoCall.py           # Video call API routes
├── app.py                 # Updated with SocketIO and new routes
└── requirements.txt       # Updated with new dependencies
```

### Frontend Files Created
```
src/
├── liveChat.jsx           # Chat UI component
├── liveChat.css           # Chat styling
├── videoCall.jsx          # Video call UI component
└── videoCall.css          # Video call styling
```

---

## API Endpoints

### Chat Endpoints

#### 1. Get Messages Between Two Users
```
GET /api/chat/messages/<user_id>/<user_type>/<other_user_id>/<other_user_type>?limit=50&offset=0
```
**Response:**
```json
{
  "success": true,
  "messages": [
    {
      "message_id": 1,
      "sender_id": "user1",
      "sender_type": "teacher",
      "receiver_id": "user2",
      "receiver_type": "student",
      "content": "Hello!",
      "created_at": "2026-01-28T10:30:00",
      "is_read": true,
      "message_type": "text"
    }
  ],
  "count": 1
}
```

#### 2. Send a Message
```
POST /api/chat/send
```
**Body:**
```json
{
  "sender_id": "user1",
  "sender_type": "teacher",
  "receiver_id": "user2",
  "receiver_type": "student",
  "content": "Hello student!",
  "message_type": "text",
  "file_url": null,
  "file_name": null
}
```

#### 3. Mark Message as Read
```
PUT /api/chat/mark-read/<message_id>
```

#### 4. Get Unread Count
```
GET /api/chat/unread-count/<user_id>/<user_type>
```

#### 5. Get All Conversations
```
GET /api/chat/conversations/<user_id>/<user_type>
```

---

### Video Call Endpoints

#### 1. Initiate a Video Call
```
POST /api/video-call/initiate
```
**Body:**
```json
{
  "initiator_id": "teacher1",
  "initiator_type": "teacher",
  "receiver_id": "student1",
  "receiver_type": "student"
}
```
**Response:**
```json
{
  "success": true,
  "call_id": 1,
  "room_id": "uuid-string",
  "message": "Call initiated successfully"
}
```

#### 2. Accept a Call
```
PUT /api/video-call/<call_id>/accept
```

#### 3. Decline a Call
```
PUT /api/video-call/<call_id>/decline
```

#### 4. End a Call
```
PUT /api/video-call/<call_id>/end
```

#### 5. Get Call Details
```
GET /api/video-call/<call_id>
```

#### 6. Get Pending Calls
```
GET /api/video-call/pending/<user_id>/<user_type>
```

#### 7. Get Call History
```
GET /api/video-call/history/<user_id>/<user_type>?limit=50
```

---

## Socket.io Events

### Chat Events

```javascript
// Client joins a chat room
socket.emit('join_chat_room', {
  user_id: 'user1',
  other_user_id: 'user2'
});

// Send a message
socket.emit('send_message', {
  room_id: 'chat_user1_user2',
  message: 'Hello!',
  sender_id: 'user1',
  timestamp: new Date().toISOString()
});

// Notify typing
socket.emit('typing', {
  room_id: 'chat_user1_user2',
  user_id: 'user1'
});

// Listen for new messages
socket.on('new_message', (data) => {
  console.log(data.message);
});

// Listen for typing indicator
socket.on('user_typing', (data) => {
  console.log(data.user_id + ' is typing');
});
```

### Video Call Events

```javascript
// Join video call room
socket.emit('join_video_call', {
  call_id: 1,
  room_id: 'room-uuid',
  user_id: 'user1',
  user_type: 'teacher'
});

// Send WebRTC offer
socket.emit('offer', {
  room_id: 'room-uuid',
  offer: sdpOffer
});

// Send WebRTC answer
socket.emit('answer', {
  room_id: 'room-uuid',
  answer: sdpAnswer
});

// Send ICE candidate
socket.emit('ice_candidate', {
  room_id: 'room-uuid',
  candidate: iceCandidate
});

// Leave video call
socket.emit('leave_video_call', {
  room_id: 'room-uuid',
  user_id: 'user1'
});
```

---

## React Component Usage

### Chat Component
```jsx
import LiveChat from './liveChat';

<LiveChat 
  currentUserId="teacher1"
  currentUserType="teacher"
  otherUserId="student1"
  otherUserType="student"
  otherUserName="John Doe"
/>
```

### Video Call Component
```jsx
import VideoCall from './videoCall';

<VideoCall 
  currentUserId="teacher1"
  currentUserType="teacher"
  otherUserId="student1"
  otherUserType="student"
  otherUserName="John Doe"
  onCallEnd={() => console.log('Call ended')}
/>
```

---

## Database Schema

### messages table
```sql
CREATE TABLE messages (
  message_id SERIAL PRIMARY KEY,
  sender_id VARCHAR(255) NOT NULL,
  sender_type VARCHAR(50) NOT NULL,
  receiver_id VARCHAR(255) NOT NULL,
  receiver_type VARCHAR(50) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMP,
  message_type VARCHAR(50) DEFAULT 'text',
  file_url TEXT,
  file_name VARCHAR(255)
);
```

### video_calls table
```sql
CREATE TABLE video_calls (
  call_id SERIAL PRIMARY KEY,
  initiator_id VARCHAR(255) NOT NULL,
  initiator_type VARCHAR(50) NOT NULL,
  receiver_id VARCHAR(255) NOT NULL,
  receiver_type VARCHAR(50) NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  duration_seconds INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  room_id VARCHAR(255) UNIQUE,
  is_group_call BOOLEAN DEFAULT FALSE
);
```

---

## Features Breakdown

### Live Chat Features
✅ Real-time message sending and receiving  
✅ Message history persistence  
✅ Read receipts (single and double checkmarks)  
✅ Typing indicators (Socket.io ready)  
✅ User search functionality  
✅ Conversation list with last message preview  
✅ Unread message count  
✅ Message auto-refresh (polling every 1 second)  
✅ Beautiful gradient UI with animations  
✅ Mobile responsive design  

### Video Call Features
✅ Peer-to-peer WebRTC connection  
✅ Call initiation, acceptance, and decline  
✅ Audio and video toggle controls  
✅ Call duration tracking  
✅ Incoming call notifications  
✅ Call history  
✅ ICE candidate handling  
✅ Automatic media access  
✅ Call status tracking (pending, active, ended, declined)  
✅ Responsive video layouts  
✅ Beautiful UI with gradient backgrounds  

---

## How to Test

### Test Live Chat
1. Open two browser windows
2. Log in as teacher in one and student in another
3. Navigate to the chat component
4. Start typing and sending messages
5. Verify messages appear in real-time
6. Check message read receipts

### Test Video Call
1. Open two browser windows (or devices on same network)
2. Log in as teacher in one and student in another
3. Click "Call" button to initiate
4. In the other window, accept the call
5. Grant camera/microphone permissions
6. Verify video and audio transmission
7. Test mute/unmute and camera toggle
8. End call and check duration

---

## Configuration

### Environment Variables
Make sure your `.env` file contains:
```
DB_HOST=localhost
DB_NAME=ClassMate
DB_USER=postgres
DB_PASSWORD=Hifza12#
DB_PORT=5432
```

### CORS Settings
The backend is configured to allow requests from all origins for Socket.io:
```python
socketio = SocketIO(app, cors_allowed_origins="*")
```

---

## Troubleshooting

### Messages not appearing
- Check database connection
- Verify user IDs are correct
- Check browser console for errors

### Video call not connecting
- Check camera/microphone permissions
- Verify both users are in the same network (for local testing)
- Check browser console for WebRTC errors
- Ensure port 5000 is accessible

### Socket.io connection issues
- Verify backend is running on port 5000
- Check CORS configuration
- Clear browser cache
- Verify socket.io-client version matches server version

---

## Future Enhancements

- [ ] Group video calls
- [ ] Screen sharing
- [ ] File sharing in chat
- [ ] Voice messages
- [ ] Video message recording
- [ ] Chat encryption
- [ ] Call recording
- [ ] Scheduled meetings
- [ ] Chat search functionality
- [ ] Message reactions and emojis

---

## Support

For issues or questions, please refer to:
- Flask-SocketIO docs: https://flask-socketio.readthedocs.io/
- WebRTC docs: https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API
- React documentation: https://react.dev

---

**Implementation Date:** January 28, 2026  
**Status:** Ready for Testing  
**Version:** 1.0.0
