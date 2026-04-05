import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './videoCall.css';

const VideoCall = ({ 
  currentUserId, 
  currentUserType, 
  uid, // explicit uid (overrides local id when provided)
  courseCode,
  otherUserId, 
  otherUserType, 
  otherUserName,
  onCallEnd,
  autoStart=false,
  autoStartTrigger=0
  , onIncomingCall, autoAccept=false, autoAcceptTrigger=0, onCallActive,
  sessionId,
  onAttendanceMarked
}) => {
  const [callState, setCallState] = useState('idle'); // idle, calling, active, ended
  const [currentCall, setCurrentCall] = useState(null);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [callDuration, setCallDuration] = useState(0);
  const [error, setError] = useState('');
  const [pendingCalls, setPendingCalls] = useState([]);
  const [incomingCall, setIncomingCall] = useState(null);
  const [responderDetected, setResponderDetected] = useState(false); // Track if onCallActive was fired
  
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const timerRef = useRef(null);
  const pollIntervalRef = useRef(null);
  const containerRef = useRef(null);
  const activeCallPollRef = useRef(null);
  const [mutedAll, setMutedAll] = useState(false);
  const autoAcceptHandledRef = useRef(false);
  const [attendanceId, setAttendanceId] = useState(null);
  const [sessionEndTime, setSessionEndTime] = useState(null);
  const sessionEndCheckRef = useRef(null);

  // Teacher check: simple and explicit
  const isTeacher = String(currentUserType || '').toLowerCase() === 'teacher';
  
  // Fallback: if you initiated the call and it's active, you can mute all
  const isCallInitiator = currentCall && currentUserId === currentCall.initiator_id;
  const showTeacherControls = isTeacher || isCallInitiator;

  // Debug logging
  useEffect(() => {
    console.log('🎬 VideoCall Props:', {
      currentUserId,
      currentUserType,
      showTeacherControls,
      callState,
      currentCall,
      incomingCall
    });
  }, [currentUserType, currentUserId, callState]);

  // Initialize peer connection
  const initiatePeerConnection = async (roomId) => {
    try {
      const configuration = {
        iceServers: [
          { urls: ['stun:stun.l.google.com:19302'] },
          { urls: ['stun:stun1.l.google.com:19302'] }
        ]
      };

      const peerConnection = new RTCPeerConnection(configuration);
      peerConnectionRef.current = peerConnection;

      // Add local stream
      try {
        const localStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: isAudioEnabled
        });

        console.log('✅ Local stream acquired:', localStream);
        console.log('📹 Video tracks:', localStream.getVideoTracks());

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStream;
          console.log('📺 Local video srcObject set');
          // Force video to play
          localVideoRef.current.play().catch(e => console.error('Error playing local video:', e));
        }

        localStream.getTracks().forEach(track => {
          console.log('Adding track to peer connection:', track.kind);
          peerConnection.addTrack(track, localStream);
        });
      } catch (err) {
        console.error('❌ Error accessing media devices:', err);
        setError('Cannot access camera or microphone. Please check permissions.');
        return;
      }

      // Handle remote stream
      peerConnection.ontrack = (event) => {
        console.log('🎥 Remote track received:', event.track.kind);
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = event.streams[0];
          console.log('📺 Remote video srcObject set');
          // Force video to play
          remoteVideoRef.current.play().catch(e => console.error('Error playing remote video:', e));
        }
      };

      // Handle ICE candidates
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          console.log('New ICE candidate:', event.candidate);
        }
      };

      // Handle connection state changes
      peerConnection.onconnectionstatechange = () => {
        console.log('Connection state:', peerConnection.connectionState);
        if (peerConnection.connectionState === 'failed' || 
            peerConnection.connectionState === 'disconnected') {
          handleEndCall();
        }
      };

    } catch (err) {
      console.error('Error initiating peer connection:', err);
      setError('Failed to initialize peer connection');
    }
  };

  const startSessionEndMonitoring = () => {
    // Check every 5 seconds if session end time has passed
    if (sessionEndCheckRef.current) clearInterval(sessionEndCheckRef.current);
    
    sessionEndCheckRef.current = setInterval(() => {
      if (!sessionEndTime) return;
      
      const now = new Date();
      const endTime = new Date(sessionEndTime);
      
      if (now >= endTime) {
        console.log('⏰ Session time expired, auto-ending call...');
        clearInterval(sessionEndCheckRef.current);
        
        // Update session status to completed
        if (sessionId && currentUserType === 'teacher') {
          axios.put(`https://classmate-backend-eysi.onrender.com/api/sessions/${sessionId}/status`, {
            status: 'completed'
          }).then(() => {
            console.log('✅ Session status updated to completed');
          }).catch(err => {
            console.error('⚠️ Failed to update session status:', err);
          });
        }
        
        // End the call (this will trigger attendance leave marking)
        handleEndCall();
      }
    }, 5000);
  };

  const startActiveCallPolling = (callId) => {
    // Poll call details during active call to observe mute-all changes and responder acceptance
    if (activeCallPollRef.current) clearInterval(activeCallPollRef.current);
    activeCallPollRef.current = setInterval(async () => {
      try {
        const res = await axios.get(`https://classmate-backend-eysi.onrender.com/api/video-call/${callId}`);
        if (res.data.success && res.data.call) {
          const call = res.data.call;
          
          // If call ended by teacher, auto-exit for students
          if (call.status === 'ended') {
            console.log('📞 Call ended by teacher, exiting...');
            clearInterval(activeCallPollRef.current);
            handleEndCall();
            return;
          }
          
          // If we're the initiator and a responder has accepted, notify parent (only once)
          if (!responderDetected && currentUserId === call.initiator_id && call.responder_id && typeof onCallActive === 'function') {
            console.log('✅ Responder detected, calling onCallActive');
            setResponderDetected(true);
            try { onCallActive(); } catch(e) { console.warn('onCallActive handler error', e); }
          }
          
          if (call.muted_all) {
            setMutedAll(true);
            if (currentUserType === 'student') {
              setIsAudioEnabled(false);
              muteLocalAudioTracks(true);
            }
          } else {
            if (mutedAll && currentUserType === 'student') {
              // teacher unmuted all -> restore student's audio
              setIsAudioEnabled(true);
              muteLocalAudioTracks(false);
            }
            setMutedAll(false);
          }
        }
      } catch (e) {
        console.error('Error polling active call details:', e);
      }
    }, 2000);
  };

    // Helper: mute/unmute local audio tracks directly
    const muteLocalAudioTracks = (mute) => {
      try {
        if (localVideoRef.current && localVideoRef.current.srcObject) {
          localVideoRef.current.srcObject.getAudioTracks().forEach(track => {
            track.enabled = !mute;
          });
        }

        if (peerConnectionRef.current) {
          peerConnectionRef.current.getSenders().forEach(sender => {
            if (sender.track && sender.track.kind === 'audio') {
              sender.track.enabled = !mute;
            }
          });
        }
      } catch (e) {
        console.error('Error muting local tracks:', e);
      }
    };

    // Initiate call
  const handleInitiateCall = async () => {
    try {
      setError('');
      setCallState('calling');

      console.log('📞 Initiating call from', currentUserId, 'to', otherUserId);

      const response = await axios.post('https://classmate-backend-eysi.onrender.com/api/video-call/initiate', {
        initiator_id: currentUserId,
        initiator_type: currentUserType,
        receiver_id: otherUserId,
        receiver_type: otherUserType,
        // Inform backend of the initiating user's uid if available so it can route targets
        target_uid: uid || null
      });

      if (response.data.success) {
        const callId = response.data.call_id;
        const roomId = response.data.room_id;
        
        console.log('✅ Call initiated successfully:', { callId, roomId });
        
        setCurrentCall({
          call_id: callId,
          room_id: roomId
        });

        // Initialize peer connection
        await initiatePeerConnection(roomId);

        // If initiator (we started the call), proactively enter active state locally so teacher isn't stuck
        setCallState('active');
        startCallTimer();
        // Start polling for call acceptance/status updates and active-call details
        startCallStatusPolling(callId);
        startActiveCallPolling(callId);
        
        // Fetch session end time and start monitoring for both teacher and student
        if (sessionId) {
          try {
            const sessionResponse = await axios.get(`https://classmate-backend-eysi.onrender.com/api/sessions/${sessionId}`);
            if (sessionResponse.data.success && sessionResponse.data.session.end_time) {
              setSessionEndTime(sessionResponse.data.session.end_time);
              console.log('📅 Session end time:', sessionResponse.data.session.end_time);
              startSessionEndMonitoring();
            }
          } catch (err) {
            console.error('⚠️ Failed to fetch session end time:', err);
          }
        }
      } else {
        setError(response.data.error || 'Failed to initiate call');
        setCallState('idle');
      }
    } catch (err) {
      console.error('Error initiating call:', err);
      setError('Failed to initiate call');
      setCallState('idle');
    }
  };

  // If parent requests auto-start (e.g., teacher clicked Join), initiate the call
  useEffect(() => {
    if (autoStart && autoStartTrigger) {
      console.log('🔔 Auto-start trigger received, initiating call...');
      // Fire and forget; VideoCall will handle errors and state
      handleInitiateCall();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStartTrigger]);

  // Accept call
  const handleAcceptCall = async (callId) => {
    try {
      setError('');
      setCallState('active');
      setIncomingCall(null);

      const response = await axios.put(`https://classmate-backend-eysi.onrender.com/api/video-call/${callId}/accept`);

      if (response.data.success) {
        setCurrentCall(response.data.call);
        await initiatePeerConnection(response.data.call.room_id);
        startCallTimer();
        // Start polling during active call for mute-all updates
        startActiveCallPolling(response.data.call.call_id);
        
        // Mark attendance for student
        if (currentUserType === 'student' && sessionId && currentUserId) {
          try {
            const attendanceResponse = await axios.post('https://classmate-backend-eysi.onrender.com/api/attendance/mark-join', {
              session_id: sessionId,
              student_id: currentUserId
            });
            if (attendanceResponse.data.success) {
              console.log('✅ Attendance marked for student');
              const attId = attendanceResponse.data.attendance_id;
              setAttendanceId(attId);
              if (typeof onAttendanceMarked === 'function') {
                onAttendanceMarked(attId);
              }
            }
          } catch (err) {
            console.error('⚠️ Failed to mark attendance:', err);
          }
          
          // Fetch session details to get end_time
          try {
            const sessionResponse = await axios.get(`https://classmate-backend-eysi.onrender.com/api/sessions/${sessionId}`);
            if (sessionResponse.data.success && sessionResponse.data.session.end_time) {
              setSessionEndTime(sessionResponse.data.session.end_time);
              console.log('📅 Session end time:', sessionResponse.data.session.end_time);
              startSessionEndMonitoring();
            }
          } catch (err) {
            console.error('⚠️ Failed to fetch session end time:', err);
          }
        }
        
        // Notify parent that call is now active
        if (typeof onCallActive === 'function') {
          try { onCallActive(); } catch(e) { console.warn('onCallActive handler error', e); }
        }
      } else {
        setError(response.data.error || 'Failed to accept call');
        setCallState('idle');
      }
    } catch (err) {
      console.error('Error accepting call:', err);
      setError('Failed to accept call');
      setCallState('idle');
    }
  };

  // Decline call
  const handleDeclineCall = async (callId) => {
    try {
      await axios.put(`https://classmate-backend-eysi.onrender.com/api/video-call/${callId}/decline`);
      setIncomingCall(null);
    } catch (err) {
      console.error('Error declining call:', err);
    }
  };

  // End call
  const handleEndCall = async () => {
    try {
      if (currentCall) {
        await axios.put(`https://classmate-backend-eysi.onrender.com/api/video-call/${currentCall.call_id}/end`);
      }

      // Record leave time for student
      if (currentUserType === 'student' && sessionId && currentUserId) {
        try {
          const leaveResponse = await axios.put('https://classmate-backend-eysi.onrender.com/api/attendance/mark-leave', {
            session_id: sessionId,
            student_id: currentUserId
          });
          if (leaveResponse.data.success) {
            console.log('✅ Leave time recorded for student at:', new Date().toISOString());
          }
        } catch (err) {
          console.error('⚠️ Failed to record leave time:', err);
        }
      }

      // Stop all media tracks
      if (localVideoRef.current && localVideoRef.current.srcObject) {
        localVideoRef.current.srcObject.getTracks().forEach(track => track.stop());
      }
      if (remoteVideoRef.current && remoteVideoRef.current.srcObject) {
        remoteVideoRef.current.srcObject.getTracks().forEach(track => track.stop());
      }

      // Close peer connection
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }

      // Clear timers
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (activeCallPollRef.current) clearInterval(activeCallPollRef.current);
      if (sessionEndCheckRef.current) clearInterval(sessionEndCheckRef.current);

      if (onCallEnd) {
        onCallEnd();
      }

      setCallState('ended');
      setCurrentCall(null);
      setCallDuration(0);

      setTimeout(() => {
        setCallState('idle');
      }, 2000);

    } catch (err) {
      console.error('Error ending call:', err);
    }
  };

  // Toggle audio
  const toggleAudio = () => {
    // If teacher muted all, students cannot unmute themselves
    if (mutedAll && currentUserType === 'student') return;

    if (peerConnectionRef.current) {
      const audioTracks = peerConnectionRef.current.getSenders()
        .filter(sender => sender.track && sender.track.kind === 'audio');
      
      audioTracks.forEach(sender => {
        if (sender.track) {
          sender.track.enabled = !isAudioEnabled;
        }
      });
    }
    // Also update local media tracks
    muteLocalAudioTracks(isAudioEnabled);
    setIsAudioEnabled(!isAudioEnabled);
  };

  // Toggle video
  const toggleVideo = () => {
    if (peerConnectionRef.current) {
      const videoTracks = peerConnectionRef.current.getSenders()
        .filter(sender => sender.track && sender.track.kind === 'video');
      
      videoTracks.forEach(sender => {
        if (sender.track) {
          sender.track.enabled = !isVideoEnabled;
        }
      });
    }
    setIsVideoEnabled(!isVideoEnabled);
  };

  const toggleFullScreen = () => {
    try {
      const el = containerRef.current;
      if (!el) return;
      if (!document.fullscreenElement) {
        el.requestFullscreen?.();
      } else {
        document.exitFullscreen?.();
      }
    } catch (e) {
      console.error('Error toggling fullscreen:', e);
    }
  };

  const handleMuteAll = async () => {
    // Only allow teachers
    if (!showTeacherControls) return;
    try {
      if (!currentCall) return;
      if (mutedAll) {
        // Already muted, so unmute
        await axios.put(`https://classmate-backend-eysi.onrender.com/api/video-call/${currentCall.call_id}/unmute-all`);
        setMutedAll(false);
      } else {
        // Not muted, so mute
        await axios.put(`https://classmate-backend-eysi.onrender.com/api/video-call/${currentCall.call_id}/mute-all`);
        setMutedAll(true);
      }
    } catch (e) {
      console.error('Error toggling mute all:', e);
    }
  };

  // Start call timer
  const startCallTimer = () => {
    if (timerRef.current) return;
    timerRef.current = setInterval(() => {
      setCallDuration(prev => prev + 1);
    }, 1000);
  };

  // Poll for call status
  const startCallStatusPolling = (callId) => {
    pollIntervalRef.current = setInterval(async () => {
      try {
        const response = await axios.get(`https://classmate-backend-eysi.onrender.com/api/video-call/${callId}`);
        if (response.data.success) {
          const call = response.data.call;
          if (call.status === 'active') {
            setCallState('active');
            startCallTimer();
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
            // handle mute-all flag if present
            if (call.muted_all) {
              setMutedAll(true);
              if (currentUserType === 'student') {
                setIsAudioEnabled(false);
                muteLocalAudioTracks(true);
              }
            } else {
              setMutedAll(false);
            }
          } else if (call.status === 'declined') {
            setError('Call was declined');
            setCallState('idle');
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          }
        }
      } catch (err) {
        console.error('Error polling call status:', err);
      }
    }, 1000);
  };

  // Poll for pending calls
  useEffect(() => {
    const pollForCalls = async () => {
      try {
        // Prefer course-wide id (courseCode) so teacher->class calls are discoverable.
        // Fallback to explicit uid when courseCode is not available.
        const pollUserId = courseCode || uid || currentUserId;

        const response = await axios.get(
          `https://classmate-backend-eysi.onrender.com/api/video-call/pending/${encodeURIComponent(pollUserId)}/${currentUserType}`
        );
        if (response.data.success && response.data.calls.length > 0) {
          // Get the most recent pending call
          const call = response.data.calls[0];
          console.log('📞 Pending call received:', call);
          // Ignore calls that were initiated by the current user (prevents teacher seeing their own outgoing call)
          if (call.initiator_id && call.initiator_id === currentUserId) {
            // skip
          } else {
            if (!incomingCall || call.call_id !== incomingCall.call_id) {
              setIncomingCall(call);
              // notify parent that an incoming call exists
              if (typeof onIncomingCall === 'function') {
                try { onIncomingCall(call); } catch(e) { console.warn('onIncomingCall handler error', e); }
              }
            }
          }
        }
      } catch (err) {
        console.error('Error polling for calls:', err);
      }
    };

    pollForCalls();
    const interval = setInterval(pollForCalls, 2000);

    return () => clearInterval(interval);
  }, [currentUserId, currentUserType, incomingCall, courseCode]);

  // If parent requests auto-accept (student accepted via parent overlay), accept the incoming call
  useEffect(() => {
    if (autoAcceptTrigger) {
      autoAcceptHandledRef.current = false;
    }
  }, [autoAcceptTrigger]);

  useEffect(() => {
    if (autoAccept && incomingCall && !autoAcceptHandledRef.current) {
      autoAcceptHandledRef.current = true;
      console.log('🔔 Auto-accept enabled, accepting call...', incomingCall.call_id);
      handleAcceptCall(incomingCall.call_id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAccept, incomingCall]);

  // Format duration
  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };
  // Render based on call state - ONLY SHOW ACTIVE CALL INTERFACE
  // Skip calling/incoming modals - just show video call when active

  // Active call: main refined layout
  if (callState === 'active' && currentCall) {
    return (
      <div className="video-call-container active-call" ref={containerRef}>
        <header className="call-header">
          <div className="call-title">{otherUserName || otherUserId}</div>
          <div className="call-meta">{formatDuration(callDuration)}</div>
        </header>

        <div className="video-grid">
          <div className="video-main">
            <video ref={remoteVideoRef} autoPlay playsInline muted={false} className="video-element" />
            <div className="video-overlay-name">{otherUserName || otherUserId}</div>
          </div>

          <div className="video-pip">
            <video ref={localVideoRef} autoPlay playsInline muted={true} className="video-element small" />
            <div className="video-overlay-name">You</div>
          </div>
        </div>

        <div className="controls-float">
          <div className="control-buttons">
            <button className={`control-btn ${isAudioEnabled ? 'active' : ''}`} onClick={toggleAudio} title={isAudioEnabled ? 'Mute' : 'Unmute'}>
              <i className={`fa ${isAudioEnabled ? 'fa-microphone' : 'fa-microphone-slash'}`} />
            </button>
            <button className={`control-btn ${isVideoEnabled ? 'active' : ''}`} onClick={toggleVideo} title={isVideoEnabled ? 'Turn off video' : 'Turn on video'}>
              <i className={`fa ${isVideoEnabled ? 'fa-video' : 'fa-video-slash'}`} />
            </button>
            <button className="control-btn" onClick={toggleFullScreen} title="Fullscreen">
              <i className="fa fa-expand" />
            </button>
            {showTeacherControls && (
              <button className={`control-btn ${mutedAll ? 'active muted-all' : ''}`} onClick={handleMuteAll} title={mutedAll ? 'Unmute all' : 'Mute all'}>
                <i className={`fa ${mutedAll ? 'fa-volume-off' : 'fa-volume-up'}`} />
              </button>
            )}
            <button className="control-btn end-btn" onClick={handleEndCall} title="End call">
              <i className="fa fa-phone" />
            </button>
          </div>
        </div>

        {error && <div className="call-error">{error}</div>}
      </div>
    );
  }

  // Ended state
  if (callState === 'ended') {
    return (
      <div className="video-call-container ended-view">
        <div className="call-ended">
          <h2>Call Ended</h2>
          <p>Duration: {formatDuration(callDuration)}</p>
          <button className="call-btn retry-btn" onClick={() => { setCallState('idle'); setCallDuration(0); }}>Make Another Call</button>
        </div>
      </div>
    );
  }

  // Idle state (ready)
  // Call initiation is handled by MeetingRoom. VideoCall should not expose a second "Start Call" button.
  // Show clear waiting text depending on role instead.
  return (
    <div className="video-call-container idle-refined">
      <div className="idle-card">
        <div className="idle-title">Ready to Call</div>
        <div className="idle-sub">
          {currentUserType === 'teacher'
            ? 'Waiting for students to accept the call...'
            : 'Waiting for instructor to start the call...'}
        </div>
        <div className="idle-actions">
          {/* Intentionally no Start Call button here to avoid duplicate call initiation UI */}
        </div>
        {error && <div className="call-error">{error}</div>}
        <div className="call-debug-info">State: {callState} • Role: {showTeacherControls ? 'teacher' : 'student'}</div>
      </div>
    </div>
  );
};

export default VideoCall;
