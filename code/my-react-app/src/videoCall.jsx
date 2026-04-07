window.global = window;
window.process = { env: {} };

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
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
  const autoStartHandledRef = useRef(false);

  const identity = useMemo(() => String(uid || currentUserId || 'anonymous'), [uid, currentUserId]);
  const roomName = useMemo(
    () => buildRoomName({ sessionId, courseCode, otherUserId }),
    [sessionId, courseCode, otherUserId]
  );

  const configuredLivekitUrl = import.meta.env.VITE_LIVEKIT_URL;
  const apiBaseUrl = import.meta.env.VITE_API_URL;

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

    try {
      if (room) {
        await room.disconnect();
      }
    } catch (err) {
      console.warn('Room disconnect warning:', err);
    }

    roomRef.current = null;
    setParticipants([]);
    setCallState('idle');
    setIsConnecting(false);
  }, []);

  const fetchSfuToken = useCallback(async () => {
    if (!apiBaseUrl) {
      throw new Error('VITE_API_URL is not set. Add your Flask backend URL.');
    }

    let response;
    try {
      response = await axios.post(`${apiBaseUrl}/api/livekit/token`, {
        roomName,
        participantName: identity,
        userType: currentUserType || 'student'
      });
    } catch (err) {
      const status = err?.response?.status;
      const serverError = err?.response?.data?.error;
      const detail = serverError || err?.message || 'Unknown network error';
      throw new Error(status ? `Token request failed (${status}): ${detail}` : `Token request failed: ${detail}`);
    }

    if (!response?.data?.success || !response?.data?.token) {
      throw new Error(response?.data?.error || 'Token endpoint did not return a valid token');
    }

    return {
      token: response.data.token,
      livekitUrlFromApi: response.data.url || null
    };
  }, [apiBaseUrl, currentUserType, identity, roomName]);

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

    setError('');
    setIsConnecting(true);
    setCallState('connecting');

    try {
      const { token, livekitUrlFromApi } = await fetchSfuToken();
      const resolvedLivekitUrl = configuredLivekitUrl || livekitUrlFromApi;

      if (!resolvedLivekitUrl) {
        throw new Error('LiveKit URL is missing. Set VITE_LIVEKIT_URL or return url from /api/livekit/token');
      }

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
      await room.connect(resolvedLivekitUrl, token);
      await room.localParticipant.setMicrophoneEnabled(initialAudioEnabled);
      await room.localParticipant.setCameraEnabled(initialVideoEnabled);

      setIsAudioEnabled(initialAudioEnabled);
      setIsVideoEnabled(initialVideoEnabled);

      roomRef.current = room;
      refreshParticipants();
    } catch (err) {
      console.error('Failed to join SFU room:', err);
      setError(err?.message || 'Failed to connect to SFU room');
      setCallState('idle');
      setIsConnecting(false);
    }
  }, [
    attachRoomEvents,
    configuredLivekitUrl,
    fetchSfuToken,
    initialAudioEnabled,
    initialVideoEnabled,
    isConnecting,
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
    refreshParticipants();
  }, [isAudioEnabled, refreshParticipants]);

  const toggleVideo = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;

    const next = !isVideoEnabled;
    await room.localParticipant.setCameraEnabled(next);
    setIsVideoEnabled(next);
    refreshParticipants();
  }, [isVideoEnabled, refreshParticipants]);

  const requestMuteParticipant = useCallback((targetIdentity) => {
    const isTeacher = String(currentUserType || '').toLowerCase() === 'teacher';
    if (!isTeacher) return;

    setError(`Server-side force mute is not enabled yet for ${targetIdentity}.`);
  }, [currentUserType]);

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
