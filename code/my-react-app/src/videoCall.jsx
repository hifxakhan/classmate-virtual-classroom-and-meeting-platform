window.global = window;
window.process = { env: {} };

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Room, RoomEvent, Track, DisconnectReason } from 'livekit-client';
import { FaMicrophone, FaMicrophoneSlash, FaVideo, FaVideoSlash, FaPhoneSlash, FaUsers, FaThLarge, FaRegSmile } from 'react-icons/fa';
import { MdScreenShare, MdStopScreenShare } from 'react-icons/md';
import VideoGrid from './VideoGrid';
import { getApiBase } from './apiBase';
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

const REACTION_EMOJIS = ['👍', '❤️', '😂', '👏', '🎉', '😮', '🙋'];

/** Renders an active screen-share track in a large stage view above the participant filmstrip. */
const ScreenShareView = ({ share }) => {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    const track = share?.track;
    if (!el || !track) return undefined;

    track.attach(el);
    el.autoplay = true;
    el.playsInline = true;
    el.muted = true;

    const maybePlay = async () => {
      try {
        if (el.paused) await el.play();
      } catch (err) {
        if (err?.name !== 'AbortError') console.error('Screen share play error:', err);
      }
    };
    maybePlay();

    return () => {
      try {
        track.detach(el);
      } catch (_e) {
        /* ignore */
      }
      if (el.srcObject) el.srcObject = null;
    };
  }, [share?.track]);

  return (
    <div className="screen-share-stage">
      <video ref={ref} className="screen-share-video" />
      <div className="screen-share-label">
        <MdScreenShare /> {share?.name || 'Someone'}{share?.isLocal ? ' (You)' : ''} is presenting
      </div>
    </div>
  );
};

