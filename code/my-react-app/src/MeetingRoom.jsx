import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import LiveChat from './liveChat';
import VideoCall from './videoCall';
import './MeetingRoom.css';

const MeetingRoom = () => {
  const { meetingId } = useParams();
  const navigate = useNavigate();
  const [hasJoined, setHasJoined] = useState(false);
  const [activeTab, setActiveTab] = useState('video'); // 'video' or 'chat'
  const [courseInfo, setCourseInfo] = useState(null);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [sessionId, setSessionId] = useState(null);
  const [sessionStatus, setSessionStatus] = useState(null); // 'scheduled', 'ongoing', 'completed', etc.
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState(null);
  const [autoStartCall, setAutoStartCall] = useState(false);
  const [callTrigger, setCallTrigger] = useState(0);
  const [incomingCallInfo, setIncomingCallInfo] = useState(null);
  const [autoAccept, setAutoAccept] = useState(false);
  const [acceptTrigger, setAcceptTrigger] = useState(0);
  const [currentUser, setCurrentUser] = useState({
    id: 'teacher1',
    type: 'teacher',
    name: 'Prof. Butter Cup'
  });
  const [otherUser, setOtherUser] = useState({
    id: 'student1',
    type: 'student',
    name: 'Student'
  });

  // Meeting ID is the meeting-room-id (e.g., "AI501-yz6tb5bw").
  // Extract both the full meetingRoomId and the courseCode prefix.
  const meetingRoomId = meetingId || '';
  const courseCode = meetingRoomId ? meetingRoomId.split('-')[0] : 'AI501';
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    console.log('📍 MeetingRoom initialized with courseCode:', courseCode);

    // Get current user from URL params (override) or localStorage
    const urlParams = new URLSearchParams(window.location.search);
    const paramUid = urlParams.get('uid');
    const paramRole = urlParams.get('role');
    const paramName = urlParams.get('name');

    const userData = localStorage.getItem('currentUser') || localStorage.getItem('user');
    const storedTeacherId = localStorage.getItem('teacherId') || localStorage.getItem('teacher_id');
    const storedStudentId = localStorage.getItem('studentId') || localStorage.getItem('student_id');
    const storedTeacherName = localStorage.getItem('teacherName') || localStorage.getItem('teacher_name');
    const storedStudentName = localStorage.getItem('studentName') || localStorage.getItem('student_name');
    console.log('📍 MeetingRoom: userData from localStorage:', userData);

    let loggedInUser = {
      id: 'teacher1',
      type: 'teacher',
      name: 'Prof. Butter Cup'
    };

    if (userData) {
      try {
        const parsedUser = JSON.parse(userData);
        console.log('📍 MeetingRoom: parsedUser:', parsedUser);

        // Infer type more robustly from multiple common fields
        let inferredType = 'student';
        if (parsedUser.teacher_id || parsedUser.teacherId || parsedUser.is_teacher || parsedUser.role === 'teacher') {
          inferredType = 'teacher';
        } else if (parsedUser.student_id || parsedUser.studentId || parsedUser.role === 'student') {
          inferredType = 'student';
        }

        const resolvedType = parsedUser.type || parsedUser.role || inferredType;
        const resolvedId = resolvedType === 'teacher'
          ? (parsedUser.teacher_id || parsedUser.teacherId || parsedUser.id || parsedUser.user_id || parsedUser.uid || 'teacher1')
          : (parsedUser.student_id || parsedUser.studentId || parsedUser.id || parsedUser.user_id || parsedUser.uid || 'student1');

        loggedInUser = {
          id: resolvedId,
          type: resolvedType,
          name: parsedUser.name || parsedUser.first_name || parsedUser.full_name || 'User'
        };
      } catch (e) {
        console.log('Could not parse user data:', e);
      }
    }

    // If there's no logged-in user JSON, but individual teacher/student keys exist, use them
    if (!userData && (storedTeacherId || storedStudentId)) {
      if (storedTeacherId) {
        loggedInUser = {
          id: storedTeacherId,
          type: 'teacher',
          name: storedTeacherName || 'Teacher'
        };
      } else if (storedStudentId) {
        loggedInUser = {
          id: storedStudentId,
          type: 'student',
          name: storedStudentName || 'Student'
        };
      }
    }

    // If a stored teacher/student ID exists, prefer it to avoid mismatches with backend IDs
    if (loggedInUser.type === 'teacher' && storedTeacherId) {
      loggedInUser.id = storedTeacherId;
      if (storedTeacherName) loggedInUser.name = storedTeacherName;
    }
    if (loggedInUser.type === 'student' && storedStudentId) {
      loggedInUser.id = storedStudentId;
      if (storedStudentName) loggedInUser.name = storedStudentName;
    }

    // If there's no logged-in user in localStorage, allow URL params to set identity
    const decodedParamName = paramName ? decodeURIComponent(paramName) : null;
    if (!userData) {
      if (paramUid) loggedInUser.id = paramUid;
      if (paramRole) loggedInUser.type = paramRole;
      if (decodedParamName) loggedInUser.name = decodedParamName;
    }

    setCurrentUser(loggedInUser);

    // If a real logged-in user exists, strip any invite uid/role/name from the URL to avoid confusion
    if (userData || localStorage.getItem('teacherId') || localStorage.getItem('studentId')) {
      try {
        const url = new URL(window.location.href);
        const params = url.searchParams;
        let changed = false;
        ['uid', 'role', 'name'].forEach(k => {
          if (params.get(k)) { params.delete(k); changed = true; }
        });
        if (changed) {
          const newUrl = params.toString() ? `${url.pathname}?${params.toString()}` : url.pathname;
          window.history.replaceState({}, '', newUrl);
        }
      } catch (e) {
        // ignore
      }
    }

    // If there's no logged-in user in localStorage, write invite params so the URL can be shared
    if (!userData && !localStorage.getItem('teacherId') && !localStorage.getItem('studentId')) {
      try {
        const url = new URL(window.location.href);
        const params = url.searchParams;
        if (!params.get('uid')) params.set('uid', loggedInUser.id);
        if (!params.get('role')) params.set('role', loggedInUser.type);
        if (!params.get('name')) params.set('name', loggedInUser.name);
        const newUrl = `${url.pathname}?${params.toString()}`;
        window.history.replaceState({}, '', newUrl);
      } catch (e) {
        // ignore
      }
    }

    const fetchCourseAndSession = async () => {
      try {

        // If meetingRoomId is present in the URL, ask backend for session by meeting_room_id
        if (meetingRoomId) {
          try {
            const byRoomResp = await fetch(`https://classmate-backend-eysi.onrender.com/api/sessions/by-room/${meetingRoomId}`);
            if (byRoomResp.ok) {
              const byRoomData = await byRoomResp.json();
              if (byRoomData.success && byRoomData.session) {
                setSessionId(byRoomData.session.session_id);
                setSessionStatus(byRoomData.session.status || 'scheduled');
                console.log('📍 Session ID found by meeting_room_id (backend):', byRoomData.session.session_id, 'Status:', byRoomData.session.status);
              }
            } else {
              console.warn('⚠️ /api/sessions/by-room returned', byRoomResp.status);
            }
          } catch (err) {
            console.warn('⚠️ Error fetching session by meeting_room_id:', err);
          }

          // If still no sessionId, fallback to teacher sessions (if teacher)
          if (!sessionId && loggedInUser.type === 'teacher') {
            try {
              const sessionResponse = await fetch(`https://classmate-backend-eysi.onrender.com/api/teacher/sessions?teacher_id=${loggedInUser.id}`);
              const sessionData = await sessionResponse.json();
              if (sessionData.success && sessionData.sessions && sessionData.sessions.length > 0) {
                const found = sessionData.sessions.find(s => s.meeting_room_id === meetingRoomId);
                if (found) {
                  setSessionId(found.session_id);
                  console.log('📍 Session ID found by meeting_room_id (teacher sessions):', found.session_id);
                }
              }
            } catch (err) {
              console.warn('⚠️ Could not fetch teacher sessions for fallback:', err);
            }
          }
        } else {
          // No meetingRoomId in URL: fallback to first session for the teacher (if available)
          if (loggedInUser.type === 'teacher') {
            try {
              const sessionResponse = await fetch(`https://classmate-backend-eysi.onrender.com/api/teacher/sessions?teacher_id=${loggedInUser.id}`);
              const sessionData = await sessionResponse.json();
              if (sessionData.success && sessionData.sessions && sessionData.sessions.length > 0) {
                const session = sessionData.sessions[0];
                setSessionId(session.session_id);
                console.log('📍 Session ID set from teacher sessions:', session.session_id);
              }
            } catch (err) {
              console.warn('⚠️ Could not fetch teacher sessions for default:', err);
            }
          }
        }
      } catch (err) {
        console.error('Error fetching course/session info:', err);
        // Set default course info
        setCourseInfo({
          code: courseCode,
          name: 'Course',
          instructor: loggedInUser.name,
          time: '11:00 AM',
          date: new Date().toLocaleDateString()
        });
      }
    };

    fetchCourseAndSession();

    // IMPORTANT: For video calls, both teacher and student use courseCode as otherUserId
    // This ensures they look for the same course in pending calls
    if (loggedInUser.type === 'teacher' || loggedInUser.role === 'teacher') {
      // Teacher calling students in this course
      setOtherUser({
        id: courseCode,  // Use courseCode so all students in course see this call
        type: 'student',
        name: 'Class Students'
      });
    } else {
      // Student calling the teacher of this course
      // Fetch teacher details for name display
      fetchTeacherByCourse(courseCode);
    }

    // small mount animation flag to trigger entrance transitions
    const t = setTimeout(() => setMounted(true), 60);
    return () => clearTimeout(t);
  }, [courseCode]);

  // Fetch teacher by course code for name display
  const fetchTeacherByCourse = async (courseCode) => {
    try {
      const response = await fetch(`https://classmate-backend-eysi.onrender.com/api/teacher/by-course/${courseCode}`);
      const data = await response.json();

      if (data.success && data.teacher) {
        setOtherUser({
          id: courseCode,  // Use courseCode for the call, not teacher_id
          type: 'teacher',
          name: data.teacher.name  // Show teacher's actual name
        });
        console.log('✅ Teacher fetched:', data.teacher.name);
      } else {
        console.log('⚠️ Could not find teacher for course:', courseCode);
        setOtherUser({
          id: courseCode,
          type: 'teacher',
          name: 'Teacher'
        });
      }
    } catch (err) {
      console.error('Error fetching teacher:', err);
      setOtherUser({
        id: courseCode,
        type: 'teacher',
        name: 'Teacher'
      });
    }
  };

  // Allow forcing role from localStorage when testing (teacher/browser mismatch)
  const handleForceRole = (role) => {
    if (role === 'teacher') {
      const id = localStorage.getItem('teacherId') || localStorage.getItem('teacher_id') || 'teacher1';
      const name = localStorage.getItem('teacherName') || localStorage.getItem('teacher_name') || 'Teacher';
      const newUser = { id, type: 'teacher', name };
      setCurrentUser(newUser);
      setOtherUser({ id: courseCode, type: 'student', name: 'Class Students' });
    } else {
      const id = localStorage.getItem('studentId') || localStorage.getItem('student_id') || 'student1';
      const name = localStorage.getItem('studentName') || localStorage.getItem('student_name') || 'Student';
      const newUser = { id, type: 'student', name };
      setCurrentUser(newUser);
      // refresh teacher display
      fetchTeacherByCourse(courseCode);
    }
  };

  const handleLeaveCall = () => {
    // Handle leaving the meeting
    window.history.back();
  };

  // Update class session status to ongoing
  const updateSessionStatus = async (status) => {
    if (!sessionId) {
      console.warn('⚠️ No session ID available to update status');
      return false;
    }

    try {
      console.log(`🔄 Updating session ${sessionId} status to: ${status}`);

      // Use courseRoutes endpoint to update session status
      const response = await fetch(`https://classmate-backend-eysi.onrender.com/api/sessions/${sessionId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ status })
      });

      const data = await response.json();

      if (data.success) {
        console.log(`✅ Session status updated successfully to: ${status}`);
        return true;
      } else {
        console.error('❌ Failed to update session status:', data.error || data.message);
        return false;
      }
    } catch (err) {
      console.error('❌ Error updating session status:', err);
      return false;
    }
  };

  const handleJoinMeeting = async () => {
    console.log('👋 Join meeting clicked, sessionId:', sessionId);
    setJoinLoading(true);

    try {
      setJoinError(null);
      console.log('handleJoinMeeting: currentUser=', currentUser, 'sessionId=', sessionId);

      if (currentUser && currentUser.type === 'teacher') {
        // Teacher must be verified by backend; do not proceed unless backend accepts
        if (!sessionId) {
          setJoinError('No session id found for this meeting.');
          console.error('No session id found for teacher join');
          return;
        }

        try {
          const resp = await fetch(`https://classmate-backend-eysi.onrender.com/api/sessions/${sessionId}/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ teacher: { id: currentUser.id, name: currentUser.name } })
          });
          const data = await resp.json().catch(() => ({}));
          console.log('join endpoint response', resp.status, data);

          if (resp.ok && data.success) {
            // backend validated teacher and set session ongoing
            // Teacher should now join the video call area (hasJoined = true)
            // AND initiate the call (autoStartCall = true)
            // This makes VideoCall visible and auto-starts the call
            setHasJoined(true);
            setAutoStartCall(true);
            setCallTrigger(Date.now());
            console.log('✅ Teacher join accepted by backend, joining video call and initiating call');
          } else {
            const msg = data.error || 'Teacher verification failed';
            setJoinError(msg);
            console.error('Teacher join failed:', msg);
            return; // do not proceed
          }
        } catch (e) {
          setJoinError('Could not contact server to verify teacher.');
          console.error('Error contacting join endpoint:', e);
          return;
        }
      } else {
        // Student or anonymous participant: do not change session status, just join locally
        setHasJoined(true);
        console.log('✅ Student/participant joined locally');
      }
    } finally {
      setJoinLoading(false);
    }
  };

  // Simple participants list for sidebar (will be replaced by real data when available)
  const participants = [currentUser, otherUser].filter(Boolean);

  const handleCallActive = () => {
    // Callback when call is accepted and becomes active
    // Only transition student into the video call here. Teacher already sets hasJoined when they click Join now.
    console.log('📞 onCallActive received; currentUser=', currentUser);
    if (currentUser?.type === 'student') {
      console.log('📞 Call active -> student will join video call');
      setHasJoined(true);
    } else {
      console.log('📞 onCallActive ignored for teacher (teacher joins via Join now)');
    }
  };

  const handleCallEnd = async () => {
    if (currentUser?.type === 'teacher') {
      await updateSessionStatus('completed');
    }
    // Small delay to ensure cleanup completes
    setTimeout(() => {
      if (currentUser?.type === 'teacher') {
        navigate('/teacherDashboard');
      } else if (currentUser?.type === 'student') {
        navigate('/studentDashboard');
      }
    }, 500);
  };

  // Debug: log key state changes to help tracing why student might be in VideoCall
  useEffect(() => {
    console.log('🔍 MeetingRoom state:', {
      hasJoined,
      autoStartCall,
      callTrigger,
      incomingCallInfo,
      currentUserType: currentUser?.type,
      courseCode
    });
  }, [hasJoined, autoStartCall, callTrigger, incomingCallInfo, currentUser?.type, courseCode]);

  // Poll for incoming calls on pre-join screen for students
  useEffect(() => {
    if (hasJoined || currentUser?.type !== 'student') return;

    const pollForIncomingCalls = async () => {
      try {
        const response = await fetch(
          `https://classmate-backend-eysi.onrender.com/api/video-call/pending/${encodeURIComponent(courseCode)}/${currentUser?.type}`
        );
        const data = await response.json();
        if (data.success && data.calls && data.calls.length > 0) {
          const call = data.calls[0];
          if (!incomingCallInfo || call.call_id !== incomingCallInfo.call_id) {
            setIncomingCallInfo(call);
            console.log('📞 Student detected incoming call:', call);
          }
        }
      } catch (err) {
        console.error('Error polling for incoming calls:', err);
      }
    };

    pollForIncomingCalls();
    const interval = setInterval(pollForIncomingCalls, 2000);

    return () => clearInterval(interval);
  }, [hasJoined, currentUser?.type, courseCode, incomingCallInfo]);

  return (
    <div className={`meeting-room-container ${mounted ? 'mounted' : ''}`}>

      {/* Mount VideoCall for teacher when call is initiated (but keep it hidden until student accepts) */}
      {autoStartCall && (
        <div style={{ display: hasJoined ? 'block' : 'none' }}>
          <VideoCall
            currentUserId={currentUser?.id}
            currentUserType={currentUser?.type}
            uid={currentUser?.id}
            courseCode={courseCode}
            otherUserId={otherUser?.id}
            otherUserType={otherUser?.type}
            otherUserName={otherUser?.name}
            autoStart={autoStartCall}
            autoStartTrigger={callTrigger}
            autoAccept={autoAccept}
            autoAcceptTrigger={acceptTrigger}
            onCallActive={handleCallActive}
            onIncomingCall={setIncomingCallInfo}
            onCallEnd={handleCallEnd}
            sessionId={sessionId}
            initialAudioEnabled={audioEnabled}
            initialVideoEnabled={videoEnabled}
          />
        </div>
      )}

      {/* Mount VideoCall for students after they accept (for those who haven't accepted yet, polling happens above) */}
      {hasJoined && !autoStartCall && (
        <VideoCall
          currentUserId={currentUser?.id}
          currentUserType={currentUser?.type}
          uid={currentUser?.id}
          courseCode={courseCode}
          otherUserId={otherUser?.id}
          otherUserType={otherUser?.type}
          otherUserName={otherUser?.name}
          autoStart={false}
          autoStartTrigger={0}
          autoAccept={autoAccept}
          autoAcceptTrigger={acceptTrigger}
          onCallActive={handleCallActive}
          onIncomingCall={setIncomingCallInfo}
          onCallEnd={handleCallEnd}
          sessionId={sessionId}
          initialAudioEnabled={audioEnabled}
          initialVideoEnabled={videoEnabled}
        />
      )}

      {/* Pre-join overlay: shown until user explicitly joins */}
      {!hasJoined && (
        <div className="pre-join-screen">
          <button className="pre-join-close" onClick={() => window.history.back()}>Close</button>

          <div className="pre-join-content">
            <p className="pre-join-subtitle">Choose your audio and video settings for</p>
            <h2 className="pre-join-title">Meeting with {otherUser?.name || 'Participant'}</h2>

            <div className="pre-join-preview">
              <div className="pre-join-avatar">
                {currentUser?.name?.charAt(0) || 'U'}
              </div>
              <div className="pre-join-meta" style={{ marginLeft: 12 }}>
                {/* Debug/localStorage details removed for cleaner UI */}
              </div>
              
              {/* Teacher: only show Join now button (teacher initiates, doesn't receive) */}
              {currentUser?.type === 'teacher' ? (
                <>
                  <button
                    className={`pre-join-join-btn ${joinLoading ? 'loading' : ''}`}
                    onClick={handleJoinMeeting}
                    disabled={joinLoading}
                  >
                    {joinLoading ? 'Joining...' : 'Join now'}
                  </button>
                  {joinError && (
                    <div style={{ marginTop: 12, color: '#b33', fontSize: 13 }}>
                      {joinError}
                    </div>
                  )}
                </>
              ) : (
                /* Student: show accept/decline or waiting message */
                <>
                  {incomingCallInfo ? (
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      <div style={{ textAlign: 'left' }}>
                        <div style={{ fontWeight: 700 }}>{incomingCallInfo.initiator_name || 'Instructor'} is calling</div>
                        <div style={{ fontSize: 12, color: 'var(--brand-muted)' }}>Incoming class call</div>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          className="pre-join-join-btn"
                          onClick={() => {
                            setHasJoined(true);
                            setAutoAccept(true);
                            setAcceptTrigger(Date.now());
                            setIncomingCallInfo(null);
                          }}
                        >
                          Accept
                        </button>
                        <button
                          className="pre-join-option-btn"
                          onClick={async () => {
                            try {
                              await fetch(`https://classmate-backend-eysi.onrender.com/api/video-call/${incomingCallInfo.call_id}/decline`, { method: 'PUT' });
                            } catch (e) {
                              console.warn('Error declining call', e);
                            }
                            setIncomingCallInfo(null);
                          }}
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ marginTop: 20, textAlign: 'center', color: '#666', fontSize: 16 }}>
                      Waiting for instructor to start the call...
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="pre-join-controls">
              <div className="pre-join-control-group">
                <label className="pre-join-toggle-label">
                  <input
                    type="checkbox"
                    checked={videoEnabled}
                    onChange={(e) => setVideoEnabled(e.target.checked)}
                    className="pre-join-toggle-input"
                  />
                  <span className="pre-join-toggle">
                    <i className={`fas ${videoEnabled ? 'fa-video' : 'fa-video-slash'}`} style={{ color: '#567c8d' }}></i>
                  </span>
                </label>
              </div>

              <div className="pre-join-control-group">
                <label className="pre-join-toggle-label">
                  <input
                    type="checkbox"
                    checked={audioEnabled}
                    onChange={(e) => setAudioEnabled(e.target.checked)}
                    className="pre-join-toggle-input"
                  />
                  <span className="pre-join-toggle">
                    <i className={`fas ${audioEnabled ? 'fa-microphone' : 'fa-microphone-slash'}`} style={{ color: '#567c8d' }}></i>
                  </span>
                </label>
              </div>

              <div className="pre-join-settings">
                <i className="fas fa-cog" style={{ color: '#567c8d' }}></i>
                <span>Internal Mic and Speakers</span>
              </div>
            </div>

            <div className="pre-join-other-options">
              <p>Other join options</p>
              <div className="pre-join-option-buttons">
                <button className="pre-join-option-btn">
                  <i className="fas fa-video-slash" style={{ color: '#567c8d' }}></i>
                  Video off
                </button>
                <button className="pre-join-option-btn">
                  <i className="fas fa-phone" style={{ color: '#567c8d' }}></i>
                  Phone audio
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MeetingRoom;
