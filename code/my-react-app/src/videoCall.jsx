window.global = window;
window.process = { env: {} };

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Room, RoomEvent, Track } from 'livekit-client';
import { FaMicrophone, FaMicrophoneSlash, FaVideo, FaVideoSlash, FaPhoneSlash, FaUsers, FaThLarge } from 'react-icons/fa';
import { MdScreenShare, MdStopScreenShare } from 'react-icons/md';
import VideoGrid from './VideoGrid';
import './videoCall.css';

const buildRoomName = ({ roomId, sessionId, courseCode, otherUserId }) => {
  if (roomId) return String(roomId);
  if (sessionId) return `session_${sessionId}`;
  if (courseCode) return `course_${courseCode}`;
  return `call_${otherUserId || 'general'}`;
};

const inferRoleFromIdentity = (identity, roleFromMetadata) => {
  const id = String(identity || '');
  if (String(roleFromMetadata || '').toLowerCase() === 'teacher') return 'teacher';
  if (id.startsWith('TCH')) return 'teacher';
  return 'student';
};

const buildDisplayName = (identity, rawName, role) => {
  const id = String(identity || '');
  const name = String(rawName || '').trim();

  if (name && name !== id) return name;
  if (role === 'teacher') return 'Teacher';
  return id || 'Unknown';
};

const buildSidebarLabel = (identity, displayName) => {
  const id = String(identity || '');
  if (!id) return displayName;
  return `${displayName} (${id})`;
};

