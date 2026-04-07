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
  });
};
