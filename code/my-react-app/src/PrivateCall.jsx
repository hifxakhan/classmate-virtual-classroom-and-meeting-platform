import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FaMicrophone, FaMicrophoneSlash, FaVideo, FaVideoSlash, FaPhoneSlash } from 'react-icons/fa';
import { io } from 'socket.io-client';
import './privateCall.css';

const SFU_SOCKET_URL = import.meta.env.VITE_SFU_URL || 'http://localhost:4001';

const getStreamConstraints = (callType) => ({
  audio: true,
  video: !['voice', 'audio'].includes(String(callType || 'video').toLowerCase())
});

const normalizeCallType = (value, fallback = 'video') => {
  const raw = String(value || fallback).trim().toLowerCase();
  if (raw === 'voice' || raw === 'audio') return 'voice';
  return 'video';
};

const stopStream = (stream) => {
  if (!stream) return;
  stream.getTracks().forEach((track) => track.stop());
};

const formatPKTTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-PK', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Karachi'
  });
};

const formatElapsed = (value) => {
  if (!value) return '00:00';
  const started = new Date(value).getTime();
  if (Number.isNaN(started)) return '00:00';
  const totalSeconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
};

const getStatusLabel = (status) => {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'active') return 'In call';
  if (normalized === 'calling') return 'Calling...';
  if (normalized === 'ringing') return 'Ringing...';
  if (normalized === 'connecting') return 'Connecting...';
  if (normalized === 'ended') return 'Call ended';
  if (normalized === 'error') return 'Call failed';
  return 'Connecting...';
};

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478?transport=udp' }
  ]
};

