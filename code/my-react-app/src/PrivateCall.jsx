window.global = window;
window.process = { env: {} };

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Peer from 'simple-peer';
import { FaMicrophone, FaMicrophoneSlash, FaVideo, FaVideoSlash, FaPhoneSlash } from 'react-icons/fa';
import './privateCall.css';

const getStreamConstraints = (callType) => ({
  audio: true,
  video: String(callType || 'video').toLowerCase() !== 'voice'
});

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

const PrivateCall = ({ currentUser, call, socket, onEnd }) => {
  const callType = useMemo(() => String(call?.call_type || 'video').toLowerCase(), [call]);
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

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const startedRef = useRef(false);
  const pendingSignalsRef = useRef([]);
  const ringTimerRef = useRef(null);
  const ringAudioCtxRef = useRef(null);
  const ringCountRef = useRef(0);
  const endedRef = useRef(false);
  const elapsedTimerRef = useRef(null);
  const statusRef = useRef(status);

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

  const cleanupPeer = useCallback((notifyEnd = false, reason = 'ended') => {
    if (endedRef.current && notifyEnd) return;
    endedRef.current = true;

    if (peerRef.current) {
      try {
        peerRef.current.removeAllListeners();
        peerRef.current.destroy();
      } catch (error) {
        console.warn('Private peer cleanup warning:', error);
      }
    }
    peerRef.current = null;
    pendingSignalsRef.current = [];

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

    if (notifyEnd && socket && call) {
      socket.emit('private_call_end', {
        room_id: call.room_id,
        user_id: currentUser?.id,
        reason
      });
    }

    if (notifyEnd && typeof onEnd === 'function') {
      onEnd();
    }
  }, [call, currentUser?.id, onEnd, socket, stopRingtone]);

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

  const startPeer = useCallback(async () => {
    if (startedRef.current || !socket || !call || !currentUser) return;
    startedRef.current = true;

    try {
      const stream = await navigator.mediaDevices.getUserMedia(getStreamConstraints(callType));
      localStreamRef.current = stream;
      setLocalStreamReady(true);
      setAudioEnabled(true);
      setVideoEnabled(!isVoiceCall);

      attachLocalStream(stream);

      const peer = new Peer({
        initiator: isInitiator,
        trickle: true,
        stream,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478?transport=udp' }
          ]
        }
      });

      peer.on('signal', (signal) => {
        socket.emit('private_call_signal', {
          room_id: call.room_id,
          from_user_id: currentUser.id,
          signal
        });
      });

      peer.on('stream', (remoteStream) => {
        attachRemoteStream(remoteStream);
      });

      peer.on('connect', () => {
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
      });

      peer.on('close', () => cleanupPeer(true, 'peer_closed'));
      peer.on('error', (error) => {
        console.error('Private call peer error:', error);
        setStatus('error');
        cleanupPeer(true, 'peer_error');
      });

      peerRef.current = peer;

      pendingSignalsRef.current.forEach((signal) => {
        try {
          peer.signal(signal);
        } catch (error) {
          console.warn('Pending signal apply failed:', error);
        }
      });
      pendingSignalsRef.current = [];
    } catch (error) {
      console.error('Failed to start private call peer:', error);
      setStatus('error');
      cleanupPeer(true, 'media_error');
    }
  }, [attachLocalStream, attachRemoteStream, call, callType, cleanupPeer, currentUser, isInitiator, isVoiceCall, socket, startedAt, stopRingtone]);

  useEffect(() => {
    if (!socket || !call || !currentUser) return undefined;

    const onReady = (payload) => {
      if (String(payload?.room_id || '') !== String(call.room_id || '')) return;
      if (isInitiator) {
        setStatus('calling');
      } else {
        setStatus('connecting');
      }
      void startPeer();
    };

    const onSignal = (payload) => {
      if (String(payload?.room_id || '') !== String(call.room_id || '')) return;
      if (String(payload?.from_user_id || '') === String(currentUser.id || '')) return;
      const signal = payload?.signal;
      if (!signal) return;

      if (peerRef.current) {
        try {
          peerRef.current.signal(signal);
        } catch (error) {
          console.warn('Private call signal apply failed:', error);
        }
      } else {
        pendingSignalsRef.current.push(signal);
      }
    };

    const onEnded = (payload) => {
      if (String(payload?.room_id || '') !== String(call.room_id || '')) return;
      cleanupPeer(false);
      if (typeof onEnd === 'function') onEnd();
    };

    socket.on('private_call_ready', onReady);
    socket.on('private_call_signal', onSignal);
    socket.on('private_call_ended', onEnded);

    socket.emit('private_call_join', {
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
          const oscillator = ctx.createOscillator();
          const gain = ctx.createGain();
          oscillator.type = 'sine';
          oscillator.frequency.value = 440;
          gain.gain.value = 0.0001;
          oscillator.connect(gain);
          gain.connect(ctx.destination);
          oscillator.start();
          const now = ctx.currentTime;
          gain.gain.setValueAtTime(0.0001, now);
          gain.gain.linearRampToValueAtTime(0.06, now + 0.05);
          gain.gain.linearRampToValueAtTime(0.0001, now + 0.55);
          oscillator.stop(now + 0.6);
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
          cleanupPeer(true, 'no_answer');
        }
      }, 2000);
    }

    return () => {
      socket.off('private_call_ready', onReady);
      socket.off('private_call_signal', onSignal);
      socket.off('private_call_ended', onEnded);
      socket.emit('private_call_leave', {
        room_id: call.room_id,
        user_id: currentUser.id,
        user_type: currentUser.type
      });
      cleanupPeer(false);
    };
  }, [call, callType, cleanupPeer, currentUser, isInitiator, onEnd, socket, startPeer]);

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
    cleanupPeer(true, 'hangup');
  }, [cleanupPeer]);

  return (
    <div className="private-call-shell">
      <div className="private-call-header">
        <div>
          <div className="private-call-title">{isVoiceCall ? 'Voice call' : 'Video call'}</div>
          <div className="private-call-subtitle">{displayName}</div>
        </div>
        <div className="private-call-status">
          <div>{status === 'active' ? 'In call' : status === 'calling' ? 'Calling...' : status === 'ringing' ? 'Ringing...' : status}</div>
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
              <p>{status === 'active' ? `Started ${startedAtText || formatPKTTime(startedAt)} PKT` : status === 'calling' ? 'Calling...' : 'Ringing...'}</p>
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