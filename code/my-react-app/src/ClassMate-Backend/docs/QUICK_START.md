# Quick Setup Guide - Live Chat & Video Call

## 🚀 Quick Start (5 minutes)

### Step 1: Backend Setup
```bash
cd src/ClassMate-Backend
pip install -r requirements.txt
python models.py
python app.py
```

✅ Backend running on http://localhost:5000

### Step 2: Frontend Setup
```bash
npm install
npm run dev
```

✅ Frontend running on http://localhost:5173

### Step 3: Test the Features

#### Test Chat:
```jsx
import LiveChat from './liveChat';

// Use in your component
<LiveChat 
  currentUserId="teacher1"
  currentUserType="teacher"
  otherUserId="student1"
  otherUserType="student"
  otherUserName="Student Name"
/>
```

#### Test Video Call:
```jsx
import VideoCall from './videoCall';

// Use in your component
<VideoCall 
  currentUserId="teacher1"
  currentUserType="teacher"
  otherUserId="student1"
  otherUserType="student"
  otherUserName="Student Name"
  onCallEnd={() => {}}
/>
```

---

## 📋 What Was Added

### Backend Files
- ✅ `models.py` - Database tables and operations
- ✅ `liveChat.py` - Chat API endpoints (6 endpoints)
- ✅ `videoCall.py` - Video call API endpoints (8 endpoints)
- ✅ Updated `app.py` - Added SocketIO support + 10 socket events
- ✅ Updated `requirements.txt` - Added Flask-SocketIO

### Frontend Files
- ✅ `liveChat.jsx` - Fully functional chat UI component
- ✅ `liveChat.css` - Beautiful chat styling with animations
- ✅ `videoCall.jsx` - Complete video call component with WebRTC
- ✅ `videoCall.css` - Responsive video call UI
- ✅ Updated `package.json` - Added socket.io-client and simple-peer

### Database Tables Created
- ✅ `messages` - Store chat messages
- ✅ `video_calls` - Store call information
- ✅ `call_participants` - For group calls
- ✅ `message_threads` - Organize conversations

---

## 🔌 API Reference

### Chat APIs (6 endpoints)
1. **GET** `/api/chat/messages/<user_id>/<user_type>/<other_user_id>/<other_user_type>`
2. **POST** `/api/chat/send`
3. **PUT** `/api/chat/mark-read/<message_id>`
4. **GET** `/api/chat/unread-count/<user_id>/<user_type>`
5. **GET** `/api/chat/conversations/<user_id>/<user_type>`
6. **GET** `/api/chat/search?q=query&current_user_id=id&current_user_type=type`

### Video Call APIs (8 endpoints)
1. **POST** `/api/video-call/initiate`
2. **PUT** `/api/video-call/<call_id>/accept`
3. **PUT** `/api/video-call/<call_id>/decline`
4. **PUT** `/api/video-call/<call_id>/end`
5. **GET** `/api/video-call/<call_id>`
6. **GET** `/api/video-call/room/<room_id>`
7. **GET** `/api/video-call/pending/<user_id>/<user_type>`
8. **GET** `/api/video-call/history/<user_id>/<user_type>`

---

## 🎮 Socket.io Events (10 events)

### Chat Events
- `join_chat_room` - Join a conversation
- `send_message` - Send a message in real-time
- `typing` - Notify user is typing
- `stop_typing` - Notify user stopped typing
- `new_message` - Receive new message (listener)
- `user_typing` - Listen for typing indicator

### Video Call Events
- `join_video_call` - Join call room
- `offer` - Send WebRTC offer
- `answer` - Send WebRTC answer
- `ice_candidate` - Send ICE candidates
- `leave_video_call` - Leave call

---

## ✨ Features

### Live Chat ✅
- Real-time messaging
- Message history
- Read receipts (✓ sent, ✓✓ read)
- Typing indicators
- Unread count
- Beautiful UI with animations

### Video Call ✅
- Peer-to-peer WebRTC
- Audio/video toggle
- Call duration tracking
- Incoming call notifications
- Call history
- Responsive design

---

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| Backend won't start | Check Python version (3.7+), install requirements again |
| Database error | Run `python models.py` to create tables |
| Frontend won't load | Run `npm install`, clear cache, restart dev server |
| Video not working | Check camera permissions, ensure HTTPS or localhost |
| Messages not syncing | Check database connection, verify user IDs |

---

## 📝 Usage Example

```jsx
import { useState } from 'react';
import LiveChat from './liveChat';
import VideoCall from './videoCall';

export default function ClassRoom() {
  const [showChat, setShowChat] = useState(true);
  const [showVideo, setShowVideo] = useState(false);

  return (
    <div>
      <button onClick={() => setShowChat(!showChat)}>Chat</button>
      <button onClick={() => setShowVideo(!showVideo)}>Video Call</button>

      {showChat && (
        <LiveChat 
          currentUserId="teacher1"
          currentUserType="teacher"
          otherUserId="student1"
          otherUserType="student"
          otherUserName="John Doe"
        />
      )}

      {showVideo && (
        <VideoCall 
          currentUserId="teacher1"
          currentUserType="teacher"
          otherUserId="student1"
          otherUserType="student"
          otherUserName="John Doe"
          onCallEnd={() => setShowVideo(false)}
        />
      )}
    </div>
  );
}
```

---

## 📚 Documentation

Full documentation available in: `FEATURES_DOCUMENTATION.md`

---

## ✅ Checklist

- [ ] Install backend requirements
- [ ] Create database tables (`python models.py`)
- [ ] Start backend server (`python app.py`)
- [ ] Install frontend packages (`npm install`)
- [ ] Start frontend dev server (`npm run dev`)
- [ ] Import and use components
- [ ] Test chat functionality
- [ ] Test video call functionality
- [ ] Grant camera/microphone permissions

---

**Ready to use! 🎉**

For detailed API documentation, see `FEATURES_DOCUMENTATION.md`
