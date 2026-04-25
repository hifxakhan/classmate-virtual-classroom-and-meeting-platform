export const installSocketHandlers = (io) => {
  const rooms = new Map();
  const onlineUsers = new Map(); // userKey -> Set of socket ids
  const callDebug = (...args) => console.log('[CALL_DEBUG][SFU]', ...args);

  const userKey = (userId, userType) => `${userType}:${userId}`;

  const resolveUserSockets = (userId, userType) => {
    const normalizedId = String(userId || '').trim();
    const normalizedType = String(userType || 'user').trim().toLowerCase();
    if (!normalizedId) return new Set();

    const direct = onlineUsers.get(userKey(normalizedId, normalizedType));
    if (direct && direct.size > 0) return new Set(direct);

    // Fallback: deliver by user id even when type labels differ across clients.
    const fallback = new Set();
    const suffix = `:${normalizedId}`;
    for (const [key, sockets] of onlineUsers.entries()) {
      if (key.endsWith(suffix)) {
        sockets.forEach((socketId) => fallback.add(socketId));
      }
    }
    return fallback;
  };

  const addUserSocket = (userId, userType, socketId) => {
    const key = userKey(userId, userType);
    if (!onlineUsers.has(key)) {
      onlineUsers.set(key, new Set());
    }
    onlineUsers.get(key).add(socketId);
  };

  const removeUserSocket = (userId, userType, socketId) => {
    const key = userKey(userId, userType);
    const sockets = onlineUsers.get(key);
    if (sockets) {
      sockets.delete(socketId);
      if (sockets.size === 0) {
        onlineUsers.delete(key);
      }
    }
  };

  const getRoom = (roomName) => {
    if (!rooms.has(roomName)) {
      rooms.set(roomName, new Map());
    }
    return rooms.get(roomName);
  }; 

  const broadcastParticipantList = (roomName) => {
    const room = getRoom(roomName);
    io.to(roomName).emit('participant-list', {
      roomName,
      participants: Array.from(room.values())
    });
  };

  io.on('connection', (socket) => {
    let currentUserId = null;
    let currentUserType = null;
    callDebug('socket connected', { socketId: socket.id });

    const handleRegisterUser = (payload) => {
      const { user_id, user_type } = payload || {};
      if (!user_id) return;
      callDebug('register user event', { socketId: socket.id, payload });
      currentUserId = String(user_id).trim();
      currentUserType = String(user_type || 'user').trim().toLowerCase();
      socket.data.userId = currentUserId;
      socket.data.userType = currentUserType;
      addUserSocket(currentUserId, currentUserType, socket.id);
      console.log(`✅ User registered: ${userKey(currentUserId, currentUserType)}, sockets: ${onlineUsers.get(userKey(currentUserId, currentUserType))?.size}`);
      callDebug('online users keys', Array.from(onlineUsers.keys()));
    };

    // Support both naming styles used across clients.
    socket.on('register-user', handleRegisterUser);
    socket.on('register_user', handleRegisterUser);

    socket.on('join-room', (payload) => {
      const { roomName, identity, name, role } = payload || {};
      if (!roomName || !identity) return;

      socket.join(roomName);
      socket.data.roomName = roomName;
      socket.data.identity = identity;
      socket.data.role = role || 'student';

      const room = getRoom(roomName);
      room.set(socket.id, {
        socketId: socket.id,
        identity,
        name: name || identity,
        role: role || 'student',
        audioEnabled: true,
        videoEnabled: true
      });

      socket.to(roomName).emit('participant-joined', {
        identity,
        name: name || identity,
        role: role || 'student'
      });

      broadcastParticipantList(roomName);
    });

    socket.on('participant-state-changed', (payload) => {
      const { roomName, identity, audioEnabled, videoEnabled } = payload || {};
      if (!roomName || !identity) return;

      const room = getRoom(roomName);
      const entry = Array.from(room.values()).find((p) => p.identity === identity);
      if (!entry) return;

      entry.audioEnabled = typeof audioEnabled === 'boolean' ? audioEnabled : entry.audioEnabled;
      entry.videoEnabled = typeof videoEnabled === 'boolean' ? videoEnabled : entry.videoEnabled;

      io.to(roomName).emit('participant-state-changed', {
        identity,
        audioEnabled: entry.audioEnabled,
        videoEnabled: entry.videoEnabled
      });

      broadcastParticipantList(roomName);
    });

    socket.on('teacher-force-mute', (payload) => {
      const { roomName, teacherIdentity, targetIdentity } = payload || {};
      if (!roomName || !teacherIdentity || !targetIdentity) return;

      const room = getRoom(roomName);
      const teacher = Array.from(room.values()).find((p) => p.identity === teacherIdentity);
      if (!teacher || teacher.role !== 'teacher') return;

      io.to(roomName).emit('teacher-force-mute', {
        teacherIdentity,
        targetIdentity,
        requestedAt: Date.now()
      });
    });

    /* ===== Private 1:1 Call Signaling & Notifications ===== */

    socket.on('private_call_request', (payload) => {
      const { call_id, room_id, initiator_id, initiator_type, receiver_id, receiver_type, call_type } = payload || {};
      if (!call_id || !receiver_id) return;
      callDebug('private_call_request received', {
        socketId: socket.id,
        call_id,
        room_id,
        initiator_id,
        initiator_type,
        receiver_id,
        receiver_type,
        call_type
      });

      const receiverKey = userKey(String(receiver_id).trim(), String(receiver_type || 'user').trim().toLowerCase());
      const receiverSockets = resolveUserSockets(receiver_id, receiver_type || 'user');

      console.log(`📞 Call request: ${call_id}, notifying ${receiverKey}, sockets:`, receiverSockets ? Array.from(receiverSockets) : 'none');

      if (receiverSockets && receiverSockets.size > 0) {
        receiverSockets.forEach((socketId) => {
          callDebug('emitting private_call_incoming', { call_id, room_id, targetSocketId: socketId });
          io.to(socketId).emit('private_call_incoming', {
            call: {
              call_id,
              room_id,
              initiator_id,
              initiator_type,
              receiver_id,
              receiver_type,
              call_type,
              status: 'pending'
            }
          });
        });
      } else {
        callDebug('no receiver sockets found', {
          call_id,
          receiverKey,
          knownOnlineUsers: Array.from(onlineUsers.keys())
        });
      }
    });

    socket.on('private_call_join', (payload) => {
      const { room_id, user_id, call_type } = payload || {};
      if (!room_id || !user_id) return;
      callDebug('private_call_join received', { socketId: socket.id, room_id, user_id, call_type });

      socket.join(room_id);
      socket.data.privateRoomId = room_id;
      socket.data.privateUserId = user_id;
      socket.data.privateCallType = call_type || 'video';

      const clients = Array.from(io.sockets.adapter.rooms.get(room_id) || []);
      const otherSockets = clients.filter((id) => id !== socket.id);
      callDebug('private_call_join room state', { room_id, clients, otherSockets });

      if (otherSockets.length > 0) {
        callDebug('emitting private_call_ready', { room_id, byUserId: user_id, targetClients: clients });
        io.to(room_id).emit('private_call_ready', { room_id, user_id });
      }
    });

    socket.on('private_call_signal', (payload) => {
      const { room_id, from_user_id, signal } = payload || {};
      if (!room_id || !signal) return;
      callDebug('private_call_signal relay', {
        socketId: socket.id,
        room_id,
        from_user_id,
        signalType: signal?.type || 'unknown'
      });

      socket.to(room_id).emit('private_call_signal', {
        room_id,
        from_user_id,
        signal
      });
    });

    socket.on('private_call_end', (payload) => {
      const { room_id, user_id } = payload || {};
      if (!room_id) return;
      callDebug('private_call_end received', { socketId: socket.id, room_id, user_id });

      socket.to(room_id).emit('private_call_ended', {
        room_id,
        user_id,
        reason: 'peer_ended'
      });

      socket.leave(room_id);
      delete socket.data.privateRoomId;
      delete socket.data.privateUserId;
    });

    socket.on('private_call_leave', (payload) => {
      const { room_id, user_id } = payload || {};
      if (!room_id) return;
      callDebug('private_call_leave received', { socketId: socket.id, room_id, user_id });

      socket.leave(room_id);
      socket.to(room_id).emit('private_call_ended', {
        room_id,
        user_id,
        reason: 'peer_left'
      });

      delete socket.data.privateRoomId;
      delete socket.data.privateUserId;
    });

    socket.on('leave-room', ({ roomName, identity } = {}) => {
      if (!roomName || !identity) return;

      const room = getRoom(roomName);
      room.delete(socket.id);
      socket.leave(roomName);

      io.to(roomName).emit('participant-left', { identity });
      broadcastParticipantList(roomName);

      if (room.size === 0) {
        rooms.delete(roomName);
      }
    });

    socket.on('disconnect', () => {
      callDebug('socket disconnect', {
        socketId: socket.id,
        currentUserId,
        currentUserType,
        privateRoomId: socket.data.privateRoomId
      });
      const roomName = socket.data.roomName;
      const identity = socket.data.identity;
      if (roomName && identity) {
        const room = getRoom(roomName);
        room.delete(socket.id);
        io.to(roomName).emit('participant-left', { identity });
        broadcastParticipantList(roomName);
        if (room.size === 0) {
          rooms.delete(roomName);
        }
      }

      if (currentUserId && currentUserType) {
        removeUserSocket(currentUserId, currentUserType, socket.id);
        console.log(`👋 User disconnected: ${userKey(currentUserId, currentUserType)}`);
      }

      const privateRoomId = socket.data.privateRoomId;
      if (privateRoomId) {
        socket.to(privateRoomId).emit('private_call_ended', {
          room_id: privateRoomId,
          user_id: socket.data.privateUserId,
          reason: 'disconnected'
        });
        socket.leave(privateRoomId);
      }
    });
  });
};
