window.global = window;
window.process = { env: {} };

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { Room, RoomEvent, Track } from 'livekit-client';
import VideoGrid from './VideoGrid';
import './videoCall.css';

const buildRoomName = ({ sessionId, courseCode, otherUserId }) => {
  if (sessionId) return `session_${sessionId}`;
  if (courseCode) return `course_${courseCode}`;
  return `call_${otherUserId || 'general'}`;
};

const VideoCall = ({
  currentUserId,
  currentUserType,
  uid,
  courseCode,
  otherUserId,
  onCallEnd,
  onCallActive,
  autoStart = false,
  autoStartTrigger = 0,
  sessionId,
  initialAudioEnabled = true,
  initialVideoEnabled = true
}) => {
  const [callState, setCallState] = useState('idle');
  const [error, setError] = useState('');
  const [participants, setParticipants] = useState([]);
  const [isAudioEnabled, setIsAudioEnabled] = useState(initialAudioEnabled);
  const [isVideoEnabled, setIsVideoEnabled] = useState(initialVideoEnabled);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isGridCompact, setIsGridCompact] = useState(false);

  const roomRef = useRef(null);
  const signalingRef = useRef(null);
  const autoStartHandledRef = useRef(false);

  const identity = useMemo(() => String(uid || currentUserId || 'anonymous'), [uid, currentUserId]);
  const roomName = useMemo(
    () => buildRoomName({ sessionId, courseCode, otherUserId }),
    [sessionId, courseCode, otherUserId]
  );

  const livekitUrl = import.meta.env.VITE_LIVEKIT_URL;
  const sfuAuthUrl = import.meta.env.VITE_SFU_AUTH_URL || 'http://localhost:4001';
  const sfuSignalUrl = import.meta.env.VITE_SFU_SIGNALING_URL || 'http://localhost:4001';

  const refreshParticipants = useCallback(() => {
    const room = roomRef.current;
    if (!room) {
      setParticipants([]);
      return;
    }

    const all = [room.localParticipant, ...Array.from(room.remoteParticipants.values())].map((p) => {
      const pubs = Array.from(p.trackPublications.values());
      const videoPub = pubs.find((pub) => pub.kind === Track.Kind.Video);
      const audioPub = pubs.find((pub) => pub.kind === Track.Kind.Audio);

      let parsedRole = 'student';
      try {
        parsedRole = p.metadata ? JSON.parse(p.metadata || '{}').role || 'student' : 'student';
      } catch (_e) {
        parsedRole = 'student';
      }

      return {
        identity: p.identity,
        name: p.name || p.identity,
        isLocal: p.isLocal,
        role: parsedRole,
        isVideoEnabled: !!videoPub && !videoPub.isMuted,
        isAudioEnabled: !!audioPub && !audioPub.isMuted,
        videoTrack: videoPub?.track || null,
        audioTrack: audioPub?.track || null
      };
    });

    setParticipants(all);
  }, []);

  const cleanupCall = useCallback(async () => {
    const room = roomRef.current;
    const signaling = signalingRef.current;

    try {
      if (room) {
        await room.disconnect();
      }
    } catch (err) {
      console.warn('Room disconnect warning:', err);
    }

    if (signaling) {
      signaling.emit('leave-room', { roomName, identity });
      signaling.disconnect();
      signalingRef.current = null;
    }

    roomRef.current = null;
    setParticipants([]);
    setCallState('idle');
    setIsConnecting(false);
  }, [identity, roomName]);

  const connectSignaling = useCallback(() => {
    const socket = io(sfuSignalUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true
    });

    socket.on('connect', () => {
      socket.emit('join-room', {
        roomName,
        identity,
        name: identity,
        role: currentUserType || 'student'
      });
    });

    socket.on('participant-state-changed', () => {
      refreshParticipants();
    });

    socket.on('teacher-force-mute', async (payload) => {
      if (!roomRef.current) return;
      if (payload?.targetIdentity !== identity) return;

      await roomRef.current.localParticipant.setMicrophoneEnabled(false);
      setIsAudioEnabled(false);
      refreshParticipants();
    });

    signalingRef.current = socket;
  }, [currentUserType, identity, refreshParticipants, roomName, sfuSignalUrl]);

  const fetchSfuToken = useCallback(async () => {
    const response = await axios.post(`${sfuAuthUrl}/api/sfu/token`, {
      roomName,
      identity,
      name: identity,
      role: currentUserType || 'student'
    });

    if (!response?.data?.token) {
      throw new Error('Token endpoint did not return token');
    }

    return response.data.token;
  }, [currentUserType, identity, roomName, sfuAuthUrl]);

  const attachRoomEvents = useCallback((room) => {
    room.on(RoomEvent.ParticipantConnected, refreshParticipants);
    room.on(RoomEvent.ParticipantDisconnected, refreshParticipants);
    room.on(RoomEvent.TrackSubscribed, refreshParticipants);
    room.on(RoomEvent.TrackUnsubscribed, refreshParticipants);
    room.on(RoomEvent.TrackMuted, refreshParticipants);
    room.on(RoomEvent.TrackUnmuted, refreshParticipants);
    room.on(RoomEvent.LocalTrackPublished, refreshParticipants);
    room.on(RoomEvent.LocalTrackUnpublished, refreshParticipants);
    room.on(RoomEvent.ConnectionStateChanged, (state) => {
      if (state === 'connected') {
        setCallState('active');
        setIsConnecting(false);
        if (typeof onCallActive === 'function') onCallActive();
      }
    });
    room.on(RoomEvent.Disconnected, () => {
      setCallState('ended');
      setTimeout(() => setCallState('idle'), 1200);
      if (typeof onCallEnd === 'function') onCallEnd();
    });
  }, [onCallActive, onCallEnd, refreshParticipants]);

  const handleJoinCall = useCallback(async () => {
    if (isConnecting || roomRef.current) return;

    if (!livekitUrl) {
      setError('VITE_LIVEKIT_URL is not set. Add your LiveKit ws/wss URL.');
      return;
    }

    setError('');
    setIsConnecting(true);
    setCallState('connecting');

    try {
      const token = await fetchSfuToken();

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        publishDefaults: {
          simulcast: true,
          videoEncoding: {
            maxBitrate: 1_200_000,
            maxFramerate: 30
          }
        }
      });

      attachRoomEvents(room);
      await room.connect(livekitUrl, token);
      await room.localParticipant.setMicrophoneEnabled(initialAudioEnabled);
      await room.localParticipant.setCameraEnabled(initialVideoEnabled);

      setIsAudioEnabled(initialAudioEnabled);
      setIsVideoEnabled(initialVideoEnabled);

      roomRef.current = room;
      connectSignaling();
      refreshParticipants();
    } catch (err) {
      console.error('Failed to join SFU room:', err);
      setError(err?.message || 'Failed to connect to SFU room');
      setCallState('idle');
      setIsConnecting(false);
    }
  }, [
    attachRoomEvents,
    connectSignaling,
    fetchSfuToken,
    initialAudioEnabled,
    initialVideoEnabled,
    isConnecting,
    livekitUrl,
    refreshParticipants
  ]);

  const handleLeaveCall = useCallback(async () => {
    await cleanupCall();
    if (typeof onCallEnd === 'function') onCallEnd();
  }, [cleanupCall, onCallEnd]);

  const toggleAudio = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;

    const next = !isAudioEnabled;
    await room.localParticipant.setMicrophoneEnabled(next);
    setIsAudioEnabled(next);
    signalingRef.current?.emit('participant-state-changed', {
      roomName,
      identity,
      audioEnabled: next,
      videoEnabled: isVideoEnabled
    });
    refreshParticipants();
  }, [identity, isAudioEnabled, isVideoEnabled, refreshParticipants, roomName]);

  const toggleVideo = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;

    const next = !isVideoEnabled;
    await room.localParticipant.setCameraEnabled(next);
    setIsVideoEnabled(next);
    signalingRef.current?.emit('participant-state-changed', {
      roomName,
      identity,
      audioEnabled: isAudioEnabled,
      videoEnabled: next
    });
    refreshParticipants();
  }, [identity, isAudioEnabled, isVideoEnabled, refreshParticipants, roomName]);

  const requestMuteParticipant = useCallback((targetIdentity) => {
    const isTeacher = String(currentUserType || '').toLowerCase() === 'teacher';
    if (!isTeacher) return;

    signalingRef.current?.emit('teacher-force-mute', {
      roomName,
      teacherIdentity: identity,
      targetIdentity
    });
  }, [currentUserType, identity, roomName]);

  useEffect(() => {
    return () => {
      cleanupCall();
    };
  }, [cleanupCall]);

  useEffect(() => {
    if (autoStartTrigger) {
      autoStartHandledRef.current = false;
    }
  }, [autoStartTrigger]);

  useEffect(() => {
    if (autoStart && !autoStartHandledRef.current) {
      autoStartHandledRef.current = true;
      handleJoinCall();
    }
  }, [autoStart, handleJoinCall]);

  return (
    <div className="video-call-container active-call">
      <header className="call-header">
        <div className="call-title">{roomName}</div>
        <div className="call-meta">Participants: {participants.length}</div>
      </header>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button className={`control-btn ${isAudioEnabled ? 'active' : ''}`} onClick={toggleAudio} disabled={!roomRef.current}>
          {isAudioEnabled ? 'Mute' : 'Unmute'}
        </button>
        <button className={`control-btn ${isVideoEnabled ? 'active' : ''}`} onClick={toggleVideo} disabled={!roomRef.current}>
          {isVideoEnabled ? 'Video Off' : 'Video On'}
        </button>
        {!roomRef.current ? (
          <button className="control-btn" onClick={handleJoinCall} disabled={isConnecting}>
            {isConnecting ? 'Joining...' : 'Join SFU Call'}
          </button>
        ) : (
          <button className="control-btn end-btn" onClick={handleLeaveCall}>
            Leave
          </button>
        )}
        <button className="control-btn" onClick={() => setIsGridCompact((v) => !v)}>
          {isGridCompact ? 'Comfort Grid' : 'Compact Grid'}
        </button>
      </div>

      <VideoGrid
        participants={participants}
        compact={isGridCompact}
        isTeacher={String(currentUserType || '').toLowerCase() === 'teacher'}
        currentIdentity={identity}
        onRequestMute={requestMuteParticipant}
      />

      {error ? <div className="call-error">{error}</div> : null}
      {callState === 'idle' && !autoStart ? <div className="call-debug-info">Ready to join SFU room.</div> : null}
      {callState === 'connecting' ? <div className="call-debug-info">Connecting to SFU...</div> : null}
      {callState === 'ended' ? <div className="call-debug-info">Call ended.</div> : null}
    </div>
  );
};

export default VideoCall;
