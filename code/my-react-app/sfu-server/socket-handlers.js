export const installSocketHandlers = (io) => {
  const rooms = new Map();

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
      const roomName = socket.data.roomName;
      const identity = socket.data.identity;
      if (!roomName || !identity) return;

      const room = getRoom(roomName);
      room.delete(socket.id);

      io.to(roomName).emit('participant-left', { identity });
      broadcastParticipantList(roomName);

      if (room.size === 0) {
        rooms.delete(roomName);
      }
    });

    /* ===== Private 1:1 Call Signaling ===== */

    socket.on('private_call_join', (payload) => {
      const { room_id, user_id, call_type } = payload || {};
      if (!room_id || !user_id) return;

      socket.join(room_id);
      socket.data.privateRoomId = room_id;
      socket.data.privateUserId = user_id;
      socket.data.privateCallType = call_type || 'video';

      const clients = Array.from(io.sockets.adapter.rooms.get(room_id) || []);
      const otherSockets = clients.filter((id) => id !== socket.id);

      if (otherSockets.length > 0) {
        socket.to(room_id).emit('private_call_ready', { room_id, user_id });
      }
    });

    socket.on('private_call_signal', (payload) => {
      const { room_id, from_user_id, signal } = payload || {};
      if (!room_id || !signal) return;

      socket.to(room_id).emit('private_call_signal', {
        room_id,
        from_user_id,
        signal
      });
    });

    socket.on('private_call_end', (payload) => {
      const { room_id, user_id } = payload || {};
      if (!room_id) return;

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

      socket.leave(room_id);
      socket.to(room_id).emit('private_call_ended', {
        room_id,
        user_id,
        reason: 'peer_left'
      });

      delete socket.data.privateRoomId;
      delete socket.data.privateUserId;
    });
  });
};
