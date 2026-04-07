import React, { useEffect, useRef } from 'react';

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
    <div className="video-main" style={{ position: 'relative', minHeight: 160, borderRadius: 10, overflow: 'hidden' }}>
      {participant.videoTrack && participant.isVideoEnabled ? (
        <video ref={videoRef} className="video-element" />
      ) : (
        <div style={{ height: '100%', minHeight: 160, display: 'grid', placeItems: 'center', background: '#1a1a1a', color: '#fff' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#333', margin: '0 auto 8px', display: 'grid', placeItems: 'center', fontWeight: 700 }}>
              {(participant.name || participant.identity || '?').slice(0, 1).toUpperCase()}
            </div>
            <div>{participant.name || participant.identity}</div>
            <div style={{ opacity: 0.75, fontSize: 12 }}>Video off</div>
          </div>
        </div>
      )}

      {participant.audioTrack ? <audio ref={audioRef} /> : null}

      <div className="video-overlay-name" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span>{participant.name || participant.identity}</span>
        <span style={{ display: 'inline-flex', gap: 6 }}>
          <span title={participant.isAudioEnabled ? 'Mic on' : 'Mic muted'}>{participant.isAudioEnabled ? 'Mic' : 'Mic Off'}</span>
          <span title={participant.isVideoEnabled ? 'Camera on' : 'Camera off'}>{participant.isVideoEnabled ? 'Cam' : 'Cam Off'}</span>
          {canTeacherMute ? (
            <button className="control-btn" style={{ padding: '2px 8px', height: 24 }} onClick={() => onRequestMute(participant.identity)}>
              Mute
            </button>
          ) : null}
        </span>
      </div>
    </div>
  );
};

export default ParticipantTile;