const VideoCall = ({
  currentUserId,
  currentUserType,
  uid,
  studentsList = [],
  courseCode,
  otherUserId,
  roomId,
  onCallEnd,
  onCallActive,
  autoStart = false,
  autoStartTrigger = 0,
  sessionId,
  initialAudioEnabled = true,
  initialVideoEnabled = true,
  disableAttendance = false
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
  const isVideoEnabledRef = useRef(initialVideoEnabled);
  const userManuallyTurnedOffCameraRef = useRef(!initialVideoEnabled);
  const autoDisabledCameraByVisibilityRef = useRef(false);
  const joinedAttendanceStudentsRef = useRef(new Set());
  const sessionEndReportedRef = useRef(false);

  const identity = useMemo(() => String(uid || currentUserId || 'anonymous'), [uid, currentUserId]);
  const roomName = useMemo(
    () => buildRoomName({ roomId, sessionId, courseCode, otherUserId }),
    [roomId, sessionId, courseCode, otherUserId]
  );

  const configuredLivekitUrl = import.meta.env.VITE_LIVEKIT_URL;
  const apiBaseUrl = import.meta.env.VITE_API_URL || 'https://classmate-virtual-classroom-and-meeting-platform-production.up.railway.app';
  const isTeacherUser = useMemo(
    () => String(currentUserType || '').toLowerCase() === 'teacher',
    [currentUserType]
  );

  const studentNameMap = useMemo(() => {
    const map = new Map();
    for (const student of studentsList || []) {
      const id = String(student?.id || student?.student_id || '').trim();
      const name = String(student?.name || student?.full_name || student?.student_name || '').trim();
      if (id) map.set(id, name || id);
    }
    return map;
  }, [studentsList]);

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

      const normalizedRole = inferRoleFromIdentity(p.identity, parsedRole);
      const identityKey = String(p.identity || '');
      const mappedName = studentNameMap.get(identityKey);
      const preferredName = normalizedRole === 'teacher'
        ? 'Teacher'
        : (mappedName || p.name || identityKey);
      const displayName = buildDisplayName(p.identity, preferredName, normalizedRole);
      const sidebarLabel = buildSidebarLabel(p.identity, displayName);

      return {
        identity: p.identity,
        name: p.name || p.identity,
        displayName,
        sidebarLabel,
        isLocal: p.isLocal,
        role: normalizedRole,
        isVideoEnabled: !!videoPub && !videoPub.isMuted,
        isAudioEnabled: !!audioPub && !audioPub.isMuted,
        videoTrack: videoPub?.track || null,
        audioTrack: audioPub?.track || null
      };
    });

    setParticipants(all);
  }, [studentNameMap]);

  const markAttendanceJoin = useCallback(async (studentId) => {
    if (disableAttendance) return;
    const normalizedStudentId = String(studentId || '').trim();
    if (!sessionId || !normalizedStudentId) return;
    if (joinedAttendanceStudentsRef.current.has(normalizedStudentId)) return;

    try {
      await axios.post(`${apiBaseUrl}/api/attendance/join`, {
        session_id: sessionId,
        student_id: normalizedStudentId,
      });
      joinedAttendanceStudentsRef.current.add(normalizedStudentId);
    } catch (err) {
      console.warn('Attendance join request failed:', normalizedStudentId, err?.response?.data || err?.message);
    }
  }, [apiBaseUrl, disableAttendance, sessionId]);

  const markAttendanceLeave = useCallback(async (studentId) => {
    if (disableAttendance) return;
    const normalizedStudentId = String(studentId || '').trim();
    if (!sessionId || !normalizedStudentId) return;

    try {
      await axios.post(`${apiBaseUrl}/api/attendance/leave`, {
        session_id: sessionId,
        student_id: normalizedStudentId,
      });
    } catch (err) {
      console.warn('Attendance leave request failed:', normalizedStudentId, err?.response?.data || err?.message);
    } finally {
      joinedAttendanceStudentsRef.current.delete(normalizedStudentId);
    }
  }, [apiBaseUrl, disableAttendance, sessionId]);

  const closeSessionAttendance = useCallback(async () => {
    if (disableAttendance) return;
    if (!sessionId || sessionEndReportedRef.current) return;

    try {
      await axios.post(`${apiBaseUrl}/api/attendance/session-end`, {
        session_id: sessionId,
      });
      sessionEndReportedRef.current = true;
      joinedAttendanceStudentsRef.current.clear();
    } catch (err) {
      console.warn('Session-end attendance request failed:', err?.response?.data || err?.message);
    }
  }, [apiBaseUrl, disableAttendance, sessionId]);

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
    room.on(RoomEvent.TrackPublished, (publication, participant) => {
      try {
        if (!participant?.isLocal && publication && !publication.isSubscribed) {
          publication.setSubscribed(true);
        }
      } catch (err) {
        console.warn('Track subscribe warning:', err);
      }
      refreshParticipants();
    });

    room.on(RoomEvent.ParticipantConnected, (participant) => {
      refreshParticipants();

      if (disableAttendance || !isTeacherUser) return;
      const participantIdentity = String(participant?.identity || '').trim();
      if (!participantIdentity) return;
      if (inferRoleFromIdentity(participantIdentity, null) === 'teacher') return;

      void markAttendanceJoin(participantIdentity);
    });

    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      refreshParticipants();

      if (disableAttendance || !isTeacherUser) return;
      const participantIdentity = String(participant?.identity || '').trim();
      if (!participantIdentity) return;
      if (inferRoleFromIdentity(participantIdentity, null) === 'teacher') return;

      void markAttendanceLeave(participantIdentity);
    });

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
  }, [disableAttendance, isTeacherUser, markAttendanceJoin, markAttendanceLeave, onCallActive, onCallEnd, refreshParticipants]);

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
      isVideoEnabledRef.current = initialVideoEnabled;
      userManuallyTurnedOffCameraRef.current = !initialVideoEnabled;
      autoDisabledCameraByVisibilityRef.current = false;

      roomRef.current = room;
      joinedAttendanceStudentsRef.current.clear();
      sessionEndReportedRef.current = false;
      refreshParticipants();

      if (!disableAttendance && !isTeacherUser) {
        void markAttendanceJoin(identity);
      }

      if (!disableAttendance && isTeacherUser) {
        for (const participant of room.remoteParticipants.values()) {
          const participantIdentity = String(participant?.identity || '').trim();
          if (!participantIdentity) continue;
          if (inferRoleFromIdentity(participantIdentity, null) === 'teacher') continue;
          void markAttendanceJoin(participantIdentity);
        }
      }
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
    identity,
    initialAudioEnabled,
    initialVideoEnabled,
    disableAttendance,
    isTeacherUser,
    isConnecting,
    markAttendanceJoin,
    refreshParticipants
  ]);

  const handleLeaveCall = useCallback(async () => {
    if (!disableAttendance && !isTeacherUser) {
      await markAttendanceLeave(identity);
    } else {
      await closeSessionAttendance();
    }

    await cleanupCall();
    if (typeof onCallEnd === 'function') onCallEnd();
  }, [cleanupCall, closeSessionAttendance, disableAttendance, identity, isTeacherUser, markAttendanceLeave, onCallEnd]);

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
      const next = !isVideoEnabledRef.current;

      // Manual button toggle should update user intent.
      userManuallyTurnedOffCameraRef.current = !next;
      autoDisabledCameraByVisibilityRef.current = false;

      if (!next) {
        // OFF: unpublish and stop the current camera track so stale frames cannot remain attached.
        const trackToStop = cameraPublication?.track;
        if (trackToStop) {
          await localParticipant.unpublishTrack(trackToStop);
          if (trackToStop) {
            trackToStop.stop();
          }
        }
        isVideoEnabledRef.current = false;
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

        isVideoEnabledRef.current = true;
        setIsVideoEnabled(true);
      }
    } catch (err) {
      console.error('Camera toggle failed:', err);
      setError('Unable to toggle camera. Check device permissions and try again.');
    } finally {
      refreshParticipants();
    }
  }, [refreshParticipants]);

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

  const setCameraEnabledFromVisibility = useCallback(async (enable) => {
    const room = roomRef.current;
    if (!room) return;

    try {
      const localParticipant = room.localParticipant;
      const cameraPublication = Array.from(localParticipant.trackPublications.values()).find(
        (pub) => pub.source === Track.Source.Camera
      );

      if (!enable) {
        const trackToStop = cameraPublication?.track;
        if (trackToStop) {
          await localParticipant.unpublishTrack(trackToStop);
          if (trackToStop) {
            trackToStop.stop();
          }
        }
        isVideoEnabledRef.current = false;
        setIsVideoEnabled(false);
      } else {
        if (cameraPublication?.track) {
          isVideoEnabledRef.current = true;
          setIsVideoEnabled(true);
          refreshParticipants();
          return;
        }

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
        isVideoEnabledRef.current = true;
        setIsVideoEnabled(true);
      }
    } catch (err) {
      console.error('Visibility camera update failed:', err);
    } finally {
      refreshParticipants();
    }
  }, [refreshParticipants]);

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
    isVideoEnabledRef.current = isVideoEnabled;
  }, [isVideoEnabled]);

  useEffect(() => {
    const onVisibilityChange = () => {
      void (async () => {
        if (document.hidden) {
          // Hidden/minimized/backgrounded: camera OFF, mic stays ON.
          if (isVideoEnabledRef.current) {
            autoDisabledCameraByVisibilityRef.current = true;
            await setCameraEnabledFromVisibility(false);
          }
          return;
        }

        // Visible again: restore camera only if we auto-disabled it and user did not manually disable.
        if (autoDisabledCameraByVisibilityRef.current && !userManuallyTurnedOffCameraRef.current) {
          autoDisabledCameraByVisibilityRef.current = false;
          await setCameraEnabledFromVisibility(true);
        }
      })();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [setCameraEnabledFromVisibility]);

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
        <div className="call-meta">
          Participants: {participants.length}
        </div>
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
                  <span>{p.sidebarLabel || `${p.displayName || p.name || p.identity} (${p.identity})`}</span>
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
