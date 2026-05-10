export const installSocketHandlers = (io) => {
  const rooms = new Map();
  const onlineUsers = new Map(); // userKey -> Set of socket ids
  const callDebug = (...args) => console.log('[CALL_DEBUG][SFU]', ...args);

  const userKey = (userId, userType) => `${userType}:${userId}`;
  const userRoomName = (userId, userType) => `user:${userKey(userId, userType)}`;

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
      console.log(`🔵 [REGISTER] Attempting to register: ${user_type}:${user_id}`);
      console.log(`   Socket ID: ${socket.id}`);
      console.log(`   Online users BEFORE:`, Array.from(onlineUsers.keys()));
      callDebug('register user event', { socketId: socket.id, payload });
      currentUserId = String(user_id).trim();
      currentUserType = String(user_type || 'user').trim().toLowerCase();
      socket.data.userId = currentUserId;
      socket.data.userType = currentUserType;

      const prevUserRoom = socket.data.userRoom;
      if (prevUserRoom && prevUserRoom !== userRoomName(currentUserId, currentUserType)) {
        socket.leave(prevUserRoom);
      }
      socket.data.userRoom = userRoomName(currentUserId, currentUserType);
      socket.join(socket.data.userRoom);

      addUserSocket(currentUserId, currentUserType, socket.id);
      console.log(`✅ [REGISTER] SUCCESS! Registered ${currentUserType}:${currentUserId}`);
      console.log(`   Online users AFTER:`, Array.from(onlineUsers.keys()));
      console.log(`   Sockets for this user:`, Array.from(onlineUsers.get(userKey(currentUserId, currentUserType)) || []));
      callDebug('online users keys', Array.from(onlineUsers.keys()));
      callDebug('user joined room', { socketId: socket.id, room: socket.data.userRoom });
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
      const receiverRoom = userRoomName(String(receiver_id).trim(), String(receiver_type || 'user').trim().toLowerCase());
      const receiverSockets = resolveUserSockets(receiver_id, receiver_type || 'user');

      console.log(`📞 Call request: ${call_id}, notifying ${receiverKey}, sockets:`, receiverSockets ? Array.from(receiverSockets) : 'none');
      callDebug('emitting private_call_incoming to user room', { call_id, room_id, receiverRoom });

      io.to(receiverRoom).emit('private_call_incoming', {
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

      if (!receiverSockets || receiverSockets.size === 0) {
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

    socket.on('check_registration', (payload) => {
      const { user_id, user_type } = payload || {};
      const key = userKey(String(user_id || '').trim(), String(user_type || 'user').trim().toLowerCase());
      const isRegistered = onlineUsers.has(key);
      console.log(`🔍 Registration check for ${key}: ${isRegistered ? 'REGISTERED' : 'NOT REGISTERED'}`);
      socket.emit('registration_confirmed', {
        user_id,
        user_type,
        registered: isRegistered,
        active_sockets: isRegistered ? Array.from(onlineUsers.get(key)) : []
      });
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

      if (socket.data.userRoom) {
        socket.leave(socket.data.userRoom);
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

    // ============ VOICE CALL EVENTS (WebRTC P2P) ============

    socket.on('voice_call_request', (data) => {
      console.log(`📞 [VOICE_CALL_REQUEST] FULL PAYLOAD:`, JSON.stringify(data, null, 2));
      const { to, to_type, from, from_type, from_name, signal, receiver_id, receiver_type, initiator_id, initiator_type, initiator_name, call_type } = data;
      
      console.log(`📞 [VOICE_CALL_REQUEST] RECEIVED`);
      console.log(`   From: ${from_type}:${from} (${from_name})`);
      console.log(`   To: ${to_type}:${to}`);
      console.log(`   Receiver ID from payload: ${receiver_id || 'MISSING!'}`);
      console.log(`   Call type: ${call_type || 'voice'}`);
      console.log(`   Signal type: ${signal?.type || 'offer'}`);
      console.log(`   Online users registry BEFORE lookup:`, Array.from(onlineUsers.keys()));

      // Find receiver's sockets
      const targetId = receiver_id || to;
      const targetType = receiver_type || to_type;
      let receiverSockets = resolveUserSockets(targetId, targetType);
      console.log(`✅ resolveUserSockets returned: ${receiverSockets.size} socket(s)`);
      
      if (receiverSockets.size === 0) {
        console.log(`⚠️ Direct lookup failed, trying case-insensitive...`);
        const toKey = `${String(targetType || 'user').trim()}:${String(targetId).trim()}`;
        for (const [key, sockets] of onlineUsers.entries()) {
          if (key.toLowerCase() === toKey.toLowerCase()) {
            receiverSockets = new Set(sockets);
            console.log(`✅ Found via case-insensitive match: ${key}`);
            break;
          }
        }
      }

      if (receiverSockets.size === 0) {
        console.log(`⚠️ Type-specific lookup failed, trying ID-only...`);
        
        // Log all registered users for debug
        const allUsersForId = [];
        for (const [key, sockets] of onlineUsers.entries()) {
          if (key.endsWith(`:${String(targetId)}`)) {
            allUsersForId.push({ key, socketCount: sockets.size });
          }
        }
        console.log(`   Users with ID "${targetId}": ${allUsersForId.length > 0 ? JSON.stringify(allUsersForId) : 'NONE'}`);
        
        console.log(`❌ [VOICE_CALL] Receiver ${targetType}:${targetId} NOT FOUND in online users`);
        console.log(`   Registered users:`, Array.from(onlineUsers.keys()));
        socket.emit('voice_call_rejected', {
          from: targetId,
          from_type: targetType,
          from_name: 'User Offline or Not Registered'
        });
        return;
      }

      console.log(`✅ [VOICE_CALL] Found ${receiverSockets.size} receiver socket(s), delivering...`);

      // Send to ALL receiver sockets
      receiverSockets.forEach(receiverSocketId => {
        console.log(`   📞 Emitting voice_call_incoming to socket: ${receiverSocketId}`);
        io.to(receiverSocketId).emit('voice_call_incoming', {
          from: from,
          from_type: from_type,
          from_name: from_name,
          initiator_id: initiator_id || from,
          initiator_type: initiator_type || from_type,
          initiator_name: initiator_name || from_name,
          receiver_id: String(targetId),
          receiver_type: targetType,
          signal: signal,
          timestamp: Date.now(),
          call_type: call_type || 'voice'
        });
      });
    });

    socket.on('voice_call_accept', (data) => {
      const { to, to_type, from, from_type, signal } = data;

      // Find caller's sockets
      const callerSockets = resolveUserSockets(to, to_type);
      if (callerSockets.size === 0) {
        console.warn(`⚠️ Voice call caller ${to_type}:${to} not found`);
        return;
      }

      console.log(`✅ Voice call accepted by ${from_type}:${from}, notifying ${to_type}:${to}`);

      // Notify caller
      callerSockets.forEach(callerSocketId => {
        io.to(callerSocketId).emit('voice_call_accepted', {
          from: from,
          from_type: from_type,
          signal: signal
        });
      });
    });

    socket.on('voice_call_reject', (data) => {
      const { to, to_type, from, from_type, from_name } = data;

      // Find caller's sockets
      const callerSockets = resolveUserSockets(to, to_type);
      if (callerSockets.size === 0) {
        console.warn(`⚠️ Voice call caller ${to_type}:${to} not found`);
        return;
      }

      console.log(`❌ Voice call rejected by ${from_type}:${from}`);

      callerSockets.forEach(callerSocketId => {
        io.to(callerSocketId).emit('voice_call_rejected', {
          from: from,
          from_type: from_type,
          from_name: from_name
        });
      });
    });

    socket.on('voice_call_busy', (data) => {
      const { to, to_type, from, from_type, from_name } = data;

      // Find caller's sockets
      const callerSockets = resolveUserSockets(to, to_type);
      callerSockets.forEach(callerSocketId => {
        io.to(callerSocketId).emit('voice_call_busy', {
          from: from,
          from_type: from_type,
          from_name: from_name
        });
      });
    });

    socket.on('voice_call_signal', (data) => {
      const { to, to_type, from, from_type, signal } = data;

      // Relay ICE candidates and answer
      const receiverSockets = resolveUserSockets(to, to_type);
      receiverSockets.forEach(receiverSocketId => {
        io.to(receiverSocketId).emit('voice_call_signal', {
          from: from,
          from_type: from_type,
          signal: signal
        });
      });
    });

    socket.on('voice_call_end', (data) => {
      const { to, to_type, from, from_type } = data;

      // Notify the other party that the call has ended
      const otherPartySockets = resolveUserSockets(to, to_type);
      otherPartySockets.forEach(socketId => {
        io.to(socketId).emit('voice_call_ended', {
          from: from,
          from_type: from_type
        });
      });
    });
  });
};
