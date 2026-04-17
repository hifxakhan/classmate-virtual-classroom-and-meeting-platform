# Test Flow - Teacher and Student Call

## Step 1: Teacher Setup
1. Open browser 1: http://localhost:5174/meeting/CS101-testmeeting
2. Set localStorage: 
   - `currentUser = {"id":"teacher1","type":"teacher","name":"Prof. John"}`
3. Refresh page
4. Should see: "Join now" button on pre-join screen

## Step 2: Student Setup  
1. Open browser 2: http://localhost:5174/meeting/CS101-testmeeting
2. Set localStorage:
   - `currentUser = {"id":"student1","type":"student","name":"Alice"}`
3. Refresh page
4. Should see: "Waiting for instructor to start the call..." message

## Step 3: Teacher Clicks Join Now
1. In browser 1, click "Join now"
2. Expected behavior:
   - ✅ Session status changes to "ongoing" in database
   - ✅ VideoCall component mounts and becomes visible
   - ✅ VideoCall auto-starts the call
   - ✅ VideoCall shows "Initializing call..." in idle state (no video yet)
   - ✅ Teacher sees peer connection initializing

## Step 4: Student Sees Incoming Call
1. In browser 2, should see within 2 seconds:
   - ✅ "Prof. John is calling" message
   - ✅ Accept/Decline buttons appear
   - ✅ Poll endpoint detected the incoming call

## Step 5: Student Accepts
1. In browser 2, click "Accept" button
2. Expected behavior:
   - ✅ VideoCall component mounts for student
   - ✅ Student's peer connection accepts and initializes
   - ✅ Both teacher and student in video call area
   - ✅ Call becomes active (not idle)
   - ✅ No extra buttons or duplicate UI

## Step 6: Video Call Active
1. Both should see:
   - ✅ Video grid with both cameras (if media devices available)
   - ✅ Call duration timer
   - ✅ Audio/Video/Fullscreen buttons
   - ✅ Teacher sees "Mute all" button
   - ✅ No "Start Call" button visible

## Known Issues to Watch For
- ❌ If teacher stays on pre-join after clicking join now
- ❌ If VideoCall shows "Start Call" button instead of "Initializing call..."
- ❌ If student doesn't see "Accept/Decline" within 2 seconds
- ❌ If peer connection fails due to media access permissions
