import React, { useEffect, useRef } from 'react';
import { FaMicrophone, FaMicrophoneSlash, FaVideo, FaVideoSlash } from 'react-icons/fa';

const ParticipantTile = ({ participant, canTeacherMute, onRequestMute }) => {
  const videoRef = useRef(null);
  const audioRef = useRef(null);

  useEffect(() => {
    const el = videoRef.current;
    const track = participant.videoTrack;

    if (!el || !track) return;

    track.attach(el);
    el.playsInline = true;
    el.autoplay = true;
    if (participant.isLocal) {
      el.muted = true;
    }

    const maybePlay = async () => {
      try {
        if (el.paused) await el.play();
      } catch (err) {
        if (err?.name !== 'AbortError') {
          console.error('Participant video play error:', err);
        }
      }
    };

    maybePlay();

    return () => {
      track.detach(el);
      if (el.srcObject) {
        el.srcObject = null;
      }
    };
  }, [participant.isLocal, participant.videoTrack]);

  useEffect(() => {
    const el = audioRef.current;
    const track = participant.audioTrack;

    if (!el || !track) return;

    track.attach(el);
    el.autoplay = true;
    el.playsInline = true;
    el.muted = !!participant.isLocal;

    const maybePlay = async () => {
      try {
        if (el.paused) await el.play();
      } catch (err) {
        if (err?.name !== 'AbortError') {
          console.error('Participant audio play error:', err);
        }
      }
    };

    maybePlay();

    return () => {
      track.detach(el);
      if (el.srcObject) {
        el.srcObject = null;
      }
    };
  }, [participant.audioTrack, participant.isLocal]);

  return (
    <article className={`participant-tile ${participant.isLocal ? 'local' : ''}`}>
      {participant.videoTrack && participant.isVideoEnabled ? (
        <video ref={videoRef} className="video-element" />
      ) : (
        <div className="video-off-state">
          <div className="video-off-content">
            <div className="participant-avatar">
              {(participant.name || participant.identity || '?').slice(0, 1).toUpperCase()}
            </div>
            <div className="video-off-name">{participant.name || participant.identity}</div>
            <div className="video-off-label">
              <FaVideoSlash />
              <span>Camera off</span>
            </div>
          </div>
        </div>
      )}

      {participant.audioTrack ? <audio ref={audioRef} /> : null}

      <div className="tile-overlay">
        <div className="participant-meta">
          <span className="participant-name">{participant.name || participant.identity}{participant.isLocal ? ' (You)' : ''}</span>
          <span className={`speaking-dot ${participant.isAudioEnabled ? 'active' : ''}`} title={participant.isAudioEnabled ? 'Speaking enabled' : 'Mic muted'} />
        </div>

        <div className="participant-indicators">
          <span className={`indicator-chip ${participant.isAudioEnabled ? '' : 'off'}`} title={participant.isAudioEnabled ? 'Microphone on' : 'Microphone muted'}>
            {participant.isAudioEnabled ? <FaMicrophone /> : <FaMicrophoneSlash />}
          </span>
          <span className={`indicator-chip ${participant.isVideoEnabled ? '' : 'off'}`} title={participant.isVideoEnabled ? 'Camera on' : 'Camera off'}>
            {participant.isVideoEnabled ? <FaVideo /> : <FaVideoSlash />}
          </span>
          {canTeacherMute ? (
            <button className="tile-mute-btn" onClick={() => onRequestMute(participant.identity)} title="Mute participant">
              <FaMicrophoneSlash />
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
};

export default ParticipantTile;
