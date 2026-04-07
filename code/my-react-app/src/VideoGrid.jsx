import React from 'react';
import ParticipantTile from './ParticipantTile';

const VideoGrid = ({ participants, compact, isTeacher, currentIdentity, onRequestMute }) => {
  const cls = compact ? 'video-grid compact' : 'video-grid';

  return (
    <div className={cls} style={{ display: 'grid', gap: 10, gridTemplateColumns: compact ? 'repeat(auto-fill, minmax(170px, 1fr))' : 'repeat(auto-fill, minmax(240px, 1fr))', maxHeight: '68vh', overflowY: 'auto' }}>
      {participants.map((p) => (
        <ParticipantTile
          key={p.identity}
          participant={p}
          canTeacherMute={isTeacher && p.identity !== currentIdentity}
          onRequestMute={onRequestMute}
        />
      ))}
      {participants.length === 0 ? (
        <div style={{ padding: 20, border: '1px dashed #ccc', borderRadius: 8 }}>
          No participants yet.
        </div>
      ) : null}
    </div>
  );
};

export default VideoGrid;
