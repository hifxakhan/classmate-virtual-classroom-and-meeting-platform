window.global = window;
window.process = { env: {} };

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Room, RoomEvent, Track, DisconnectReason } from 'livekit-client';
import { FaMicrophone, FaMicrophoneSlash, FaVideo, FaVideoSlash, FaPhoneSlash, FaUsers, FaThLarge, FaRegSmile, FaHandPaper, FaCircle, FaStopCircle, FaEllipsisV, FaLock, FaLockOpen } from 'react-icons/fa';
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
  disableAttendance = false,
  extraControls = null,
  autoStartRecording = false
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
  const [raisedHands, setRaisedHands] = useState({});
  const [isRecordingMeeting, setIsRecordingMeeting] = useState(false);
  const [recordingStatus, setRecordingStatus] = useState('');
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [camerasLocked, setCamerasLocked] = useState(false); // teacher's view of the lock
  const [cameraLockedByHost, setCameraLockedByHost] = useState(false); // student's view
  const [micsLocked, setMicsLocked] = useState(false); // teacher's view of the mic lock
  const [micLockedByHost, setMicLockedByHost] = useState(false); // student's view

  const roomRef = useRef(null);
  const handleDataMessageRef = useRef(null);
  const floatingReactionIdRef = useRef(0);
  const meetingRecorderRef = useRef(null);
  const meetingChunksRef = useRef([]);
  const meetingStreamsRef = useRef(null);
  const recordingStartRef = useRef(0);
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

      const leftIdentity = String(participant?.identity || '');
      if (leftIdentity) {
        setRaisedHands((prev) => {
          if (!prev[leftIdentity]) return prev;
          const next = { ...prev };
          delete next[leftIdentity];
          return next;
        });
      }

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
    // Students cannot unmute while the host has locked microphones.
    if (next && micLockedByHost && !isTeacherUser) {
      setError('The host has muted everyone. You can unmute once the host allows it.');
      setTimeout(() => setError(''), 3500);
      return;
    }
    await room.localParticipant.setMicrophoneEnabled(next);
    setIsAudioEnabled(next);
    refreshParticipants();
  }, [isAudioEnabled, micLockedByHost, isTeacherUser, refreshParticipants]);

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

      // Students cannot enable their camera while the host has locked cameras.
      if (next && cameraLockedByHost && !isTeacherUser) {
        setError('The host has locked cameras. You can turn it on once the host allows it.');
        setTimeout(() => setError(''), 3500);
        return;
      }

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
  }, [cameraAllowed, cameraLockedByHost, isTeacherUser, refreshParticipants]);

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

  const toggleHand = useCallback(() => {
    setRaisedHands((prev) => {
      const next = { ...prev };
      const raised = !next[identity];
      if (raised) next[identity] = true;
      else delete next[identity];
      void publishData({ type: 'hand', raised });
      return next;
    });
  }, [identity, publishData]);

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

  // Teacher locks/unlocks participants' microphones. While locked, students are
  // muted and cannot unmute until the teacher allows it again.
  const toggleMicLock = useCallback(() => {
    if (!isTeacherUser) return;
    setMicsLocked((prev) => {
      const next = !prev;
      void publishData({ type: 'mic-lock', locked: next, senderRole: 'teacher' });
      setError(next ? 'Locked all participants’ mics.' : 'Mics unlocked for participants.');
      setTimeout(() => setError(''), 2500);
      return next;
    });
  }, [isTeacherUser, publishData]);

  // Teacher locks/unlocks participants' cameras. While locked, students cannot
  // turn their camera on until the teacher allows it again.
  const toggleCameraLock = useCallback(() => {
    if (!isTeacherUser) return;
    setCamerasLocked((prev) => {
      const next = !prev;
      void publishData({ type: 'camera-lock', locked: next, senderRole: 'teacher' });
      setError(next ? "Locked all participants' cameras." : 'Cameras unlocked for participants.');
      setTimeout(() => setError(''), 2500);
      return next;
    });
  }, [isTeacherUser, publishData]);

  // Teacher mutes a single participant via a targeted data message.
  const requestMuteParticipant = useCallback((targetIdentity) => {
    if (!isTeacherUser || !targetIdentity) return;
    void publishData({ type: 'mute-all', target: targetIdentity, senderRole: 'teacher' }, [targetIdentity]);
    setError(`Mute request sent to ${targetIdentity}.`);
    setTimeout(() => setError(''), 2500);
  }, [isTeacherUser, publishData]);

  // ── Meeting recording (teacher-only, browser screen capture) ─────────────────
  const stopMeetingRecording = useCallback(() => {
    const rec = meetingRecorderRef.current;
    if (rec && rec.state !== 'inactive') {
      try {
        rec.stop();
      } catch (_e) {
        /* ignore */
      }
    }
  }, []);

  const uploadMeetingRecording = useCallback(async (blob, durationSec) => {
    if (!sessionId) {
      setRecordingStatus('No session linked — recording was not saved.');
      setTimeout(() => setRecordingStatus(''), 6000);
      return;
    }
    setRecordingStatus('Uploading recording…');
    try {
      const form = new FormData();
      form.append('teacher_id', identity);
      form.append('duration_seconds', String(Math.round(durationSec || 0)));
      form.append('file', blob, `recording_${Date.now()}.webm`);
      const resp = await axios.post(
        `${apiBaseUrl}/api/sessions/${encodeURIComponent(sessionId)}/recordings`,
        form
      );
      if (resp?.data?.success) {
        setRecordingStatus('Recording saved. Share it with students from Manage Meetings.');
      } else {
        setRecordingStatus('Could not save the recording.');
      }
    } catch (_e) {
      setRecordingStatus('Could not save the recording.');
    } finally {
      setTimeout(() => setRecordingStatus(''), 7000);
    }
  }, [apiBaseUrl, identity, sessionId]);

  const startMeetingRecording = useCallback(async () => {
    if (!isTeacherUser) return;
    if (!sessionId) {
      setRecordingStatus('No session linked — cannot record this meeting.');
      setTimeout(() => setRecordingStatus(''), 5000);
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      setRecordingStatus('Screen recording is not supported in this browser.');
      setTimeout(() => setRecordingStatus(''), 5000);
      return;
    }

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: true,
      });
      let micStream = null;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (_e) {
        micStream = null; // mic is optional
      }

      // Mix screen audio + mic into a single track so the teacher's voice is captured.
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      let audioCtx = null;
      let mixedAudioTracks = [];
      if (AudioCtx && (displayStream.getAudioTracks().length || (micStream && micStream.getAudioTracks().length))) {
        audioCtx = new AudioCtx();
        const dest = audioCtx.createMediaStreamDestination();
        [displayStream, micStream].forEach((s) => {
          if (s && s.getAudioTracks().length) {
            try {
              audioCtx.createMediaStreamSource(s).connect(dest);
            } catch (_e) {
              /* ignore */
            }
          }
        });
        mixedAudioTracks = dest.stream.getAudioTracks();
      }

      const recordStream = new MediaStream();
      displayStream.getVideoTracks().forEach((t) => recordStream.addTrack(t));
      (mixedAudioTracks.length ? mixedAudioTracks : displayStream.getAudioTracks()).forEach((t) =>
        recordStream.addTrack(t)
      );

      const options = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
        ? { mimeType: 'video/webm;codecs=vp9,opus' }
        : MediaRecorder.isTypeSupported('video/webm')
        ? { mimeType: 'video/webm' }
        : {};
      const recorder = new MediaRecorder(recordStream, options);
      meetingChunksRef.current = [];
      meetingRecorderRef.current = recorder;
      meetingStreamsRef.current = { displayStream, micStream, audioCtx };
      recordingStartRef.current = Date.now();

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size) meetingChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(meetingChunksRef.current, { type: 'video/webm' });
        meetingChunksRef.current = [];
        const durationSec = (Date.now() - recordingStartRef.current) / 1000;
        const streams = meetingStreamsRef.current || {};
        [streams.displayStream, streams.micStream].forEach((s) => {
          if (s) s.getTracks().forEach((t) => t.stop());
        });
        if (streams.audioCtx) {
          try {
            streams.audioCtx.close();
          } catch (_e) {
            /* ignore */
          }
        }
        meetingStreamsRef.current = null;
        meetingRecorderRef.current = null;
        setIsRecordingMeeting(false);
        if (blob.size) uploadMeetingRecording(blob, durationSec);
      };

      // If the teacher stops sharing via the browser's own control, end the recording.
      const videoTrack = displayStream.getVideoTracks()[0];
      if (videoTrack) videoTrack.onended = () => stopMeetingRecording();

      recorder.start(1000);
      setIsRecordingMeeting(true);
      setRecordingStatus('Recording the meeting…');
    } catch (e) {
      if (e && e.name === 'NotAllowedError') {
        setRecordingStatus('Screen capture was cancelled.');
      } else {
        setRecordingStatus('Could not start recording.');
      }
      setTimeout(() => setRecordingStatus(''), 5000);
      setIsRecordingMeeting(false);
    }
  }, [isTeacherUser, sessionId, uploadMeetingRecording, stopMeetingRecording]);

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

    if (msg.type === 'hand') {
      const who = String(participant?.identity || '');
      if (!who) return;
      setRaisedHands((prev) => {
        const next = { ...prev };
        if (msg.raised) next[who] = true;
        else delete next[who];
        return next;
      });
      return;
    }

    // Moderation commands are honored only when sent by a teacher, and never acted on by the teacher who sent them.
    // Use msg.senderRole (set explicitly by the teacher client) as the authoritative source;
    // fall back to identity-based inference for backward compatibility.
    const senderIsTeacher = msg.senderRole === 'teacher' || inferRoleFromIdentity(participant?.identity, null) === 'teacher';
    if (!senderIsTeacher || isTeacherUser) return;

    if (msg.type === 'mute-all') {
      void applyForcedMute();
    } else if (msg.type === 'mic-lock') {
      setMicLockedByHost(!!msg.locked);
      if (msg.locked) void applyForcedMute();
    } else if (msg.type === 'camera-off-all') {
      void applyForcedCameraOff();
    } else if (msg.type === 'camera-lock') {
      setCameraLockedByHost(!!msg.locked);
      if (msg.locked) void applyForcedCameraOff();
    }
  }, [addFloatingReaction, applyForcedCameraOff, applyForcedMute, isTeacherUser]);

  useEffect(() => {
    handleDataMessageRef.current = handleDataMessage;
  }, [handleDataMessage]);

  useEffect(() => {
    return () => {
      liveKitJoinSessionEpoch += 1;
      // Stop any active screen recording and release its capture tracks.
      const rec = meetingRecorderRef.current;
      if (rec && rec.state !== 'inactive') {
        try {
          rec.stop();
        } catch (_e) {
          /* ignore */
        }
      }
      const streams = meetingStreamsRef.current;
      if (streams) {
        [streams.displayStream, streams.micStream].forEach((s) => {
          if (s) s.getTracks().forEach((t) => t.stop());
        });
        if (streams.audioCtx) {
          try {
            streams.audioCtx.close();
          } catch (_e) {
            /* ignore */
          }
        }
        meetingStreamsRef.current = null;
      }
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

  // Auto-start recording when the session has recording_available flag enabled by the teacher.
  const autoRecordingTriggeredRef = useRef(false);
  useEffect(() => {
    if (autoStartRecording && isTeacherUser && callState === 'active' && sessionId && !autoRecordingTriggeredRef.current) {
      autoRecordingTriggeredRef.current = true;
      // Small delay to let the UI settle, then trigger recording
      const t = setTimeout(() => {
        startMeetingRecording();
      }, 1500);
      return () => clearTimeout(t);
    }
    // Reset the ref when autoStartRecording changes
    if (!autoStartRecording) {
      autoRecordingTriggeredRef.current = false;
    }
  }, [autoStartRecording, isTeacherUser, callState, sessionId, startMeetingRecording]);

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
            raisedHands={raisedHands}
            onToggleHand={toggleHand}
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
            {showMoreMenu ? (
              <div className="more-menu" role="menu" aria-label="More options">
                {isTeacherUser ? (
                  <button type="button" className="more-menu-item" onClick={() => { toggleMicLock(); setShowMoreMenu(false); }}>
                    {micsLocked ? <FaLockOpen /> : <FaLock />} {micsLocked ? 'Allow mics' : 'Mute & lock all mics'}
                  </button>
                ) : null}
                {isTeacherUser && cameraAllowed ? (
                  <button type="button" className="more-menu-item" onClick={() => { toggleCameraLock(); setShowMoreMenu(false); }}>
                    {camerasLocked ? <FaLockOpen /> : <FaLock />} {camerasLocked ? 'Allow cameras' : 'Lock cameras'}
                  </button>
                ) : null}
                <button type="button" className="more-menu-item" onClick={() => { setShowParticipantsPanel((v) => !v); setShowMoreMenu(false); }}>
                  <FaUsers /> Participants ({participants.length})
                </button>
                <button type="button" className="more-menu-item" onClick={() => { setIsGridCompact((v) => !v); setShowMoreMenu(false); }}>
                  <FaThLarge /> {isGridCompact ? 'Comfortable grid' : 'Compact grid'}
                </button>
              </div>
            ) : null}
            <button
              className={`control-btn icon-only ${isAudioEnabled ? 'active' : 'muted'} ${micLockedByHost && !isTeacherUser ? 'locked' : ''}`}
              onClick={toggleAudio}
              title={
                micLockedByHost && !isTeacherUser
                  ? 'Microphone locked by host'
                  : isAudioEnabled ? 'Mute microphone' : 'Unmute microphone'
              }
              aria-label={isAudioEnabled ? 'Mute microphone' : 'Unmute microphone'}
            >
              {isAudioEnabled ? <FaMicrophone /> : <FaMicrophoneSlash />}
              {micLockedByHost && !isTeacherUser ? <span className="control-lock-badge"><FaLock /></span> : null}
            </button>
            {cameraAllowed ? (
              <button
                className={`control-btn icon-only ${isVideoEnabled ? 'active' : 'muted'} ${cameraLockedByHost && !isTeacherUser ? 'locked' : ''}`}
                onClick={toggleVideo}
                title={
                  cameraLockedByHost && !isTeacherUser
                    ? 'Camera locked by host'
                    : isVideoEnabled ? 'Turn camera off' : 'Turn camera on'
                }
                aria-label={isVideoEnabled ? 'Turn camera off' : 'Turn camera on'}
              >
                {isVideoEnabled ? <FaVideo /> : <FaVideoSlash />}
                {cameraLockedByHost && !isTeacherUser ? <span className="control-lock-badge"><FaLock /></span> : null}
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
              onClick={() => { setShowReactionBar((v) => !v); setShowMoreMenu(false); }}
              title="Send a reaction"
              aria-label="Send a reaction"
            >
              <FaRegSmile />
            </button>
            {/* Teacher transcript controls (Start Transcribing / Manual line) */}
            {extraControls}
            {isTeacherUser ? (
              <button
                className={`control-btn icon-only ${isRecordingMeeting ? 'recording-active' : ''}`}
                onClick={isRecordingMeeting ? stopMeetingRecording : startMeetingRecording}
                title={isRecordingMeeting ? 'Stop recording' : 'Record meeting'}
                aria-label={isRecordingMeeting ? 'Stop recording' : 'Record meeting'}
              >
                {isRecordingMeeting ? <FaStopCircle /> : <FaCircle />}
              </button>
            ) : null}
            <button
              className={`control-btn icon-only ${showMoreMenu ? 'active' : ''}`}
              onClick={() => { setShowMoreMenu((v) => !v); setShowReactionBar(false); }}
              title="More options"
              aria-label="More options"
            >
              <FaEllipsisV />
            </button>
            <button className="control-btn icon-only end-btn" onClick={handleLeaveCall} title="Leave call" aria-label="Leave call">
              <FaPhoneSlash />
            </button>
          </div>
        )}
      </div>

      {isRecordingMeeting ? (
        <div className="recording-indicator" aria-live="polite">
          <span className="recording-indicator-dot" /> REC
        </div>
      ) : null}
      {recordingStatus ? <div className="recording-status">{recordingStatus}</div> : null}
      {error ? <div className="call-error">{error}</div> : null}
      {isVoiceCall ? <div className="call-mode-badge">Voice call</div> : null}
      {callState === 'idle' && !autoStart ? <div className="call-debug-info">Ready to join SFU room.</div> : null}
      {callState === 'connecting' ? <div className="call-debug-info">Connecting to SFU...</div> : null}
      {callState === 'ended' ? <div className="call-debug-info">Call ended.</div> : null}
    </div>
  );
};

export default VideoCall;
