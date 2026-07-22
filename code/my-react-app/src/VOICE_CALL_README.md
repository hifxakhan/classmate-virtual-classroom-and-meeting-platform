# Voice Call Feature Implementation

## Overview
This implementation adds peer-to-peer voice-only calls to your chat system. Voice calls are separate from scheduled video meetings in the `MeetingRoom` component, allowing users to make direct voice calls to each other through the chat interface.

## Files Modified/Created

### 1. **chatPage.jsx**
- **Added Imports**: FaPhone icon from react-icons
- **Added States**: Voice call related states (active, status, stream, peer, duration, etc.)
- **Added Functions**:
  - `startVoiceCall()` - Initiates a peer-to-peer voice call
  - `acceptVoiceCall()` - Accepts incoming voice call
  - `rejectVoiceCall()` - Declines incoming voice call
  - `endVoiceCall()` - Terminates active call
  - `toggleMute()` - Mutes/unmutes microphone
  - `startVoiceCallTimer()` - Tracks call duration
  - `formatVoiceCallDuration()` - Formats time display
  
- **Added Socket Listeners**:
  - `voice_call_incoming` - Receives incoming call notifications
  - `voice_call_accepted` - Receives acceptance from callee
  - `voice_call_rejected` - Receives rejection
  - `voice_call_busy` - User is on another call
  - `voice_call_ended` - Call ended by other party
  - `voice_call_signal` - ICE candidates and SDP answers

- **Added UI Component**:
  - `VoiceCallOverlay` - Full-screen overlay for call interface
  - Shows incoming call with Accept/Decline buttons
  - Shows active call with call duration and mute/end buttons

- **Added Button**:
  - Voice call button in chat header using FaPhone icon
  - Disabled while already in a call

### 2. **socket-handlers.js** (SFU Server)
- **Added Event Handlers**:
  - `voice_call_request` - Forwards call request to receiver
  - `voice_call_accept` - Forwards acceptance to caller
  - `voice_call_reject` - Forwards rejection to caller
  - `voice_call_busy` - Notifies caller of busy status
  - `voice_call_signal` - Relays WebRTC signaling (ICE candidates, SDP answers)
  - `voice_call_end` - Notifies when call ends

### 3. **chat.css**
- **Added Styles**:
  - `.voice-call-overlay` - Full-screen overlay styling
  - `.voice-call-card` - Call card styling
  - `.voice-call-avatar` - User avatar circle
  - `.voice-call-actions` - Accept/Decline button styling
  - `.voice-call-controls` - Mute/End button styling
  - Animations: `slideUp`, `fadeIn`

### 4. **ringtoneGenerator.js** (NEW)
- Utility functions for generating ringtones using Web Audio API
- `playVoiceCallRingtone()` - Plays single ringtone
- `playRepeatingRingtone(repetitions)` - Plays repeating ringtone
- `stopRingtone(audioContext)` - Stops active ringtone

## Architecture

### Call Flow

1. **Initiating a Call**:
   ```
   User clicks voice call button
   → startVoiceCall() creates RTCPeerConnection
   → Gets user's microphone stream
   → Creates and sends offer via socket
   → Waits for answer from receiver
   ```

2. **Receiving a Call**:
   ```
   Socket receives voice_call_incoming event
   → Shows incoming call overlay with Accept/Decline
   → User clicks Accept
   → acceptVoiceCall() creates RTCPeerConnection
   → Sends answer back to caller
   → Both sides establish connection
   ```

3. **During Call**:
   ```
   RTCPeerConnection automatically exchanges ICE candidates
   → Voice data flows directly peer-to-peer
   → Both can mute/unmute
   → Call timer tracks duration
   ```

4. **Ending Call**:
   ```
   User clicks End Call
   → endVoiceCall() closes peer connection
   → Stops media streams
   → Notifies other party
   → Cleans up all resources
   ```

## Key Features

