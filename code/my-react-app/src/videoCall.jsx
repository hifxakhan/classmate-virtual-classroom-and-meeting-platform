window.global = window;
window.process = { env: {} };

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Room, RoomEvent, Track } from 'livekit-client';
import { FaMicrophone, FaMicrophoneSlash, FaVideo, FaVideoSlash, FaPhoneSlash, FaUsers, FaThLarge } from 'react-icons/fa';
import { MdScreenShare, MdStopScreenShare } from 'react-icons/md';
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
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [showParticipantsPanel, setShowParticipantsPanel] = useState(false);

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
      console.log('🎥 Student attempting to join room:', roomName);
      console.log('📡 Student calling token endpoint...');
      console.log('🔍 Join payload:', {
        roomName,
        participantName: identity,
        userType: currentUserType || 'student',
        apiBaseUrl
      });

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
      console.log('🚀 handleJoinCall start:', {
        roomName,
        identity,
        currentUserType,
        autoStart
      });

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
      console.log('🔌 Connecting to LiveKit:', { resolvedLivekitUrl, roomName, identity });
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

    try {
      const localParticipant = room.localParticipant;
      const cameraPublication = Array.from(localParticipant.trackPublications.values()).find(
        (pub) => pub.source === Track.Source.Camera
      );

      if (isVideoEnabled) {
        // OFF: unpublish and stop the current camera track so stale frames cannot remain attached.
        const trackToStop = cameraPublication?.track;
        if (trackToStop) {
          await localParticipant.unpublishTrack(trackToStop);
          if (trackToStop) {
            trackToStop.stop();
          }
        }
        setIsVideoEnabled(false);
      } else {
        // ON: request a new media stream and publish a brand new camera track.
        const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        const [newVideoTrack] = mediaStream.getVideoTracks();

        if (!newVideoTrack) {
          throw new Error('Could not get a camera track from media stream.');
        }

        await localParticipant.publishTrack(newVideoTrack, {
          source: Track.Source.Camera,
          stopMicTrackOnMute: false,
          stopVideoTrackOnMute: false
        });

        setIsVideoEnabled(true);
      }
    } catch (err) {
      console.error('Camera toggle failed:', err);
      setError('Unable to toggle camera. Check device permissions and try again.');
    } finally {
      refreshParticipants();
    }
  }, [isVideoEnabled, refreshParticipants]);

  // Alternative approach: keep the same publication and only mute/unmute camera track.
  // This is often simpler and avoids re-publish timing issues.
  const toggleVideoWithMute = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;

    try {
      const localParticipant = room.localParticipant;
      const cameraPublication = Array.from(localParticipant.trackPublications.values()).find(
        (pub) => pub.source === Track.Source.Camera
      );

      if (!cameraPublication?.track) {
        // If camera track is missing, create/publish once, then continue with mute strategy.
        const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        const [newVideoTrack] = mediaStream.getVideoTracks();
        if (!newVideoTrack) throw new Error('Could not get a camera track from media stream.');
        await localParticipant.publishTrack(newVideoTrack, { source: Track.Source.Camera });
        setIsVideoEnabled(true);
      } else if (isVideoEnabled) {
        await cameraPublication.track.mute();
        setIsVideoEnabled(false);
      } else {
        await cameraPublication.track.unmute();
        setIsVideoEnabled(true);
      }
    } catch (err) {
      console.error('Camera mute/unmute toggle failed:', err);
      setError('Unable to toggle camera. Check device permissions and try again.');
    } finally {
      refreshParticipants();
    }
  }, [isVideoEnabled, refreshParticipants]);

  const toggleScreenShare = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;

    const next = !isScreenSharing;
    try {
      await room.localParticipant.setScreenShareEnabled(next);
      setIsScreenSharing(next);
    } catch (err) {
      console.error('Screen share toggle failed:', err);
      setError('Unable to toggle screen sharing on this device/browser.');
    }
  }, [isScreenSharing]);

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
      console.log('⚡ Auto-start triggered join:', { roomName, identity, currentUserType });
      autoStartHandledRef.current = true;
      handleJoinCall();
    }
  }, [autoStart, handleJoinCall]);

  useEffect(() => {
    console.log('🧩 VideoCall props:', {
      sessionId,
      roomName,
      identity,
      currentUserType,
      autoStart,
      autoStartTrigger
    });
  }, [sessionId, roomName, identity, currentUserType, autoStart, autoStartTrigger]);

  return (
    <div className="video-call-container active-call">
      <header className="call-header">
        <div className="call-title">{roomName}</div>
        <div className="call-meta">Participants: {participants.length}</div>
      </header>

      <div className={`call-stage ${showParticipantsPanel ? 'panel-open' : ''}`}>
        <VideoGrid
          participants={participants}
          compact={isGridCompact}
          isTeacher={String(currentUserType || '').toLowerCase() === 'teacher'}
          currentIdentity={identity}
          onRequestMute={requestMuteParticipant}
        />

        {showParticipantsPanel ? (
          <aside className="participants-panel">
            <h3>Participants ({participants.length})</h3>
            <div className="participants-list">
              {participants.map((p) => (
                <div className="participant-row" key={`panel-${p.identity}`}>
                  <span className="participant-dot" />
                  <span>{p.name || p.identity}</span>
                </div>
              ))}
            </div>
          </aside>
        ) : null}
      </div>

      <div className="controls-float" role="toolbar" aria-label="Call controls">
        {!roomRef.current ? (
          <button className="join-chip" onClick={handleJoinCall} disabled={isConnecting} title="Join call">
            {isConnecting ? 'Joining...' : 'Join call'}
          </button>
        ) : (
          <div className="control-buttons">
            <button
              className={`control-btn icon-only ${isAudioEnabled ? 'active' : 'muted'}`}
              onClick={toggleAudio}
              title={isAudioEnabled ? 'Mute microphone' : 'Unmute microphone'}
              aria-label={isAudioEnabled ? 'Mute microphone' : 'Unmute microphone'}
            >
              {isAudioEnabled ? <FaMicrophone /> : <FaMicrophoneSlash />}
            </button>
            <button
              className={`control-btn icon-only ${isVideoEnabled ? 'active' : 'muted'}`}
              onClick={toggleVideo}
              title={isVideoEnabled ? 'Turn camera off' : 'Turn camera on'}
              aria-label={isVideoEnabled ? 'Turn camera off' : 'Turn camera on'}
            >
              {isVideoEnabled ? <FaVideo /> : <FaVideoSlash />}
            </button>
            <button
              className={`control-btn icon-only ${isScreenSharing ? 'active' : ''}`}
              onClick={toggleScreenShare}
              title={isScreenSharing ? 'Stop screen share' : 'Start screen share'}
              aria-label={isScreenSharing ? 'Stop screen share' : 'Start screen share'}
            >
              {isScreenSharing ? <MdStopScreenShare /> : <MdScreenShare />}
            </button>
            <button
              className="control-btn icon-only"
              onClick={() => setShowParticipantsPanel((v) => !v)}
              title="Toggle participants"
              aria-label="Toggle participants"
            >
              <FaUsers />
              <span className="control-badge">{participants.length}</span>
            </button>
            <button
              className={`control-btn icon-only ${isGridCompact ? 'active' : ''}`}
              onClick={() => setIsGridCompact((v) => !v)}
              title={isGridCompact ? 'Switch to comfortable grid' : 'Switch to compact grid'}
              aria-label={isGridCompact ? 'Switch to comfortable grid' : 'Switch to compact grid'}
            >
              <FaThLarge />
            </button>
            <button className="control-btn icon-only end-btn" onClick={handleLeaveCall} title="Leave call" aria-label="Leave call">
              <FaPhoneSlash />
            </button>
          </div>
        )}
      </div>

      {error ? <div className="call-error">{error}</div> : null}
      {callState === 'idle' && !autoStart ? <div className="call-debug-info">Ready to join SFU room.</div> : null}
      {callState === 'connecting' ? <div className="call-debug-info">Connecting to SFU...</div> : null}
      {callState === 'ended' ? <div className="call-debug-info">Call ended.</div> : null}
    </div>
  );
};

export default VideoCall;