/** Bumped on VideoCall unmount so in-flight joins from a discarded StrictMode instance abort before publishing (avoids DUPLICATE_IDENTITY). */
let liveKitJoinSessionEpoch = 0;

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
  callType = 'video',
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
  const [screenShares, setScreenShares] = useState([]);
  const [floatingReactions, setFloatingReactions] = useState([]);
  const [showReactionBar, setShowReactionBar] = useState(false);

  const roomRef = useRef(null);
  const handleDataMessageRef = useRef(null);
  const floatingReactionIdRef = useRef(0);
  const autoStartHandledRef = useRef(false);
  const isVideoEnabledRef = useRef(initialVideoEnabled);
  const userManuallyTurnedOffCameraRef = useRef(!initialVideoEnabled);
  const autoDisabledCameraByVisibilityRef = useRef(false);
  const joinedAttendanceStudentsRef = useRef(new Set());
  const sessionEndReportedRef = useRef(false);
  const isVoiceCall = useMemo(() => String(callType || 'video').toLowerCase() === 'voice', [callType]);
  const cameraAllowed = !isVoiceCall;

  const identity = useMemo(() => String(uid || currentUserId || 'anonymous'), [uid, currentUserId]);
  const roomName = useMemo(
    () => buildRoomName({ roomId, sessionId, courseCode, otherUserId }),
    [roomId, sessionId, courseCode, otherUserId]
  );

  const configuredLivekitUrl = 'wss://classmate-bxwmnylu.livekit.cloud';
  const apiBaseUrl = getApiBase();
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
      setScreenShares([]);
      return;
    }

    const shares = [];
    const all = [room.localParticipant, ...Array.from(room.remoteParticipants.values())].map((p) => {
      const pubs = Array.from(p.trackPublications.values());
      // Distinguish the camera feed from a screen-share feed (both are Video kind).
      const cameraPub = pubs.find((pub) => pub.source === Track.Source.Camera)
        || pubs.find((pub) => pub.kind === Track.Kind.Video && pub.source !== Track.Source.ScreenShare);
      const screenPub = pubs.find((pub) => pub.source === Track.Source.ScreenShare);
      const audioPub = pubs.find((pub) => pub.kind === Track.Kind.Audio && pub.source !== Track.Source.ScreenShareAudio)
        || pubs.find((pub) => pub.kind === Track.Kind.Audio);
      const videoPub = cameraPub;

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

      if (screenPub && screenPub.track && !screenPub.isMuted) {
        shares.push({
          identity: p.identity,
          name: displayName,
          isLocal: p.isLocal,
          track: screenPub.track,
        });
      }

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
    setScreenShares(shares);
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

    room.on(RoomEvent.DataReceived, (payload, participant) => {
      try {
        handleDataMessageRef.current?.(payload, participant);
      } catch (err) {
        console.warn('Data message handling failed:', err);
      }
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
    room.on(RoomEvent.Disconnected, (reason) => {
      setCallState('ended');
      setTimeout(() => setCallState('idle'), 1200);
      // Session completion + dashboard redirect run only from handleLeaveCall → onCallEnd,
      // not from every RoomEvent.Disconnected (StrictMode unmount, duplicate identity, etc.).
      if (reason === DisconnectReason.DUPLICATE_IDENTITY) {
        setError('This account is already in the room from another tab or window. Close the other tab, then use Join call again.');
      }
    });
  }, [disableAttendance, isTeacherUser, markAttendanceJoin, markAttendanceLeave, onCallActive, refreshParticipants]);

  const handleJoinCall = useCallback(async () => {
    if (isConnecting || roomRef.current) return;

    const epochAtStart = liveKitJoinSessionEpoch;

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
      if (liveKitJoinSessionEpoch !== epochAtStart) {
        setIsConnecting(false);
        setCallState('idle');
        return;
      }

      const resolvedLivekitUrl = configuredLivekitUrl || livekitUrlFromApi;

      if (!resolvedLivekitUrl) {
        throw new Error('LiveKit URL is missing. Set VITE_LIVEKIT_URL or return url from /api/livekit/token');
      }

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        publishDefaults: {
          // Simulcast off reduces signaling load; helps avoid "publication timed out" on slow or strict-remount setups.
          simulcast: false,
          videoEncoding: {
            maxBitrate: 900_000,
            maxFramerate: 30
          }
        }
      });

      attachRoomEvents(room);
      console.log('🔌 Connecting to LiveKit:', { resolvedLivekitUrl, roomName, identity });
      await room.connect(resolvedLivekitUrl, token);
      if (liveKitJoinSessionEpoch !== epochAtStart) {
        try {
          await room.disconnect();
        } catch (_e) {
          /* ignore */
        }
        setIsConnecting(false);
        setCallState('idle');
        return;
      }
      await room.localParticipant.setMicrophoneEnabled(initialAudioEnabled);
      if (liveKitJoinSessionEpoch !== epochAtStart) {
        try {
          await room.disconnect();
        } catch (_e) {
          /* ignore */
        }
        setIsConnecting(false);
        setCallState('idle');
        return;
      }
      await room.localParticipant.setCameraEnabled(cameraAllowed && initialVideoEnabled);

      setIsAudioEnabled(initialAudioEnabled);
      setIsVideoEnabled(cameraAllowed && initialVideoEnabled);
      isVideoEnabledRef.current = cameraAllowed && initialVideoEnabled;
      userManuallyTurnedOffCameraRef.current = !(cameraAllowed && initialVideoEnabled);
      autoDisabledCameraByVisibilityRef.current = false;

      if (liveKitJoinSessionEpoch !== epochAtStart) {
        try {
          await room.disconnect();
        } catch (_e) {
          /* ignore */
        }
        setIsConnecting(false);
        setCallState('idle');
        return;
      }

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
    cameraAllowed,
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
    if (!cameraAllowed) return;
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
  }, [cameraAllowed, isVideoEnabled, refreshParticipants]);

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

  const publishData = useCallback(async (obj, destinationIdentities) => {
    const room = roomRef.current;
    if (!room) return;
    try {
      const bytes = new TextEncoder().encode(JSON.stringify(obj));
      const opts = { reliable: true };
      if (destinationIdentities && destinationIdentities.length) {
        opts.destinationIdentities = destinationIdentities;
      }
      await room.localParticipant.publishData(bytes, opts);
    } catch (err) {
      console.warn('publishData failed:', err);
    }
  }, []);

  const addFloatingReaction = useCallback((emoji, name) => {
    if (!emoji) return;
    const id = ++floatingReactionIdRef.current;
    const left = 6 + Math.random() * 80; // percent across the stage
    setFloatingReactions((prev) => [...prev, { id, emoji, name, left }]);
    setTimeout(() => {
      setFloatingReactions((prev) => prev.filter((r) => r.id !== id));
    }, 4200);
  }, []);

  const sendReaction = useCallback((emoji) => {
    const name = isTeacherUser ? 'Teacher' : (studentNameMap.get(identity) || identity);
    addFloatingReaction(emoji, name); // local echo (publishData does not loop back)
    void publishData({ type: 'reaction', emoji, name });
    setShowReactionBar(false);
  }, [addFloatingReaction, identity, isTeacherUser, publishData, studentNameMap]);

  // Apply a host-issued forced mute on this client.
  const applyForcedMute = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    try {
      await room.localParticipant.setMicrophoneEnabled(false);
      setIsAudioEnabled(false);
      setError('The host muted everyone.');
      setTimeout(() => setError(''), 3500);
    } catch (err) {
      console.warn('Forced mute failed:', err);
    } finally {
      refreshParticipants();
    }
  }, [refreshParticipants]);

  // Teacher broadcasts a mute-all command to every participant.
  const muteAll = useCallback(() => {
    if (!isTeacherUser) return;
    void publishData({ type: 'mute-all' });
    setError('Muted all participants.');
    setTimeout(() => setError(''), 2500);
  }, [isTeacherUser, publishData]);

  // Teacher broadcasts a camera-off command to every participant.
  const turnOffAllCameras = useCallback(() => {
    if (!isTeacherUser) return;
    void publishData({ type: 'camera-off-all' });
    setError("Turned off all participants' cameras.");
    setTimeout(() => setError(''), 2500);
  }, [isTeacherUser, publishData]);

  // Teacher mutes a single participant via a targeted data message.
  const requestMuteParticipant = useCallback((targetIdentity) => {
    if (!isTeacherUser || !targetIdentity) return;
    void publishData({ type: 'mute-all', target: targetIdentity }, [targetIdentity]);
    setError(`Mute request sent to ${targetIdentity}.`);
    setTimeout(() => setError(''), 2500);
  }, [isTeacherUser, publishData]);

  const setCameraEnabledFromVisibility = useCallback(async (enable) => {
    if (!cameraAllowed) return;
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
  }, [cameraAllowed, refreshParticipants]);

  // Apply a host-issued forced camera-off on this client.
  const applyForcedCameraOff = useCallback(async () => {
    if (!cameraAllowed) return;
    userManuallyTurnedOffCameraRef.current = true; // keep it off; don't auto-restore on tab focus
    autoDisabledCameraByVisibilityRef.current = false;
    await setCameraEnabledFromVisibility(false);
    setError("The host turned off everyone's camera.");
    setTimeout(() => setError(''), 3500);
  }, [cameraAllowed, setCameraEnabledFromVisibility]);

  // Central handler for all incoming data messages.
  const handleDataMessage = useCallback((payloadBytes, participant) => {
    let msg;
    try {
      msg = JSON.parse(new TextDecoder().decode(payloadBytes));
    } catch (_e) {
      return;
    }
    if (!msg || !msg.type) return;

    if (msg.type === 'reaction') {
      addFloatingReaction(msg.emoji, msg.name || participant?.identity || 'Someone');
      return;
    }

    // Moderation commands are honored only when sent by a teacher, and never acted on by the teacher who sent them.
    const senderIsTeacher = inferRoleFromIdentity(participant?.identity, null) === 'teacher';
    if (!senderIsTeacher || isTeacherUser) return;

    if (msg.type === 'mute-all') {
      void applyForcedMute();
    } else if (msg.type === 'camera-off-all') {
      void applyForcedCameraOff();
    }
  }, [addFloatingReaction, applyForcedCameraOff, applyForcedMute, isTeacherUser]);

  useEffect(() => {
    handleDataMessageRef.current = handleDataMessage;
  }, [handleDataMessage]);

  useEffect(() => {
    return () => {
      liveKitJoinSessionEpoch += 1;
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

      <div className={`call-stage ${showParticipantsPanel ? 'panel-open' : ''} ${screenShares.length > 0 ? 'screen-active' : ''}`}>
        <div className="stage-main">
          {screenShares.length > 0 ? (
            <ScreenShareView share={screenShares[0]} />
          ) : null}

          <VideoGrid
            participants={participants}
            compact={isGridCompact || screenShares.length > 0}
            isTeacher={String(currentUserType || '').toLowerCase() === 'teacher'}
            currentIdentity={identity}
            onRequestMute={requestMuteParticipant}
            audioOnly={isVoiceCall}
          />

          {floatingReactions.length > 0 ? (
            <div className="floating-reactions-layer" aria-hidden="true">
              {floatingReactions.map((r) => (
                <div key={r.id} className="floating-reaction" style={{ left: `${r.left}%` }}>
                  <span className="floating-reaction-emoji">{r.emoji}</span>
                  {r.name ? <span className="floating-reaction-name">{r.name}</span> : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>

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
            {showReactionBar ? (
              <div className="reaction-bar" role="menu" aria-label="Send a reaction">
                {REACTION_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="reaction-emoji-btn"
                    onClick={() => sendReaction(emoji)}
                    title={`React ${emoji}`}
                    aria-label={`React ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            ) : null}
            <button
              className={`control-btn icon-only ${isAudioEnabled ? 'active' : 'muted'}`}
              onClick={toggleAudio}
              title={isAudioEnabled ? 'Mute microphone' : 'Unmute microphone'}
              aria-label={isAudioEnabled ? 'Mute microphone' : 'Unmute microphone'}
            >
              {isAudioEnabled ? <FaMicrophone /> : <FaMicrophoneSlash />}
            </button>
            {cameraAllowed ? (
              <button
                className={`control-btn icon-only ${isVideoEnabled ? 'active' : 'muted'}`}
                onClick={toggleVideo}
                title={isVideoEnabled ? 'Turn camera off' : 'Turn camera on'}
                aria-label={isVideoEnabled ? 'Turn camera off' : 'Turn camera on'}
              >
                {isVideoEnabled ? <FaVideo /> : <FaVideoSlash />}
              </button>
            ) : null}
            {cameraAllowed ? (
              <button
                className={`control-btn icon-only ${isScreenSharing ? 'active' : ''}`}
                onClick={toggleScreenShare}
                title={isScreenSharing ? 'Stop screen share' : 'Start screen share'}
                aria-label={isScreenSharing ? 'Stop screen share' : 'Start screen share'}
              >
                {isScreenSharing ? <MdStopScreenShare /> : <MdScreenShare />}
              </button>
            ) : null}
            <button
              className={`control-btn icon-only ${showReactionBar ? 'active' : ''}`}
              onClick={() => setShowReactionBar((v) => !v)}
              title="Send a reaction"
              aria-label="Send a reaction"
            >
              <FaRegSmile />
            </button>
            {isTeacherUser ? (
              <>
                <button
                  className="control-btn icon-only"
                  onClick={muteAll}
                  title="Mute all participants"
                  aria-label="Mute all participants"
                >
                  <FaMicrophoneSlash />
                </button>
                {cameraAllowed ? (
                  <button
                    className="control-btn icon-only"
                    onClick={turnOffAllCameras}
                    title="Turn off all cameras"
                    aria-label="Turn off all cameras"
                  >
                    <FaVideoSlash />
                  </button>
                ) : null}
              </>
            ) : null}
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
      {isVoiceCall ? <div className="call-mode-badge">Voice call</div> : null}
      {callState === 'idle' && !autoStart ? <div className="call-debug-info">Ready to join SFU room.</div> : null}
      {callState === 'connecting' ? <div className="call-debug-info">Connecting to SFU...</div> : null}
      {callState === 'ended' ? <div className="call-debug-info">Call ended.</div> : null}
    </div>
  );
};

export default VideoCall;
