window.global = window;
window.process = { env: {} };
import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
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
  autoStart = false,
  autoStartTrigger = 0
  , onIncomingCall, autoAccept = false, autoAcceptTrigger = 0, onCallActive,
  sessionId,
  onAttendanceMarked,
  initialAudioEnabled = true,
  initialVideoEnabled = true
}) => {
  const [callState, setCallState] = useState('idle'); // idle, calling, active, ended
  const [currentCall, setCurrentCall] = useState(null);
  const [isAudioEnabled, setIsAudioEnabled] = useState(initialAudioEnabled);
  const [isVideoEnabled, setIsVideoEnabled] = useState(initialVideoEnabled);
  const [callDuration, setCallDuration] = useState(0);
  const [error, setError] = useState('');
  const [pendingCalls, setPendingCalls] = useState([]);
  const [incomingCall, setIncomingCall] = useState(null);
  const [responderDetected, setResponderDetected] = useState(false); // Track if onCallActive was fired

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const remoteStreamRef = useRef(new MediaStream());
  const audioContextRef = useRef(null);
  const remoteAudioSourceRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const socketRef = useRef(null);
  const localStreamRef = useRef(null);
  const timerRef = useRef(null);
  const pollIntervalRef = useRef(null);
  const containerRef = useRef(null);
  const activeCallPollRef = useRef(null);
  const [mutedAll, setMutedAll] = useState(false);
  const autoAcceptHandledRef = useRef(false);
  const hasSentOfferRef = useRef(false);
  const autoStartHandledRef = useRef(false);
  const pendingIceCandidatesRef = useRef([]);
  const [attendanceId, setAttendanceId] = useState(null);
  const [sessionEndTime, setSessionEndTime] = useState(null);
  const sessionEndCheckRef = useRef(null);

  // Teacher check: simple and explicit
  const isTeacher = String(currentUserType || '').toLowerCase() === 'teacher';
  const sameUserId = (a, b) => String(a ?? '') === String(b ?? '');

  // Fallback: if you initiated the call and it's active, you can mute all
  const isCallInitiator = currentCall && sameUserId(currentUserId, currentCall.initiator_id);
  const showTeacherControls = isTeacher || isCallInitiator;

  const cleanupSocket = () => {
    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    hasSentOfferRef.current = false;
    pendingIceCandidatesRef.current = [];
  };

  const ensureAudioContext = async () => {
    try {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) return null;

      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContextCtor();
      }

      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      return audioContextRef.current;
    } catch (err) {
      console.warn('⚠️ Could not initialize audio context:', err);
      return null;
    }
  };

  const flushPendingIceCandidates = async () => {
    const peerConnection = peerConnectionRef.current;

    if (!peerConnection || !peerConnection.currentRemoteDescription) return;

    const pendingCandidates = pendingIceCandidatesRef.current;
    pendingIceCandidatesRef.current = [];

    for (const candidate of pendingCandidates) {
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('Error flushing ICE candidate:', err);
      }
    }
  };

  const createAndSendOffer = async (roomId) => {
    const peerConnection = peerConnectionRef.current;
    const socket = socketRef.current;

    if (!peerConnection || !socket || hasSentOfferRef.current) return;

    hasSentOfferRef.current = true;

    try {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      socket.emit('offer', {
        room_id: roomId,
        offer: peerConnection.localDescription
      });
    } catch (err) {
      console.error('Error creating/sending offer:', err);
      setError('Failed to start video negotiation');
    }
  };

  const handleReceivedOffer = async (roomId, offer) => {
    const peerConnection = peerConnectionRef.current;
    const socket = socketRef.current;

    if (!peerConnection || !socket) return;

    try {
      if (peerConnection.signalingState !== 'stable') {
        return;
      }

      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      await flushPendingIceCandidates();
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      socket.emit('answer', {
        room_id: roomId,
        answer: peerConnection.localDescription
      });
    } catch (err) {
      console.error('Error handling offer:', err);
      setError('Failed to answer the video call');
    }
  };

  const handleReceivedAnswer = async (answer) => {
    const peerConnection = peerConnectionRef.current;

    if (!peerConnection) return;

    try {
      if (peerConnection.currentRemoteDescription) return;
      await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      await flushPendingIceCandidates();
    } catch (err) {
      console.error('Error handling answer:', err);
      setError('Failed to connect audio/video');
    }
  };

  const handleReceivedIceCandidate = async (candidate) => {
    const peerConnection = peerConnectionRef.current;

    if (!peerConnection || !candidate) return;

    try {
      if (!peerConnection.currentRemoteDescription) {
        pendingIceCandidatesRef.current.push(candidate);
        return;
      }

      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error('Error adding ICE candidate:', err);
    }
  };

  const setupSignaling = (callData) => {
    if (!callData?.room_id) return;

    cleanupSocket();

    const socket = io('https://classmate-backend-eysi.onrender.com', {
      transports: ['polling', 'websocket'],  // polling first, then upgrade
      withCredentials: false,  // Change to false for Render
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      timeout: 20000
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join_video_call', {
        call_id: callData.call_id,
        room_id: callData.room_id,
        user_id: currentUserId,
        user_type: currentUserType
      });
    });

    socket.on('user_joined', () => {
      if (sameUserId(currentUserId, callData.initiator_id)) {
        createAndSendOffer(callData.room_id);
      }
    });

    socket.on('offer', async (data) => {
      if (!sameUserId(currentUserId, callData.initiator_id)) {
        await handleReceivedOffer(callData.room_id, data.offer);
      }
    });

    socket.on('answer', async (data) => {
      if (sameUserId(currentUserId, callData.initiator_id)) {
        await handleReceivedAnswer(data.answer);
      }
    });

    socket.on('ice_candidate', async (data) => {
      await handleReceivedIceCandidate(data.candidate);
    });

    socket.on('connect_error', (err) => {
      console.error('Socket connection error:', err);
      setError('Could not connect to the video call service');
    });
  };

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
  const initiatePeerConnection = async (callData) => {
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
          video: isVideoEnabled ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
          audio: isAudioEnabled
        });
        localStreamRef.current = localStream;

        console.log('✅ Local stream acquired:', localStream);
        console.log('📹 Video tracks:', localStream.getVideoTracks());
        console.log('🎤 Audio tracks:', localStream.getAudioTracks());

        if (isAudioEnabled && localStream.getAudioTracks().length === 0) {
          setError('Microphone access is unavailable. Please allow audio permissions and try again.');
          return false;
        }

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
        const mediaErrorMessage = err?.name === 'NotAllowedError'
          ? 'Camera or microphone access was blocked. Please allow permissions in the browser.'
          : err?.name === 'NotReadableError'
            ? 'Camera or microphone is already in use by another tab or app.'
            : err?.name === 'NotFoundError'
              ? 'No camera or microphone device was found on this system.'
              : 'Cannot access camera or microphone. Please check permissions and device availability.';
        setError(mediaErrorMessage);
        return false;
      }

      // Handle remote stream
      peerConnection.ontrack = (event) => {
        console.log('🎥 Remote track received:', event.track.kind);
        if (event.track) {
          remoteStreamRef.current.addTrack(event.track);
        }

        const remoteStream = remoteStreamRef.current;

        if (event.track.kind === 'audio' && audioContextRef.current && !remoteAudioSourceRef.current) {
          try {
            remoteAudioSourceRef.current = audioContextRef.current.createMediaStreamSource(remoteStream);
            remoteAudioSourceRef.current.connect(audioContextRef.current.destination);
          } catch (err) {
            console.warn('⚠️ Could not connect remote audio stream:', err);
          }
        }

        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = remoteStream;
          if (!audioContextRef.current) {
            remoteAudioRef.current.muted = false;
            remoteAudioRef.current.play().catch(e => console.error('Error playing remote audio:', e));
          }
        }
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;
          console.log('📺 Remote video srcObject set');
          // Force video to play
          remoteVideoRef.current.play().catch(e => console.error('Error playing remote video:', e));
        }
      };

      // Handle ICE candidates
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          console.log('New ICE candidate:', event.candidate);
          if (socketRef.current && callData?.room_id) {
            socketRef.current.emit('ice_candidate', {
              room_id: callData.room_id,
              candidate: event.candidate
            });
          }
        }
      };

      setupSignaling(callData);

      // Handle connection state changes
      peerConnection.onconnectionstatechange = () => {
        console.log('Connection state:', peerConnection.connectionState);
        if (peerConnection.connectionState === 'failed' ||
          peerConnection.connectionState === 'disconnected') {
          handleEndCall();
        }
      };

      return true;

    } catch (err) {
      console.error('Error initiating peer connection:', err);
      setError('Failed to initialize peer connection');
      return false;
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
            try { onCallActive(); } catch (e) { console.warn('onCallActive handler error', e); }
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
      await ensureAudioContext();

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
        const peerReady = await initiatePeerConnection({
          call_id: callId,
          room_id: roomId,
          initiator_id: currentUserId
        });

        if (!peerReady) {
          setCallState('idle');
          return;
        }

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
            // Use optional chaining to safely access nested properties
            if (sessionResponse?.data?.success && sessionResponse?.data?.session?.end_time) {
              setSessionEndTime(sessionResponse.data.session.end_time);
              console.log('📅 Session end time:', sessionResponse.data.session.end_time);
              startSessionEndMonitoring();
            } else {
              console.warn('⚠️ Session object incomplete or missing end_time:', sessionResponse?.data?.session);
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
    autoStartHandledRef.current = false;
  }, [autoStartTrigger]);

  useEffect(() => {
    if (autoStart && autoStartTrigger && !autoStartHandledRef.current) {
      autoStartHandledRef.current = true;
      console.log('🔔 Auto-start trigger received, initiating call...');
      // Fire and forget; VideoCall will handle errors and state
      handleInitiateCall();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, autoStartTrigger]);

  // Accept call
  const handleAcceptCall = async (callId) => {
    try {
      setError('');
      setCallState('active');
      setIncomingCall(null);
      await ensureAudioContext();

      const response = await axios.put(`https://classmate-backend-eysi.onrender.com/api/video-call/${callId}/accept`);

      if (response.data.success) {
        setCurrentCall(response.data.call);
        const peerReady = await initiatePeerConnection(response.data.call);
        if (!peerReady) {
          setCallState('idle');
          return;
        }
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
            // Use optional chaining to safely access nested properties
            if (sessionResponse?.data?.success && sessionResponse?.data?.session?.end_time) {
              setSessionEndTime(sessionResponse.data.session.end_time);
              console.log('📅 Session end time:', sessionResponse.data.session.end_time);
              startSessionEndMonitoring();
            } else {
              console.warn('⚠️ Session object incomplete or missing end_time:', sessionResponse?.data?.session);
            }
          } catch (err) {
            console.error('⚠️ Failed to fetch session end time:', err);
          }
        }

        // Notify parent that call is now active
        if (typeof onCallActive === 'function') {
          try { onCallActive(); } catch (e) { console.warn('onCallActive handler error', e); }
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
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      } else if (localVideoRef.current && localVideoRef.current.srcObject) {
        localVideoRef.current.srcObject.getTracks().forEach(track => track.stop());
      }
      if (remoteVideoRef.current && remoteVideoRef.current.srcObject) {
        remoteVideoRef.current.srcObject.getTracks().forEach(track => track.stop());
      }
      remoteStreamRef.current = new MediaStream();
      if (remoteAudioSourceRef.current) {
        try {
          remoteAudioSourceRef.current.disconnect();
        } catch (e) {
          console.warn('⚠️ Error disconnecting remote audio source:', e);
        }
        remoteAudioSourceRef.current = null;
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        try {
          await audioContextRef.current.close();
        } catch (e) {
          console.warn('⚠️ Error closing audio context:', e);
        }
        audioContextRef.current = null;
      }

      // Close peer connection
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }

      cleanupSocket();

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
          if (call.initiator_id && sameUserId(call.initiator_id, currentUserId)) {
            // skip
          } else {
            if (!incomingCall || call.call_id !== incomingCall.call_id) {
              setIncomingCall(call);
              // notify parent that an incoming call exists
              if (typeof onIncomingCall === 'function') {
                try { onIncomingCall(call); } catch (e) { console.warn('onIncomingCall handler error', e); }
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
            <video ref={remoteVideoRef} autoPlay playsInline muted={true} className="video-element" />
            <audio ref={remoteAudioRef} autoPlay playsInline muted={true} style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }} />
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
