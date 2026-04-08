import React from 'react';
import ParticipantTile from './ParticipantTile';

const VideoGrid = ({ participants, compact, isTeacher, currentIdentity, onRequestMute }) => {
  const count = participants.length;
  const densityClass = count <= 1 ? 'layout-single' : count <= 4 ? 'layout-medium' : count <= 9 ? 'layout-large' : 'layout-xlarge';
  const cls = `video-grid ${compact ? 'compact' : ''} ${densityClass}`.trim();

  return (
    <div className={cls}>
      {participants.map((p) => (
        <ParticipantTile
          key={p.identity}
          participant={p}
          canTeacherMute={isTeacher && p.identity !== currentIdentity}
          onRequestMute={onRequestMute}
        />
      ))}
      {participants.length === 0 ? (
        <div className="empty-grid-state">
          No participants yet.
        </div>
      ) : null}
    </div>
  );
};

export default VideoGrid;