const PrivateCall = ({ currentUser, call, onEnd }) => {
  const callType = useMemo(() => normalizeCallType(call?.call_type || call?.preferred_call_type || 'video'), [call]);
  const isVoiceCall = callType === 'voice';
  const isInitiator = String(currentUser?.id || '') === String(call?.initiator_id || '');
  const displayName = useMemo(() => {
    if (isInitiator) return String(call?.receiver_name || call?.other_user_name || call?.receiver_id || 'User');
    return String(call?.initiator_name || call?.other_user_name || call?.initiator_id || 'User');
  }, [call, isInitiator]);
  const startedAt = useMemo(() => call?.started_at || call?.created_at || null, [call]);

  const [status, setStatus] = useState(isInitiator ? 'calling' : 'connecting');
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(!isVoiceCall);
  const [localStreamReady, setLocalStreamReady] = useState(false);
  const [remoteStreamReady, setRemoteStreamReady] = useState(false);
  const [elapsedText, setElapsedText] = useState('00:00');
  const [startedAtText, setStartedAtText] = useState(formatPKTTime(startedAt));
  const [callError, setCallError] = useState('');

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const startedRef = useRef(false);
  const ringTimerRef = useRef(null);
  const ringAudioCtxRef = useRef(null);
  const ringCountRef = useRef(0);
  const endedRef = useRef(false);
  const elapsedTimerRef = useRef(null);
  const statusRef = useRef(status);
  const sfuSocketRef = useRef(null);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const stopRingtone = useCallback(() => {
    if (ringTimerRef.current) {
      clearInterval(ringTimerRef.current);
      ringTimerRef.current = null;
    }
    ringCountRef.current = 0;
    if (ringAudioCtxRef.current) {
      try {
        ringAudioCtxRef.current.close();
      } catch (error) {
        console.warn('Ringtone close warning:', error);
      }
      ringAudioCtxRef.current = null;
    }
  }, []);

  const cleanupCall = useCallback((notifyEnd = false, reason = 'ended') => {
    if (endedRef.current && notifyEnd) return;
    endedRef.current = true;

    if (peerConnectionRef.current) {
      try {
        peerConnectionRef.current.onicecandidate = null;
        peerConnectionRef.current.ontrack = null;
        peerConnectionRef.current.oniceconnectionstatechange = null;
        peerConnectionRef.current.close();
      } catch (e) {
        console.warn('Peer connection cleanup warning:', e);
      }
    }
    peerConnectionRef.current = null;

    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }

    stopRingtone();
    stopStream(localStreamRef.current);
    localStreamRef.current = null;

    setStatus('ended');
    setLocalStreamReady(false);
    setRemoteStreamReady(false);
    setCallError('');

    const sfuSocket = sfuSocketRef.current;
    if (notifyEnd && sfuSocket && call) {
      sfuSocket.emit('private_call_end', {
        room_id: call.room_id,
        user_id: currentUser?.id,
        reason
      });
    }

    if (notifyEnd && typeof onEnd === 'function') {
      onEnd();
    }
  }, [call, currentUser?.id, onEnd, stopRingtone]);

  const attachLocalStream = useCallback((stream) => {
    const videoEl = localVideoRef.current;
    if (!videoEl || isVoiceCall) return;
    videoEl.srcObject = stream;
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.autoplay = true;
    videoEl.play().catch(() => {});
  }, [isVoiceCall]);

  const attachRemoteStream = useCallback((stream) => {
    if (!stream) return;
    if (isVoiceCall) {
      const audioEl = remoteAudioRef.current;
      if (!audioEl) return;
      audioEl.srcObject = stream;
      audioEl.autoplay = true;
      audioEl.playsInline = true;
      audioEl.muted = false;
      audioEl.play().catch(() => {});
      setRemoteStreamReady(true);
      return;
    }

    const videoEl = remoteVideoRef.current;
    if (!videoEl) return;
    videoEl.srcObject = stream;
    videoEl.autoplay = true;
    videoEl.playsInline = true;
    videoEl.muted = false;
    videoEl.play().catch(() => {});
    setRemoteStreamReady(true);
  }, [isVoiceCall]);

  const createPeerConnection = useCallback((stream) => {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    peerConnectionRef.current = pc;

    // Add local stream tracks to peer connection
    stream.getTracks().forEach((track) => {
      pc.addTrack(track, stream);
    });

    // Handle incoming remote stream
    pc.ontrack = (event) => {
      const remoteStream = event.streams?.[0];
      if (remoteStream) {
        attachRemoteStream(remoteStream);
      }
    };

    // Send ICE candidates to the other peer via socket
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const sfuSocket = sfuSocketRef.current;
        if (sfuSocket && call) {
          sfuSocket.emit('private_call_signal', {
            room_id: call.room_id,
            from_user_id: currentUser?.id,
            signal: { type: 'candidate', candidate: event.candidate }
          });
        }
      }
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      console.log('ICE connection state:', state);
      if (state === 'connected' || state === 'completed') {
        stopRingtone();
        setStatus('active');
        if (startedAt) {
          setStartedAtText(formatPKTTime(startedAt));
          setElapsedText(formatElapsed(startedAt));
          if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
          elapsedTimerRef.current = setInterval(() => {
            setElapsedText(formatElapsed(startedAt));
          }, 1000);
        }
      } else if (state === 'failed' || state === 'disconnected') {
        console.error('ICE connection failed:', state);
        setCallError('Call connection failed. Please try again.');
        setStatus('error');
        cleanupCall(true, 'ice_failed');
      } else if (state === 'closed') {
        cleanupCall(false);
      }
    };

    return pc;
  }, [attachRemoteStream, call, currentUser?.id, startedAt, stopRingtone, cleanupCall]);

  const startPeer = useCallback(async () => {
    if (startedRef.current || !call || !currentUser) return;
    startedRef.current = true;

    try {
      // Get local media stream
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(getStreamConstraints(callType));
      } catch (mediaErr) {
        console.error('Media access denied:', mediaErr);
        setCallError(`Cannot access ${isVoiceCall ? 'microphone' : 'camera/microphone'}. Please allow permissions and try again.`);
        setStatus('error');
        startedRef.current = false;
        return;
      }

      localStreamRef.current = stream;
      setLocalStreamReady(true);
      setAudioEnabled(true);
      setVideoEnabled(!isVoiceCall);
      setCallError('');
      attachLocalStream(stream);

      // Create peer connection
      const pc = createPeerConnection(stream);

      if (isInitiator) {
        // Create offer
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        // Send offer via socket
        const sfuSocket = sfuSocketRef.current;
        if (sfuSocket) {
          sfuSocket.emit('private_call_signal', {
            room_id: call.room_id,
            from_user_id: currentUser.id,
            signal: { type: 'offer', sdp: pc.localDescription }
          });
        }
      }
    } catch (error) {
      console.error('Failed to start peer connection:', error);
      setCallError('Failed to start call. Please try again.');
      setStatus('error');
      cleanupCall(true, 'media_error');
    }
  }, [call, callType, currentUser, isInitiator, isVoiceCall, attachLocalStream, createPeerConnection, cleanupCall]);

  // Handle incoming signals (offer, answer, ICE candidates)
  const handleSignal = useCallback(async (payload) => {
    if (String(payload?.room_id || '') !== String(call?.room_id || '')) return;
    if (String(payload?.from_user_id || '') === String(currentUser?.id || '')) return;

    const signal = payload?.signal;
    if (!signal) return;

    const pc = peerConnectionRef.current;
    if (!pc) return;

    try {
      if (signal.type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        const sfuSocket = sfuSocketRef.current;
        if (sfuSocket && call) {
          sfuSocket.emit('private_call_signal', {
            room_id: call.room_id,
            from_user_id: currentUser?.id,
            signal: { type: 'answer', sdp: pc.localDescription }
          });
        }
      } else if (signal.type === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      } else if (signal.type === 'candidate') {
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      }
    } catch (error) {
      console.warn('Signal handling failed:', error);
    }
  }, [call, currentUser?.id]);

  useEffect(() => {
    if (!call || !currentUser) return undefined;

    const sfuSocket = io(SFU_SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 500
    });
    sfuSocketRef.current = sfuSocket;

    const onReady = (payload) => {
      if (String(payload?.room_id || '') !== String(call.room_id || '')) return;
      if (isInitiator) {
        stopRingtone();
        setStatus('connecting');
      } else {
        setStatus('connecting');
      }
      void startPeer();
    };

    const onSignal = (payload) => {
      void handleSignal(payload);
    };

    const onEnded = (payload) => {
      if (String(payload?.room_id || '') !== String(call.room_id || '')) return;
      cleanupCall(false);
      if (typeof onEnd === 'function') onEnd();
    };

    sfuSocket.on('private_call_ready', onReady);
    sfuSocket.on('private_call_signal', onSignal);
    sfuSocket.on('private_call_ended', onEnded);

    sfuSocket.emit('private_call_join', {
      room_id: call.room_id,
      call_id: call.call_id,
      user_id: currentUser.id,
      user_type: currentUser.type,
      call_type: callType
    });

    if (isInitiator) {
      const playRing = async () => {
        try {
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          if (!AudioContextClass) return;
          if (!ringAudioCtxRef.current) ringAudioCtxRef.current = new AudioContextClass();
          const ctx = ringAudioCtxRef.current;
          if (ctx.state === 'suspended') await ctx.resume();
          const now = ctx.currentTime;
          const makeTone = (freq, startOffset, duration) => {
            const oscillator = ctx.createOscillator();
            const gain = ctx.createGain();
            oscillator.type = 'sine';
            oscillator.frequency.value = freq;
            oscillator.connect(gain);
            gain.connect(ctx.destination);
            gain.gain.setValueAtTime(0.0001, now + startOffset);
            gain.gain.linearRampToValueAtTime(0.028, now + startOffset + 0.03);
            gain.gain.linearRampToValueAtTime(0.0001, now + startOffset + duration);
            oscillator.start(now + startOffset);
            oscillator.stop(now + startOffset + duration + 0.02);
          };

          makeTone(460, 0, 0.25);
          makeTone(390, 0.3, 0.25);
        } catch (error) {
          console.warn('Ringtone error:', error);
        }
      };

      void playRing();
      if (ringTimerRef.current) clearInterval(ringTimerRef.current);
      ringCountRef.current = 0;
      ringTimerRef.current = setInterval(() => {
        ringCountRef.current += 1;
        void playRing();
        if (ringCountRef.current >= 10 && statusRef.current !== 'active') {
          cleanupCall(true, 'no_answer');
        }
      }, 2800);
    }

    return () => {
      sfuSocket.off('private_call_ready', onReady);
      sfuSocket.off('private_call_signal', onSignal);
      sfuSocket.off('private_call_ended', onEnded);
      sfuSocket.emit('private_call_leave', {
        room_id: call.room_id,
        user_id: currentUser.id,
        user_type: currentUser.type
      });
      sfuSocket.disconnect();
      sfuSocketRef.current = null;
      cleanupCall(false);
    };
  }, [call, callType, cleanupCall, currentUser, handleSignal, isInitiator, onEnd, startPeer, stopRingtone]);

  const toggleAudio = useCallback(() => {
    const next = !audioEnabled;
    setAudioEnabled(next);
    const stream = localStreamRef.current;
    if (stream) {
      stream.getAudioTracks().forEach((track) => {
        track.enabled = next;
      });
    }
  }, [audioEnabled]);

  const toggleVideo = useCallback(() => {
    if (isVoiceCall) return;
    const next = !videoEnabled;
    setVideoEnabled(next);
    const stream = localStreamRef.current;
    if (stream) {
      stream.getVideoTracks().forEach((track) => {
        track.enabled = next;
      });
    }
  }, [isVoiceCall, videoEnabled]);

  const leaveCall = useCallback(() => {
    cleanupCall(true, 'hangup');
  }, [cleanupCall]);

  // Error display
  if (callError) {
    return (
      <div className="private-call-shell">
        <div className="private-call-header">
          <div>
            <div className="private-call-title">Call Error</div>
            <div className="private-call-subtitle">{displayName}</div>
          </div>
        </div>
        <div className="private-call-stage voice-only">
          <div className="private-call-voice-panel">
            <div style={{ color: '#d32f2f', padding: '1rem', textAlign: 'center' }}>
              <p style={{ fontSize: '1rem', marginBottom: '1rem' }}>{callError}</p>
              <button className="private-call-btn end" onClick={leaveCall} type="button">Back to Chat</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="private-call-shell">
      <div className="private-call-header">
        <div>
          <div className="private-call-title">{isVoiceCall ? 'Voice call' : 'Video call'}</div>
          <div className="private-call-subtitle">{displayName}</div>
        </div>
        <div className="private-call-status">
          <div>{getStatusLabel(status)}</div>
          {startedAt ? <div>{startedAtText || formatPKTTime(startedAt)} PKT</div> : null}
        </div>
      </div>

      <div className={`private-call-stage ${isVoiceCall ? 'voice-only' : 'video-mode'}`}>
        {!isVoiceCall ? (
          <div className="private-call-video-panel">
            <video ref={remoteVideoRef} className="private-call-remote-video" autoPlay playsInline />
            <div className="private-call-local-preview">
              <video ref={localVideoRef} className="private-call-local-video" autoPlay playsInline muted />
            </div>
          </div>
        ) : (
          <div className="private-call-voice-panel">
            <div className="private-call-avatar">{String(displayName || 'C').slice(0, 1).toUpperCase()}</div>
            <div className="private-call-voice-copy">
              <h3>{displayName}</h3>
              <p>{status === 'active' ? `Started ${startedAtText || formatPKTTime(startedAt)} PKT` : getStatusLabel(status)}</p>
              <p className="private-call-elapsed">{status === 'active' ? elapsedText : '00:00'}</p>
            </div>
            <audio ref={remoteAudioRef} />
          </div>
        )}
      </div>

      <div className="private-call-controls">
        <button className={`private-call-btn ${audioEnabled ? 'active' : 'muted'}`} onClick={toggleAudio} type="button" title="Toggle microphone">
          {audioEnabled ? <FaMicrophone /> : <FaMicrophoneSlash />}
        </button>
        {!isVoiceCall ? (
          <button className={`private-call-btn ${videoEnabled ? 'active' : 'muted'}`} onClick={toggleVideo} type="button" title="Toggle camera">
            {videoEnabled ? <FaVideo /> : <FaVideoSlash />}
          </button>
        ) : null}
        <button className="private-call-btn end" onClick={leaveCall} type="button" title="End call">
          <FaPhoneSlash />
        </button>
      </div>

      {localStreamReady ? null : <div className="private-call-hint">Requesting media permissions...</div>}
      {!isVoiceCall && remoteStreamReady ? <div className="private-call-hint">Remote video connected.</div> : null}
    </div>
  );
};

export default PrivateCall;