✅ **Direct P2P Connection**
- No server relay needed for media (only signaling)
- Minimal latency
- Lower bandwidth usage

✅ **Audio-Only**
- No video processing overhead
- Faster connection establishment
- More battery efficient on mobile

✅ **Mute/Unmute**
- Toggle microphone during call
- Visual indicator of mute status

✅ **Call Timer**
- Displays minutes:seconds
- Updated every second

✅ **Busy Detection**
- Users can't receive multiple calls
- Other party notified when busy

✅ **Automatic Cleanup**
- Resources freed on disconnect
- No memory leaks from closed connections

✅ **Timeout Handling**
- 30-second timeout for unanswered calls
- Auto-decline after timeout

✅ **Separated from Meetings**
- Chat-based voice calls (this feature)
- Separate from scheduled video meetings in MeetingRoom
- Different state management
- Different UI/UX

## Using the Voice Call Feature

### For Users

1. **To Make a Call**:
   - Open a chat conversation
   - Click the phone icon button in the chat header
   - Wait for the recipient to accept or decline

2. **To Receive a Call**:
   - A notification overlay appears with caller's name
   - Click "Accept" to join the call or "Decline" to reject
   - If declining or no response in 30 seconds, call ends

3. **During Call**:
   - Use 🎤 button to mute/unmute
   - Use 📞 button to end the call
   - Call timer shows duration

### For Developers

1. **Import Ringtone Generator**:
   ```javascript
   import { playVoiceCallRingtone, stopRingtone } from './utils/ringtoneGenerator';
   ```

2. **Play Ringtone for Incoming Call**:
   ```javascript
   const audioCtx = await playRepeatingRingtone(5);
   // Store reference to stop later
   ringtoneRef.current = audioCtx;
   ```

3. **Stop Ringtone**:
   ```javascript
   stopRingtone(ringtoneRef.current);
   ```

## Browser Compatibility

- Requires **WebRTC** support (RTCPeerConnection, RTCIceCandidate, RTCSessionDescription)
- Requires **Web Audio API** for ringtone generation
- Requires **getUserMedia** permission for microphone access

Supported browsers:
- Chrome 25+
- Firefox 22+
- Safari 11+
- Edge 79+

## Permissions Required

- **Microphone Access**: Users must grant permission for their browser to access the microphone
- Permission is requested on first voice call attempt

## Differences from MeetingRoom Video Calls

| Feature | Voice Call (Chat) | Video Call (Meeting) |
|---------|------------------|---------------------|
| Location | Chat Interface | Meeting Room |
| Type | P2P Direct | LiveKit/SFU Server |
| Media | Audio Only | Audio + Video |
| Database | No backend tracking | Tracked in DB |
| Use Case | Ad-hoc calls | Scheduled classes |
| State | Separate from meetings | Classroom context |

## Troubleshooting

### Call Won't Connect
- Check microphone permissions
- Ensure both users are in the same chat conversation
- Verify socket.io connection is active

### No Sound
- Check microphone volume
- Ensure microphone is not muted in OS settings
- Check browser permissions

### Remote Audio Not Heard
- Verify system volume is not muted
- Check browser speaker settings
- Ensure other party's microphone is not muted

## Future Enhancements

- [ ] Call history/logs
- [ ] Add video option to voice call
- [ ] Call recording
- [ ] Missed call notifications
- [ ] Call transfer to other users
- [ ] Group voice calls (3+ participants)
- [ ] Call quality indicators
- [ ] Echo cancellation
- [ ] Noise suppression
- [ ] Call statistics/analytics

## Security Notes

- Calls are peer-to-peer encrypted by WebRTC
- Signaling goes through your socket.io server
- Ensure your socket.io server is behind TLS/SSL
- Consider adding authentication to voice_call_* events
- User authentication already required for chat access

## Performance Notes

- Voice calls use minimal bandwidth (typically 20-50 kbps)
- P2P connection means server load is minimal
- Audio processing is handled by browser
- No transcoding or server-side processing needed
